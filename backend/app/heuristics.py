"""Deterministic heuristic scoring for common Kubernetes failure conditions.

Produces root-cause candidates with confidence and evidence_refs for
CrashLoopBackOff, ImagePullBackOff, ErrImagePull, Unschedulable, and related states.
"""
from __future__ import annotations

from typing import Any

# Condition -> list of (cause, confidence, evidence_refs)
HEURISTIC_RULES: dict[str, list[tuple[str, str, list[str]]]] = {
    "CrashLoopBackOff": [
        ("Application exit / crash (non-zero exit code)", "high", ["pod.status.containerStatuses", "pod_logs", "previous_logs"]),
        ("OOMKilled (out of memory)", "high", ["pod.status.containerStatuses[].lastState.terminated"]),
        ("Missing config or secret", "medium", ["pod.status.containerStatuses", "pod_events"]),
        ("Startup probe or readiness failure", "medium", ["pod.status.containerStatuses", "pod_events"]),
    ],
    "ImagePullBackOff": [
        ("Image name or tag invalid / not found", "high", ["pod.status.containerStatuses[].state.waiting", "pod_events"]),
        ("ImagePullSecrets missing or insufficient", "high", ["pod.spec", "pod_events"]),
        ("Registry unreachable or auth failure", "medium", ["pod_events"]),
    ],
    "ErrImagePull": [
        ("Image name or tag invalid / not found", "high", ["pod.status.containerStatuses[].state.waiting", "pod_events"]),
        ("ImagePullSecrets missing or insufficient", "high", ["pod.spec", "pod_events"]),
        ("Registry unreachable or auth failure", "medium", ["pod_events"]),
    ],
    "Unschedulable": [
        ("Insufficient CPU/memory on nodes", "high", ["pod_events", "node.status"]),
        ("Node selector or affinity not satisfied", "high", ["pod.spec", "pod_events"]),
        ("PVC bound / storage or topology constraint", "medium", ["pod_events"]),
        ("Taints / node unschedulable", "medium", ["pod_events", "node.spec.taints"]),
    ],
    "OOMKilled": [
        ("Container exceeded memory limit", "high", ["pod.status.containerStatuses[].lastState.terminated"]),
        ("Increase memory limit or fix leak", "high", ["pod.spec", "pod_logs"]),
    ],
    "Error": [
        ("Application crash or non-zero exit", "high", ["pod.status.containerStatuses", "pod_logs", "previous_logs"]),
        ("Check logs for stack trace or error message", "medium", ["pod_logs", "previous_logs"]),
    ],
}


def _find_waiting_reasons(evidence: dict[str, Any]) -> list[tuple[str, str]]:
    """Return (condition, evidence_ref) for container waiting reasons."""
    out: list[tuple[str, str]] = []
    pod = evidence.get("pod") or {}
    status = pod.get("status") or {}
    for i, cs in enumerate(status.get("containerStatuses") or []):
        state = cs.get("state") or {}
        waiting = state.get("waiting")
        if waiting and isinstance(waiting, dict):
            reason = (waiting.get("reason") or "").strip()
            if reason:
                ref = f"pod.status.containerStatuses[{i}].state.waiting"
                out.append((reason, ref))
    return out


def _find_terminated_reasons(evidence: dict[str, Any]) -> list[tuple[str, str]]:
    """Return (condition, evidence_ref) for container terminated reasons (current or lastState)."""
    out: list[tuple[str, str]] = []
    pod = evidence.get("pod") or {}
    status = pod.get("status") or {}
    for i, cs in enumerate(status.get("containerStatuses") or []):
        for state_key, ref_suffix in [("state", "state.terminated"), ("lastState", "lastState.terminated")]:
            state = cs.get(state_key) or {}
            term = state.get("terminated")
            if term and isinstance(term, dict):
                reason = (term.get("reason") or "").strip()
                if reason:
                    ref = f"pod.status.containerStatuses[{i}].{ref_suffix}"
                    out.append((reason, ref))
    return out


def _find_event_reasons(evidence: dict[str, Any]) -> list[tuple[str, str]]:
    """Return (reason, evidence_ref) from pod_events or node_events."""
    out: list[tuple[str, str]] = []
    for key in ("pod_events", "node_events"):
        events = evidence.get(key) or []
        if not events:
            continue
        for i, ev in enumerate(events):
            if isinstance(ev, dict) and ev.get("reason"):
                out.append((ev["reason"], f"{key}[{i}].reason"))
    return out


def _normalize_condition(reason: str) -> str:
    """Map event/status reasons to our known condition keys."""
    r = reason.strip()
    if r in ("CrashLoopBackOff", "ImagePullBackOff", "ErrImagePull", "Unschedulable", "OOMKilled", "Error"):
        return r
    if r in ("FailedScheduling", "Scheduling"):
        return "Unschedulable"
    return r


def compute_heuristics(evidence: dict[str, Any]) -> list[dict[str, Any]]:
    """Produce deterministic root-cause candidates from evidence.

    Returns list of:
      { "condition": str, "evidence_refs": [str], "candidates": [ { "cause", "confidence", "evidence_refs" } ] }
    """
    seen_conditions: set[str] = set()
    result: list[dict[str, Any]] = []

    # Container waiting states
    for reason, ref in _find_waiting_reasons(evidence):
        cond = _normalize_condition(reason)
        if cond not in HEURISTIC_RULES or cond in seen_conditions:
            continue
        seen_conditions.add(cond)
        rules = HEURISTIC_RULES[cond]
        result.append({
            "condition": cond,
            "evidence_refs": [ref],
            "candidates": [
                {"cause": c, "confidence": conf, "evidence_refs": refs}
                for c, conf, refs in rules
            ],
        })

    # Container terminated (current or lastState)
    for reason, ref in _find_terminated_reasons(evidence):
        cond = _normalize_condition(reason)
        if cond not in HEURISTIC_RULES or cond in seen_conditions:
            continue
        seen_conditions.add(cond)
        rules = HEURISTIC_RULES[cond]
        result.append({
            "condition": cond,
            "evidence_refs": [ref],
            "candidates": [
                {"cause": c, "confidence": conf, "evidence_refs": refs}
                for c, conf, refs in rules
            ],
        })

    # Events: Unschedulable (FailedScheduling)
    for reason, ref in _find_event_reasons(evidence):
        cond = _normalize_condition(reason)
        if cond not in HEURISTIC_RULES or cond in seen_conditions:
            continue
        seen_conditions.add(cond)
        rules = HEURISTIC_RULES[cond]
        result.append({
            "condition": cond,
            "evidence_refs": [ref],
            "candidates": [
                {"cause": c, "confidence": conf, "evidence_refs": refs}
                for c, conf, refs in rules
            ],
        })

    return result
