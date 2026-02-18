"""LLM prompt construction for Kubernetes troubleshooting."""
import json


SYSTEM_ROLE = """You are an expert SRE/DevOps engineer specializing in Kubernetes troubleshooting.
Your task is to analyze evidence collected from a Kubernetes cluster and produce a structured diagnosis.
Rules:
- Base your analysis ONLY on the evidence provided. Do not invent facts.
- Use evidence_refs to point to specific keys in the evidence (e.g. pod.status.containerStatuses[0].state).
- Be concise but actionable.
- If critical data is missing, say so in follow_up_questions.
- For risk_notes, mention any risks (data loss, impact, downtime) if relevant."""

OUTPUT_SCHEMA = """
Respond with a single JSON object (no markdown code fence, no extra text) with exactly these keys:
- summary (string): 2-4 sentence summary of what is happening.
- likely_root_causes (array of { cause, confidence: "high"|"medium"|"low", evidence_refs: string[] })
- recommended_actions (array of strings, prioritized)
- kubectl_commands (array of strings: suggested commands to validate or fix)
- follow_up_questions (array of strings: if more data would help)
- risk_notes (array of strings: e.g. data loss risk, impact)
"""


def build_prompt(evidence: dict, target_kind: str, target_name: str, target_namespace: str | None) -> str:
    target_ns = target_namespace or ""
    evidence_str = json.dumps(evidence, indent=2, default=str)
    return f"""Analyze the following Kubernetes troubleshooting evidence for {target_kind} "{target_name}" (namespace: {target_ns or 'N/A'}).

{OUTPUT_SCHEMA}

EVIDENCE (JSON):
{evidence_str}

Return only the JSON object."""
