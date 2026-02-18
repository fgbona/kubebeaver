"""Collect evidence for a Node."""
from __future__ import annotations

import logging
from typing import Any

from kubernetes.client.rest import ApiException

from app.k8s_client import get_core_v1

logger = logging.getLogger(__name__)


def collect_node(name: str, context: str | None, max_events: int) -> dict[str, Any]:
    core = get_core_v1(context)
    evidence: dict[str, Any] = {
        "target": {"kind": "Node", "name": name},
        "node": {},
        "node_events": [],
        "pods_on_node": [],
        "error": None,
    }
    try:
        node = core.read_node(name=name)
        evidence["node"] = {
            "metadata": {"name": node.metadata.name},
            "status": {
                "conditions": [
                    {"type": c.type, "status": c.status, "reason": getattr(c, "reason", None), "message": getattr(c, "message", None)}
                    for c in (node.status.conditions or [])
                ] if node.status else [],
                "capacity": dict(node.status.capacity or {}),
                "allocatable": dict(node.status.allocatable or {}),
            },
            "spec": {
                "taints": [{"key": t.key, "value": t.value, "effect": t.effect} for t in (node.spec.taints or [])],
                "unschedulable": getattr(node.spec, "unschedulable", False),
            },
        }
    except ApiException as e:
        evidence["error"] = f"read node: {e.reason}"
        return evidence
    except Exception as e:
        evidence["error"] = str(e)
        return evidence

    try:
        events = core.list_namespaced_event(
            namespace="default",
            field_selector=f"involvedObject.name={name},involvedObject.kind=Node",
            limit=max_events,
        )
        # Node events can be in default ns or cluster-scoped; list_node_events is cluster-scoped in some setups
        evidence["node_events"] = [
            {"type": e.type, "reason": e.reason, "message": e.message, "count": e.count}
            for e in (events.items or [])
        ]
    except ApiException:
        # Try cluster-scoped events if available
        try:
            events = core.list_event_for_all_namespaces(
                field_selector=f"involvedObject.name={name},involvedObject.kind=Node",
                limit=max_events,
            )
            evidence["node_events"] = [
                {"type": e.type, "reason": e.reason, "message": e.message}
                for e in (events.items or [])
            ]
        except ApiException:
            evidence["node_events"] = []

    try:
        all_pods = core.list_pod_for_all_namespaces(field_selector=f"spec.nodeName={name}", limit=20)
        evidence["pods_on_node"] = [
            {"name": p.metadata.name, "namespace": p.metadata.namespace, "phase": p.status.phase}
            for p in (all_pods.items or [])
        ]
    except ApiException:
        evidence["pods_on_node"] = []

    return evidence
