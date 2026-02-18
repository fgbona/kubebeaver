"""Orchestrates collection, sanitization, LLM call, and response building."""
import json
import logging
import re
import time
from typing import Any

from app.config import settings
from app.models import AnalysisJson, RootCauseItem, TruncationReport
from app.collectors import collect_evidence
from app.sanitize import sanitize_evidence, truncate_evidence_for_llm
from app.llm import get_llm_provider
from app.prompt import SYSTEM_ROLE, build_prompt

logger = logging.getLogger(__name__)


def _parse_llm_json(raw: str) -> dict[str, Any]:
    """Extract JSON from LLM response (may be wrapped in markdown)."""
    raw = raw.strip()
    # Remove markdown code block if present
    if raw.startswith("```"):
        raw = re.sub(r"^```(?:json)?\s*", "", raw)
        raw = re.sub(r"\s*```\s*$", "", raw)
    return json.loads(raw)


def _json_to_markdown(analysis: AnalysisJson) -> str:
    parts = [
        "## Summary",
        analysis.summary,
        "",
        "## Likely root causes",
    ]
    for rc in analysis.likely_root_causes:
        parts.append(f"- **{rc.cause}** (confidence: {rc.confidence})")
        if rc.evidence_refs:
            parts.append("  - Evidence: " + ", ".join(rc.evidence_refs))
    parts.extend(["", "## Recommended actions"])
    for i, a in enumerate(analysis.recommended_actions, 1):
        parts.append(f"{i}. {a}")
    parts.extend(["", "## Suggested kubectl commands"])
    for cmd in analysis.kubectl_commands:
        parts.append(f"```bash\n{cmd}\n```")
    if analysis.follow_up_questions:
        parts.extend(["", "## Follow-up questions"])
        for q in analysis.follow_up_questions:
            parts.append(f"- {q}")
    if analysis.risk_notes:
        parts.extend(["", "## Risk notes"])
        for r in analysis.risk_notes:
            parts.append(f"- {r}")
    return "\n".join(parts)


async def run_analysis(
    kind: str,
    namespace: str | None,
    name: str,
    context: str | None,
    include_previous_logs: bool,
) -> tuple[dict[str, Any], dict[str, Any], TruncationReport, int, int, str | None]:
    """
    Collect evidence, sanitize, truncate, call LLM, parse response.
    Returns (analysis_json_dict, evidence_sanitized, truncation_report, tokens_used, response_time_ms, error).
    """
    evidence = collect_evidence(
        kind=kind,
        namespace=namespace,
        name=name,
        context=context,
        include_previous_logs=include_previous_logs,
        max_log_lines=settings.max_log_lines,
        max_events=settings.max_events,
        max_pods=settings.max_pods_per_workload,
    )
    if evidence.get("error"):
        return {}, evidence, TruncationReport(), 0, 0, evidence.get("error") or "Collection failed"

    evidence_clean = sanitize_evidence(evidence)
    evidence_for_llm, trunc_report_dict = truncate_evidence_for_llm(
        evidence_clean,
        settings.max_evidence_chars,
    )
    trunc_report = TruncationReport(
        truncated=trunc_report_dict.get("truncated", False),
        sections_truncated=trunc_report_dict.get("sections_truncated", []),
        total_chars_before=trunc_report_dict.get("total_chars_before", 0),
        total_chars_after=trunc_report_dict.get("total_chars_after", 0),
    )

    full_prompt = (
        SYSTEM_ROLE
        + "\n\n"
        + build_prompt(
            evidence_for_llm,
            kind,
            name,
            namespace,
        )
    )
    provider = get_llm_provider()
    if not provider.is_configured:
        return {}, evidence_clean, trunc_report, 0, 0, "LLM provider not configured (set GROQ_API_KEY or OPENAI_BASE_URL)"

    start_time = time.time()
    try:
        llm_response = await provider.complete(full_prompt, timeout=settings.request_timeout)
        response_time_ms = int((time.time() - start_time) * 1000)
        raw_response = llm_response.content
        tokens_used = llm_response.tokens_used
    except Exception as e:
        logger.exception("LLM call failed: %s", e)
        response_time_ms = int((time.time() - start_time) * 1000)
        return {}, evidence_clean, trunc_report, 0, response_time_ms, str(e)

    try:
        parsed = _parse_llm_json(raw_response)
    except json.JSONDecodeError as e:
        logger.warning("LLM response was not valid JSON: %s", e)
        # Fallback: treat whole response as summary
        parsed = {
            "summary": raw_response[:2000],
            "likely_root_causes": [],
            "recommended_actions": [],
            "kubectl_commands": [],
            "follow_up_questions": [],
            "risk_notes": [],
        }

    root_causes = [
        RootCauseItem(
            cause=p.get("cause", ""),
            confidence=p.get("confidence", "medium"),
            evidence_refs=p.get("evidence_refs") or [],
        )
        for p in parsed.get("likely_root_causes") or []
    ]
    analysis_json = AnalysisJson(
        summary=parsed.get("summary", ""),
        likely_root_causes=root_causes,
        recommended_actions=parsed.get("recommended_actions") or [],
        kubectl_commands=parsed.get("kubectl_commands") or [],
        follow_up_questions=parsed.get("follow_up_questions") or [],
        risk_notes=parsed.get("risk_notes") or [],
    )
    analysis_dict = analysis_json.model_dump()
    markdown = _json_to_markdown(analysis_json)
    return analysis_dict, evidence_clean, trunc_report, tokens_used, response_time_ms, None
