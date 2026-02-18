"""Compare two analyses: deterministic diff + LLM explanation."""
from __future__ import annotations

import json
import logging
import re
import time
from typing import Any

from app.config import settings
from app.diff_engine import compute_diffs
from app.history import get_analysis
from app.llm import get_llm_provider

logger = logging.getLogger(__name__)

COMPARE_SYSTEM = """You are an expert SRE/DevOps engineer. You are given a list of deterministic diffs between two Kubernetes analysis runs (A = older, B = newer).
Your task: write a short engineer-friendly explanation of what likely changed and why, referencing only the diff items by path (e.g. "pod.status.phase", "pod.status.containerStatuses[0].lastState").
Rules:
- Base your reasoning ONLY on the diff items provided. Do not invent facts.
- Cite evidence paths from the diff (e.g. "The pod phase moved to Running (pod.status.phase)").
- Be concise (2-5 sentences for likely_reasoning).
- Output valid JSON with keys: likely_reasoning (string), diff_summary (string, markdown)."""


def _build_compare_prompt(changes: list[dict[str, Any]], meta_a: dict, meta_b: dict) -> str:
    """Build minimal prompt for LLM (diff + minimal context)."""
    target = f"{meta_a.get('kind', '')} {meta_a.get('name', '')} ({meta_a.get('namespace') or 'N/A'})"
    diff_str = json.dumps(changes, indent=2, default=str)
    prompt = f"""Analysis A: {meta_a.get('created_at')} | {target}
Analysis B: {meta_b.get('created_at')} | {meta_b.get('kind')} {meta_b.get('name')} ({meta_b.get('namespace') or 'N/A'})

DIFF ITEMS (path, before -> after, impact):
{diff_str}

Return a JSON object with keys: likely_reasoning (string), diff_summary (string, markdown)."""
    return prompt[: settings.max_compare_chars]


def _parse_llm_compare_response(raw: str) -> tuple[str, str]:
    """Extract likely_reasoning and diff_summary from LLM response."""
    raw = raw.strip()
    if raw.startswith("```"):
        raw = re.sub(r"^```(?:json)?\s*", "", raw)
        raw = re.sub(r"\s*```\s*$", "", raw)
    try:
        data = json.loads(raw)
        return (
            data.get("likely_reasoning") or "",
            data.get("diff_summary") or "",
        )
    except json.JSONDecodeError:
        return raw[:1500], ""


async def run_compare(analysis_id_a: str, analysis_id_b: str) -> dict[str, Any]:
    """
    Load both analyses, compute diffs, optionally call LLM for explanation.
    Returns dict suitable for CompareResponse: diff_summary, changes, likely_reasoning, analysis_a, analysis_b, error.
    """
    if analysis_id_a == analysis_id_b:
        return {
            "diff_summary": "",
            "changes": [],
            "likely_reasoning": "",
            "analysis_a": {},
            "analysis_b": {},
            "error": "analysis_id_a and analysis_id_b must be different",
        }

    row_a = await get_analysis(analysis_id_a)
    row_b = await get_analysis(analysis_id_b)
    if not row_a:
        return {
            "diff_summary": "",
            "changes": [],
            "likely_reasoning": "",
            "analysis_a": {},
            "analysis_b": {},
            "error": "Analysis A not found",
        }
    if not row_b:
        return {
            "diff_summary": "",
            "changes": [],
            "likely_reasoning": "",
            "analysis_a": {},
            "analysis_b": {},
            "error": "Analysis B not found",
        }

    # Normalize: evidence_summary may be string (from DB) or already parsed in to_dict
    if isinstance(row_a.get("evidence_summary"), str):
        pass
    else:
        row_a["evidence_summary"] = json.dumps(row_a.get("evidence_summary") or {}, default=str)[:10000]
    if isinstance(row_b.get("evidence_summary"), str):
        pass
    else:
        row_b["evidence_summary"] = json.dumps(row_b.get("evidence_summary") or {}, default=str)[:10000]

    changes = compute_diffs(row_a, row_b)

    a_json = row_a.get("analysis_json") or {}
    b_json = row_b.get("analysis_json") or {}
    meta_a = {
        "id": row_a.get("id"),
        "created_at": row_a.get("created_at"),
        "kind": row_a.get("kind"),
        "name": row_a.get("name"),
        "namespace": row_a.get("namespace"),
        "kubectl_commands": a_json.get("kubectl_commands") or [],
    }
    meta_b = {
        "id": row_b.get("id"),
        "created_at": row_b.get("created_at"),
        "kind": row_b.get("kind"),
        "name": row_b.get("name"),
        "namespace": row_b.get("namespace"),
        "kubectl_commands": b_json.get("kubectl_commands") or [],
    }

    diff_summary_md = ""
    likely_reasoning = ""

    provider = get_llm_provider()
    if provider.is_configured and changes:
        prompt = _build_compare_prompt(changes, meta_a, meta_b)
        full_prompt = COMPARE_SYSTEM + "\n\n" + prompt + "\n\nReturn only the JSON object."
        try:
            start = time.time()
            llm_response = await provider.complete(full_prompt, timeout=min(settings.request_timeout, 60))
            likely_reasoning, diff_summary_md = _parse_llm_compare_response(llm_response.content)
            logger.info("compare LLM completed in %d ms", int((time.time() - start) * 1000))
        except Exception as e:
            logger.warning("compare LLM failed: %s", e)
            diff_summary_md = "\n".join(
                f"- **{c.get('path', '')}**: {c.get('impact', '')}" for c in changes[:30]
            )
    else:
        # No LLM or no changes: build a simple markdown list from changes
        diff_summary_md = "\n".join(
            f"- **{c.get('path', '')}**: {c.get('impact', '')}" for c in changes[:50]
        )

    return {
        "diff_summary": diff_summary_md,
        "changes": changes,
        "likely_reasoning": likely_reasoning,
        "analysis_a": meta_a,
        "analysis_b": meta_b,
        "error": None,
    }
