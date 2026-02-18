"""Deterministic diff engine for comparing two analyses (evidence + analysis_json)."""
from __future__ import annotations

import json
import logging
from typing import Any

logger = logging.getLogger(__name__)


def _parse_evidence(evidence_summary: str | None) -> dict[str, Any]:
    """Parse evidence_summary from DB; may be truncated. Returns {} on failure."""
    if not evidence_summary or not evidence_summary.strip():
        return {}
    try:
        return json.loads(evidence_summary)
    except json.JSONDecodeError:
        # Try to salvage partial JSON (e.g. truncated at 10k chars)
        try:
            # Find last complete object/array boundary
            trimmed = evidence_summary.strip()
            for i in range(len(trimmed), 0, -1):
                try:
                    return json.loads(trimmed[:i] + "}")
                except json.JSONDecodeError:
                    continue
        except Exception:
            pass
        return {}


def _deep_get(obj: Any, path: str) -> Any:
    """Get nested key; path like 'pod.status.phase' or 'pod.status.conditions'."""
    for part in path.split("."):
        if obj is None or not isinstance(obj, dict):
            return None
        obj = obj.get(part)
    return obj


def _diff_pod_phase_and_conditions(
    a_ev: dict[str, Any],
    b_ev: dict[str, Any],
    prefix: str,
) -> list[dict[str, Any]]:
    """Diff pod phase and conditions. prefix is e.g. 'pod' or 'problematic_pods_evidence[0].pod'."""
    changes: list[dict[str, Any]] = []
    a_pod = _deep_get(a_ev, f"{prefix}.status") if prefix else a_ev.get("pod", {}).get("status")
    b_pod = _deep_get(b_ev, f"{prefix}.status") if prefix else b_ev.get("pod", {}).get("status")
    if not a_pod and not b_pod:
        return changes
    a_phase = (a_pod or {}).get("phase")
    b_phase = (b_pod or {}).get("phase")
    if a_phase != b_phase:
        changes.append({
            "type": "pod_phase",
            "path": f"{prefix}.status.phase" if prefix else "pod.status.phase",
            "before": a_phase,
            "after": b_phase,
            "impact": f"Pod phase changed from {a_phase} to {b_phase}",
        })
    a_cond = (a_pod or {}).get("conditions") or []
    b_cond = (b_pod or {}).get("conditions") or []
    a_by_type = {c.get("type"): c for c in a_cond if c.get("type")}
    b_by_type = {c.get("type"): c for c in b_cond if c.get("type")}
    for ctype, b_c in b_by_type.items():
        a_c = a_by_type.get(ctype)
        if a_c != b_c:
            path = f"{prefix}.status.conditions[{ctype}]" if prefix else f"pod.status.conditions[{ctype}]"
            changes.append({
                "type": "condition",
                "path": path,
                "before": a_c,
                "after": b_c,
                "impact": f"Condition {ctype}: {a_c.get('status') if a_c else 'N/A'} -> {b_c.get('status')}",
            })
    return changes


def _diff_container_statuses(
    a_ev: dict[str, Any],
    b_ev: dict[str, Any],
    prefix: str,
) -> list[dict[str, Any]]:
    """Diff containerStatuses: restartCount, state, lastState."""
    changes: list[dict[str, Any]] = []
    a_status = _deep_get(a_ev, f"{prefix}.status.containerStatuses") if prefix else (a_ev.get("pod") or {}).get("status", {}).get("containerStatuses") or []
    b_status = _deep_get(b_ev, f"{prefix}.status.containerStatuses") if prefix else (b_ev.get("pod") or {}).get("status", {}).get("containerStatuses") or []
    a_by_name = {s.get("name"): s for s in a_status if s.get("name")}
    b_by_name = {s.get("name"): s for s in b_status if s.get("name")}
    for name, b_s in b_by_name.items():
        a_s = a_by_name.get(name)
        base_path = f"{prefix}.status.containerStatuses[{name}]" if prefix else f"pod.status.containerStatuses[{name}]"
        if a_s is None:
            changes.append({
                "type": "container_added",
                "path": base_path,
                "before": None,
                "after": b_s,
                "impact": f"Container {name} appeared or was not previously reported",
            })
            continue
        if (a_s.get("restartCount") or 0) != (b_s.get("restartCount") or 0):
            changes.append({
                "type": "restart_count",
                "path": f"{base_path}.restartCount",
                "before": a_s.get("restartCount"),
                "after": b_s.get("restartCount"),
                "impact": f"Container {name} restart count: {a_s.get('restartCount')} -> {b_s.get('restartCount')}",
            })
        if a_s.get("state") != b_s.get("state"):
            changes.append({
                "type": "container_state",
                "path": f"{base_path}.state",
                "before": a_s.get("state"),
                "after": b_s.get("state"),
                "impact": f"Container {name} state changed",
            })
        if a_s.get("lastState") != b_s.get("lastState"):
            changes.append({
                "type": "last_state",
                "path": f"{base_path}.lastState",
                "before": a_s.get("lastState"),
                "after": b_s.get("lastState"),
                "impact": f"Container {name} last termination/running state changed",
            })
    return changes


