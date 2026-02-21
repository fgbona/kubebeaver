"""LLM prompt construction for Kubernetes troubleshooting."""
import json
from typing import Any


SYSTEM_ROLE = """You are an expert SRE/DevOps engineer specializing in Kubernetes troubleshooting.
Your task is to analyze evidence collected from a Kubernetes cluster and produce a structured diagnosis.
Rules:
- Base your analysis ONLY on the evidence provided. Do not invent facts.
- Use evidence_refs to point to specific keys in the evidence (e.g. pod.status.containerStatuses[0].state).
- Be concise but actionable.
- If critical data is missing, say so in follow_up_questions.
- For risk_notes, mention any risks (data loss, impact, downtime) if relevant.
- When heuristic candidates are provided, confirm or refute them with evidence; you may add other root causes not in the list."""

OUTPUT_SCHEMA = """
Respond with a single JSON object (no markdown code fence, no extra text) with exactly these keys:
- summary (string): 2-4 sentence summary of what is happening.
- likely_root_causes (array of { cause, confidence: "high"|"medium"|"low", evidence_refs: string[] })
- recommended_actions (array of strings, prioritized)
- kubectl_commands (array of strings: suggested commands to validate or fix)
- follow_up_questions (array of strings: if more data would help)
- risk_notes (array of strings: e.g. data loss risk, impact)
- why (array of { ref: string, explanation: string }): for each evidence_ref you cite in likely_root_causes, add one entry mapping that ref to a short explanation of why it supports or refutes a cause)
- uncertain (array of strings): what is still unclear or needs follow-up (e.g. "Exit code not in evidence", "Need to check image tag")
"""


def build_prompt(
    evidence: dict,
    target_kind: str,
    target_name: str,
    target_namespace: str | None,
    heuristic_conditions: list[dict[str, Any]] | None = None,
    engine_result: dict[str, Any] | None = None,
) -> str:
    target_ns = target_namespace or ""
    evidence_str = json.dumps(evidence, indent=2, default=str)
    engine_block = ""
    if engine_result and engine_result.get("findings"):
        pct = int(engine_result["engine_confidence"] * 100)
        engine_block = f"\nENGINE DIAGNOSTIC (deterministic signals — {pct}% confidence):\n"
        signals = engine_result.get("signals", {})
        active_signals = [
            f"  - {k}: {v}"
            for k, v in signals.items()
            if v is True or (isinstance(v, int) and v > 0)
        ]
        if active_signals:
            engine_block += "Active signals:\n" + "\n".join(active_signals) + "\n"
        engine_block += "\nEngine-classified root causes (backed by deterministic evidence):\n"
        for f in engine_result["findings"]:
            engine_block += (
                f"  - [{f['root_cause']}] confidence={int(f['confidence'] * 100)}%: {f['description']}\n"
            )
        engine_block += (
            "\nCRITICAL INSTRUCTION: The above root causes are backed by deterministic signals. "
            "You MUST confirm or refute each with reasoning from the evidence. "
            "You MUST NOT invent root causes that have no signal above. "
            "You MAY add causes ONLY if directly supported by cited evidence.\n\n"
        )
    heuristic_block = ""
    if heuristic_conditions:
        heuristic_block = "\nHEURISTIC CANDIDATES (from evidence; confirm or refute with evidence):\n"
        heuristic_block += json.dumps(heuristic_conditions, indent=2)
        heuristic_block += "\n\n"
    return f"""Analyze the following Kubernetes troubleshooting evidence for {target_kind} "{target_name}" (namespace: {target_ns or 'N/A'}).

{engine_block}{heuristic_block}{OUTPUT_SCHEMA}

EVIDENCE (JSON):
{evidence_str}

Return only the JSON object."""
