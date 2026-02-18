"""Collect evidence for Deployment and StatefulSet."""
from __future__ import annotations

import logging
from typing import Any

from kubernetes.client.rest import ApiException

from app.k8s_client import get_core_v1, get_apps_v1
from app.collectors.pod import collect_pod
from app.sanitize import truncate_log_lines

logger = logging.getLogger(__name__)


def _serialize_deployment(d: Any) -> dict[str, Any]:
    return {
        "metadata": {"name": d.metadata.name, "namespace": d.metadata.namespace},
        "spec": {
            "replicas": d.spec.replicas,
            "selector": dict(d.spec.selector.match_labels or {}),
        },
        "status": {
            "replicas": d.status.replicas or 0,
            "updatedReplicas": d.status.updated_replicas or 0,
            "readyReplicas": d.status.ready_replicas or 0,
            "availableReplicas": d.status.available_replicas or 0,
            "conditions": [
                {"type": c.type, "status": c.status, "reason": getattr(c, "reason", None)}
                for c in (d.status.conditions or [])
            ] if d.status else [],
        },
    }


def _serialize_statefulset(s: Any) -> dict[str, Any]:
    return {
        "metadata": {"name": s.metadata.name, "namespace": s.metadata.namespace},
        "spec": {"replicas": s.spec.replicas, "selector": dict(s.spec.selector.match_labels or {})},
        "status": {
            "replicas": s.status.replicas or 0,
            "readyReplicas": s.status.ready_replicas or 0,
            "currentReplicas": s.status.current_replicas or 0,
            "updatedReplicas": s.status.updated_replicas or 0,
        },
    }


def _problematic_pods(core: Any, namespace: str, label_selector: str, limit: int) -> list[tuple[str, str]]:
    """Return list of (pod_name, namespace) for pods that are not ready or have restarts."""
    try:
        ret = core.list_namespaced_pod(namespace=namespace, label_selector=label_selector, limit=100)
    except ApiException:
        return []
    candidates: list[tuple[int, str, str]] = []  # (priority, name, ns)
    for p in ret.items:
        name, ns = p.metadata.name, p.metadata.namespace
        priority = 0
        if p.status.phase != "Running":
            priority += 10
        if not (p.status.conditions or any(c.type == "Ready" and c.status == "True" for c in p.status.conditions)):
            priority += 5
        for cs in (p.status.container_statuses or []):
            if (cs.restart_count or 0) > 0:
                priority += 3
            if cs.state and cs.state.waiting and (cs.state.waiting.reason or "").lower() in ("crashloopbackoff", "error"):
                priority += 8
        candidates.append((priority, name, ns))
    candidates.sort(key=lambda x: -x[0])
    return [(name, ns) for _, name, ns in candidates[:limit]]


def collect_deployment(
    namespace: str,
    name: str,
    context: str | None,
    include_previous_logs: bool,
    max_log_lines: int,
    max_events: int,
    max_pods: int,
) -> dict[str, Any]:
    apps = get_apps_v1(context)
    core = get_core_v1(context)
    evidence: dict[str, Any] = {
        "target": {"kind": "Deployment", "namespace": namespace, "name": name},
        "deployment": {},
        "workload_events": [],
        "pods_summary": [],
        "problematic_pods_evidence": [],
        "error": None,
    }
    try:
        d = apps.read_namespaced_deployment(name=name, namespace=namespace)
        evidence["deployment"] = _serialize_deployment(d)
        selector = ",".join(f"{k}={v}" for k, v in (d.spec.selector.match_labels or {}).items())
    except ApiException as e:
        evidence["error"] = f"read deployment: {e.reason}"
        return evidence

    # Workload events
    try:
        events = core.list_namespaced_event(
            namespace=namespace,
            field_selector=f"involvedObject.name={name},involvedObject.kind=Deployment",
            limit=max_events,
        )
        evidence["workload_events"] = [
            {"type": e.type, "reason": e.reason, "message": e.message, "count": e.count}
            for e in (events.items or [])
        ]
    except ApiException:
        evidence["workload_events"] = []

    # Pods and pick problematic ones
    if selector:
        problematic = _problematic_pods(core, namespace, selector, max_pods)
        for pname, pns in problematic:
            pod_ev = collect_pod(
                namespace=pns,
                name=pname,
                context=context,
                include_previous_logs=include_previous_logs,
                max_log_lines=max_log_lines,
                max_events=max_events,
            )
            evidence["problematic_pods_evidence"].append(pod_ev)
        # Summary of all pods
        try:
            all_pods = core.list_namespaced_pod(namespace=namespace, label_selector=selector, limit=50)
            evidence["pods_summary"] = [
                {
                    "name": p.metadata.name,
                    "phase": p.status.phase,
                    "ready": any(c.type == "Ready" and c.status == "True" for c in (p.status.conditions or [])),
                    "restartCount": sum((cs.restart_count or 0) for cs in (p.status.container_statuses or [])),
                }
                for p in all_pods.items
            ]
        except ApiException:
            pass

    return evidence


def collect_statefulset(
    namespace: str,
    name: str,
    context: str | None,
    include_previous_logs: bool,
    max_log_lines: int,
    max_events: int,
    max_pods: int,
) -> dict[str, Any]:
    apps = get_apps_v1(context)
    core = get_core_v1(context)
    evidence: dict[str, Any] = {
        "target": {"kind": "StatefulSet", "namespace": namespace, "name": name},
        "statefulset": {},
        "workload_events": [],
        "pods_summary": [],
        "problematic_pods_evidence": [],
        "error": None,
    }
    try:
        s = apps.read_namespaced_stateful_set(name=name, namespace=namespace)
        evidence["statefulset"] = _serialize_statefulset(s)
        selector = ",".join(f"{k}={v}" for k, v in (s.spec.selector.match_labels or {}).items())
    except ApiException as e:
        evidence["error"] = f"read statefulset: {e.reason}"
        return evidence

    try:
        events = core.list_namespaced_event(
            namespace=namespace,
            field_selector=f"involvedObject.name={name},involvedObject.kind=StatefulSet",
            limit=max_events,
        )
        evidence["workload_events"] = [
            {"type": e.type, "reason": e.reason, "message": e.message}
            for e in (events.items or [])
        ]
    except ApiException:
        evidence["workload_events"] = []

    if selector:
        problematic = _problematic_pods(core, namespace, selector, max_pods)
        for pname, pns in problematic:
            pod_ev = collect_pod(
                namespace=pns,
                name=pname,
                context=context,
                include_previous_logs=include_previous_logs,
                max_log_lines=max_log_lines,
                max_events=max_events,
            )
            evidence["problematic_pods_evidence"].append(pod_ev)
        try:
            all_pods = core.list_namespaced_pod(namespace=namespace, label_selector=selector, limit=50)
            evidence["pods_summary"] = [
                {"name": p.metadata.name, "phase": p.status.phase, "ready": any(c.type == "Ready" and c.status == "True" for c in (p.status.conditions or []))}
                for p in all_pods.items
            ]
        except ApiException:
            pass

    return evidence