def _diff_events(a_ev: dict[str, Any], b_ev: dict[str, Any]) -> list[dict[str, Any]]:
    """New or changed events in B (e.g. new warnings). Uses pod_events or workload_events."""
    changes: list[dict[str, Any]] = []
    for key in ("pod_events", "workload_events", "node_events"):
        a_list = a_ev.get(key) or []
        b_list = b_ev.get(key) or []
        if len(b_list) > len(a_list):
            new_events = b_list[len(a_list):]
            for i, e in enumerate(new_events):
                if isinstance(e, dict) and (e.get("type") == "Warning" or e.get("reason")):
                    changes.append({
                        "type": "event",
                        "path": f"{key}[{len(a_list) + i}]",
                        "before": None,
                        "after": e,
                        "impact": f"New event: {e.get('reason', '')} - {e.get('message', '')[:100]}",
                    })
    return changes


def _diff_resources(a_ev: dict[str, Any], b_ev: dict[str, Any]) -> list[dict[str, Any]]:
    """Diff resource requests/limits if present in evidence (pod.spec.containers or workload)."""
    changes: list[dict[str, Any]] = []
    a_pod = a_ev.get("pod") or {}
    b_pod = b_ev.get("pod") or {}
    a_containers = (a_pod.get("spec") or {}).get("containers")
    b_containers = (b_pod.get("spec") or {}).get("containers")
    if not isinstance(a_containers, list) or not isinstance(b_containers, list):
        return changes
    a_by_name = {c.get("name"): c for c in a_containers if isinstance(c, dict) and c.get("name")}
    b_by_name = {c.get("name"): c for c in b_containers if isinstance(c, dict) and c.get("name")}
    for name, b_c in b_by_name.items():
        a_c = a_by_name.get(name)
        a_res = (a_c or {}).get("resources") or {}
        b_res = (b_c or {}).get("resources") or {}
        if a_res != b_res:
            changes.append({
                "type": "resources",
                "path": f"pod.spec.containers[{name}].resources",
                "before": a_res,
                "after": b_res,
                "impact": f"Container {name} resources (requests/limits) changed",
            })
    return changes


def _diff_analysis_json(a_json: dict[str, Any], b_json: dict[str, Any]) -> list[dict[str, Any]]:
    """Structured diff of analysis_json (summary, kubectl_commands, etc.)."""
    changes: list[dict[str, Any]] = []
    if (a_json.get("summary") or "") != (b_json.get("summary") or ""):
        changes.append({
            "type": "summary",
            "path": "analysis_json.summary",
            "before": (a_json.get("summary") or "")[:200],
            "after": (b_json.get("summary") or "")[:200],
            "impact": "Summary changed",
        })
    a_cmds = a_json.get("kubectl_commands") or []
    b_cmds = b_json.get("kubectl_commands") or []
    if a_cmds != b_cmds:
        changes.append({
            "type": "kubectl_commands",
            "path": "analysis_json.kubectl_commands",
            "before": a_cmds,
            "after": b_cmds,
            "impact": "Suggested kubectl commands changed",
        })
    return changes


def compute_diffs(
    analysis_a: dict[str, Any],
    analysis_b: dict[str, Any],
) -> list[dict[str, Any]]:
    """
    Compute deterministic diffs between two analyses.
    Each analysis dict must have: analysis_json, evidence_summary (str), and metadata (id, created_at, kind, name, namespace).
    Returns list of { type, path, before, after, impact }.
    """
    a_ev = _parse_evidence(analysis_a.get("evidence_summary"))
    b_ev = _parse_evidence(analysis_b.get("evidence_summary"))
    a_json = analysis_a.get("analysis_json") or {}
    b_json = analysis_b.get("analysis_json") or {}

    changes: list[dict[str, Any]] = []

    # Pod (single-pod or first problematic pod)
    changes.extend(_diff_pod_phase_and_conditions(a_ev, b_ev, ""))
    changes.extend(_diff_container_statuses(a_ev, b_ev, ""))

    # Problematic pods (workload evidence)
    a_problematic = a_ev.get("problematic_pods_evidence") or []
    b_problematic = b_ev.get("problematic_pods_evidence") or []
    for i in range(max(len(a_problematic), len(b_problematic))):
        a_p = a_problematic[i] if i < len(a_problematic) else {}
        b_p = b_problematic[i] if i < len(b_problematic) else {}
        if not a_p and not b_p:
            continue
        changes.extend(_diff_pod_phase_and_conditions({"pod": a_p.get("pod")}, {"pod": b_p.get("pod")}, ""))
        changes.extend(_diff_container_statuses({"pod": a_p.get("pod")}, {"pod": b_p.get("pod")}, ""))

    changes.extend(_diff_events(a_ev, b_ev))
    changes.extend(_diff_resources(a_ev, b_ev))
    changes.extend(_diff_analysis_json(a_json, b_json))

    # Node conditions if present
    a_node = a_ev.get("node") or {}
    b_node = b_ev.get("node") or {}
    if a_node or b_node:
        a_cond = a_node.get("conditions") or []
        b_cond = b_node.get("conditions") or []
        a_by_type = {c.get("type"): c for c in a_cond if c.get("type")}
        b_by_type = {c.get("type"): c for c in b_cond if c.get("type")}
        for ctype, b_c in b_by_type.items():
            a_c = a_by_type.get(ctype)
            if a_c != b_c:
                changes.append({
                    "type": "node_condition",
                    "path": f"node.conditions[{ctype}]",
                    "before": a_c,
                    "after": b_c,
                    "impact": f"Node condition {ctype} changed",
                })

    return changes
