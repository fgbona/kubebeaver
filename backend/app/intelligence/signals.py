"""Deterministic signal extraction from collected Kubernetes evidence."""
from __future__ import annotations

from typing import Any

_IMAGE_PULL_REASONS = {"ImagePullBackOff", "ErrImagePull"}
_FAILED_SCHEDULING_REASONS = {"FailedScheduling"}


def extract_signals(evidence: dict[str, Any]) -> dict[str, Any]:
    """Extract boolean + numeric signals from collected evidence.

    Returns a flat dict with:
    - crash_loop_back_off: bool
    - image_pull_back_off: bool
    - oom_killed: bool
    - unschedulable: bool
    - restart_count: int (total across all containers)
    - node_not_ready: bool
    - replica_mismatch: bool
    - warning_event_count: int
    """
    crash_loop = False
    image_pull = False
    oom_killed = False
    unschedulable = False
    restart_count = 0

    pod = evidence.get("pod") or {}
    pod_status = pod.get("status") or {}
    container_statuses = pod_status.get("containerStatuses") or []

    for cs in container_statuses:
        count = cs.get("restartCount")
        if isinstance(count, int) and count >= 0:
            restart_count += count

        state = cs.get("state") or {}
        waiting = state.get("waiting") or {}
        waiting_reason = (waiting.get("reason") or "").strip()

        if waiting_reason == "CrashLoopBackOff":
            crash_loop = True
        if waiting_reason in _IMAGE_PULL_REASONS:
            image_pull = True

        last_state = cs.get("lastState") or {}
        terminated = last_state.get("terminated") or {}
        terminated_reason = (terminated.get("reason") or "").strip()
        if terminated_reason == "OOMKilled":
            oom_killed = True

    warning_event_count = 0
    for event_key in (
        "pod_events", "deployment_events", "statefulset_events",
        "daemonset_events", "replicaset_events", "job_events", "node_events",
    ):
        for ev in evidence.get(event_key) or []:
            if not isinstance(ev, dict):
                continue
            if (ev.get("type") or "").upper() == "WARNING":
                warning_event_count += 1
            reason = (ev.get("reason") or "").strip()
            if reason in _FAILED_SCHEDULING_REASONS:
                unschedulable = True

    replica_mismatch = False
    for workload_key in ("deployment", "statefulset", "daemonset", "replicaset"):
        workload = evidence.get(workload_key) or {}
        if not workload:
            continue
        spec = workload.get("spec") or {}
        status = workload.get("status") or {}
        desired = spec.get("replicas")
        if desired is None:
            continue
        ready = status.get("readyReplicas") or 0
        if desired > 0 and ready < desired:
            replica_mismatch = True

    node_not_ready = False
    node = evidence.get("node") or {}
    node_status = node.get("status") or {}
    for condition in node_status.get("conditions") or []:
        if isinstance(condition, dict):
            if condition.get("type") == "Ready" and condition.get("status") != "True":
                node_not_ready = True

    return {
        "crash_loop_back_off": crash_loop,
        "image_pull_back_off": image_pull,
        "oom_killed": oom_killed,
        "unschedulable": unschedulable,
        "restart_count": restart_count,
        "node_not_ready": node_not_ready,
        "replica_mismatch": replica_mismatch,
        "warning_event_count": warning_event_count,
    }
