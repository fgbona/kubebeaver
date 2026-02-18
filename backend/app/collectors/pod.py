"""Collect evidence for a single Pod."""
from __future__ import annotations

import logging
from typing import Any

from kubernetes.client.rest import ApiException

from app.k8s_client import get_core_v1
from app.sanitize import truncate_log_lines

logger = logging.getLogger(__name__)


def _serialize_pod(pod: Any) -> dict[str, Any]:
    """Convert pod object to dict for evidence."""
    if pod is None:
        return {}
    return {
        "metadata": {
            "name": pod.metadata.name,
            "namespace": pod.metadata.namespace,
            "labels": dict(pod.metadata.labels or {}),
            "creationTimestamp": str(pod.metadata.creation_timestamp) if pod.metadata.creation_timestamp else None,
        },
        "spec": {
            "nodeName": getattr(pod.spec, "node_name", None),
            "containers": [c.name for c in (pod.spec.containers or [])],
            "restartPolicy": getattr(pod.spec, "restart_policy", None),
        },
        "status": {
            "phase": pod.status.phase if pod.status else None,
            "conditions": [
                {"type": c.type, "status": c.status, "reason": getattr(c, "reason", None), "message": getattr(c, "message", None)}
                for c in (pod.status.conditions or [])
            ] if pod.status else [],
            "containerStatuses": [
                {
                    "name": cs.name,
                    "ready": cs.ready,
                    "restartCount": cs.restart_count,
                    "state": _container_state(cs.state),
                    "lastState": _container_state(cs.last_state) if cs.last_state else None,
                }
                for cs in (pod.status.container_statuses or [])
            ] if pod.status else [],
        },
    }


def _container_state(state: Any) -> dict[str, Any] | None:
    if not state:
        return None
    if state.waiting:
        return {"waiting": {"reason": state.waiting.reason, "message": getattr(state.waiting, "message", None)}}
    if state.terminated:
        return {"terminated": {"reason": state.terminated.reason, "exitCode": state.terminated.exit_code}}
    if state.running:
        return {"running": {"startedAt": str(state.running.started_at) if state.running.started_at else None}}
    return None


def collect_pod(
    namespace: str,
    name: str,
    context: str | None,
    include_previous_logs: bool,
    max_log_lines: int,
    max_events: int,
) -> dict[str, Any]:
    core = get_core_v1(context)
    evidence: dict[str, Any] = {
        "target": {"kind": "Pod", "namespace": namespace, "name": name},
        "pod": {},
        "pod_events": [],
        "pod_logs": {},
        "previous_logs": {},
        "error": None,
    }
    try:
        pod = core.read_namespaced_pod(name=name, namespace=namespace)
        evidence["pod"] = _serialize_pod(pod)
    except ApiException as e:
        evidence["error"] = f"read pod: {e.reason} ({e.status})"
        if e.status == 403:
            evidence["error"] += " (insufficient RBAC - need get pods, list events, get log)"
        return evidence
    except Exception as e:
        evidence["error"] = str(e)
        return evidence

    # Events for this pod
    try:
        events = core.list_namespaced_event(
            namespace=namespace,
            field_selector=f"involvedObject.name={name},involvedObject.namespace={namespace}",
            limit=max_events,
        )
        evidence["pod_events"] = [
            {
                "type": e.type,
                "reason": e.reason,
                "message": e.message,
                "count": e.count,
                "lastTimestamp": str(e.last_timestamp) if e.last_timestamp else None,
            }
            for e in (events.items or [])
        ]
    except ApiException as e:
        evidence["pod_events"] = [{"error": f"list events: {e.reason}"}]
    except Exception as e:
        evidence["pod_events"] = [{"error": str(e)}]

    # Logs per container
    for c in (pod.spec.containers or []):
        cname = c.name
        try:
            log_stream = core.read_namespaced_pod_log(
                name=name,
                namespace=namespace,
                container=cname,
                tail_lines=max_log_lines,
                previous=False,
            )
            lines = (log_stream or "").splitlines()
            evidence["pod_logs"][cname] = truncate_log_lines(lines, max_log_lines)
        except ApiException as e:
            evidence["pod_logs"][cname] = [f"[LOG_ERROR] {e.reason}"]
        if include_previous_logs:
            try:
                prev = core.read_namespaced_pod_log(
                    name=name,
                    namespace=namespace,
                    container=cname,
                    tail_lines=max_log_lines,
                    previous=True,
                )
                evidence["previous_logs"][cname] = truncate_log_lines((prev or "").splitlines(), max_log_lines)
            except ApiException:
                evidence["previous_logs"][cname] = []

    return evidence
