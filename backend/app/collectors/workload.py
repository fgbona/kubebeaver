"""Collect evidence for Deployment, StatefulSet, DaemonSet, ReplicaSet, Job, and CronJob."""
from __future__ import annotations

import logging
from typing import Any

from kubernetes.client.rest import ApiException

from app.k8s_client import get_core_v1, get_apps_v1, get_batch_v1
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


def _serialize_daemonset(d: Any) -> dict[str, Any]:
    return {
        "metadata": {"name": d.metadata.name, "namespace": d.metadata.namespace},
        "spec": {"selector": dict(d.spec.selector.match_labels or {})},
        "status": {
            "desiredNumberScheduled": d.status.desired_number_scheduled or 0,
            "currentNumberScheduled": d.status.current_number_scheduled or 0,
            "numberReady": d.status.number_ready or 0,
            "numberAvailable": d.status.number_available or 0,
            "numberMisscheduled": d.status.number_misscheduled or 0,
        },
    }


def _serialize_replicaset(r: Any) -> dict[str, Any]:
    return {
        "metadata": {"name": r.metadata.name, "namespace": r.metadata.namespace},
        "spec": {"replicas": r.spec.replicas, "selector": dict(r.spec.selector.match_labels or {})},
        "status": {
            "replicas": r.status.replicas or 0,
            "readyReplicas": r.status.ready_replicas or 0,
            "availableReplicas": r.status.available_replicas or 0,
        },
    }


def _serialize_job(j: Any) -> dict[str, Any]:
    return {
        "metadata": {"name": j.metadata.name, "namespace": j.metadata.namespace},
        "spec": {
            "parallelism": j.spec.parallelism or 1,
            "completions": j.spec.completions or 1,
            "backoffLimit": j.spec.backoff_limit or 6,
        },
        "status": {
            "active": j.status.active or 0,
            "succeeded": j.status.succeeded or 0,
            "failed": j.status.failed or 0,
            "conditions": [
                {"type": c.type, "status": c.status, "reason": getattr(c, "reason", None)}
                for c in (j.status.conditions or [])
            ] if j.status else [],
        },
    }


def _serialize_cronjob(c: Any) -> dict[str, Any]:
    return {
        "metadata": {"name": c.metadata.name, "namespace": c.metadata.namespace},
        "spec": {
            "schedule": c.spec.schedule,
            "suspend": c.spec.suspend or False,
        },
        "status": {
            "active": [{"name": a.name, "namespace": a.namespace} for a in (c.status.active or [])],
            "lastScheduleTime": str(c.status.last_schedule_time) if c.status and c.status.last_schedule_time else None,
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


def collect_daemonset(
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
        "target": {"kind": "DaemonSet", "namespace": namespace, "name": name},
        "daemonset": {},
        "workload_events": [],
        "pods_summary": [],
        "problematic_pods_evidence": [],
        "error": None,
    }
    try:
        d = apps.read_namespaced_daemon_set(name=name, namespace=namespace)
        evidence["daemonset"] = _serialize_daemonset(d)
        selector = ",".join(f"{k}={v}" for k, v in (d.spec.selector.match_labels or {}).items())
    except ApiException as e:
        evidence["error"] = f"read daemonset: {e.reason}"
        return evidence

    try:
        events = core.list_namespaced_event(
            namespace=namespace,
            field_selector=f"involvedObject.name={name},involvedObject.kind=DaemonSet",
            limit=max_events,
        )
        evidence["workload_events"] = [
            {"type": e.type, "reason": e.reason, "message": e.message, "count": e.count}
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
                {
                    "name": p.metadata.name,
                    "nodeName": p.spec.node_name,
                    "phase": p.status.phase,
                    "ready": any(c.type == "Ready" and c.status == "True" for c in (p.status.conditions or [])),
                }
                for p in all_pods.items
            ]
        except ApiException:
            pass

    return evidence


def collect_replicaset(
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
        "target": {"kind": "ReplicaSet", "namespace": namespace, "name": name},
        "replicaset": {},
        "workload_events": [],
        "pods_summary": [],
        "problematic_pods_evidence": [],
        "error": None,
    }
    try:
        r = apps.read_namespaced_replica_set(name=name, namespace=namespace)
        evidence["replicaset"] = _serialize_replicaset(r)
        selector = ",".join(f"{k}={v}" for k, v in (r.spec.selector.match_labels or {}).items())
    except ApiException as e:
        evidence["error"] = f"read replicaset: {e.reason}"
        return evidence

    try:
        events = core.list_namespaced_event(
            namespace=namespace,
            field_selector=f"involvedObject.name={name},involvedObject.kind=ReplicaSet",
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


def collect_job(
    namespace: str,
    name: str,
    context: str | None,
    include_previous_logs: bool,
    max_log_lines: int,
    max_events: int,
    max_pods: int,
) -> dict[str, Any]:
    batch = get_batch_v1(context)
    core = get_core_v1(context)
    evidence: dict[str, Any] = {
        "target": {"kind": "Job", "namespace": namespace, "name": name},
        "job": {},
        "workload_events": [],
        "pods_summary": [],
        "problematic_pods_evidence": [],
        "error": None,
    }
    try:
        j = batch.read_namespaced_job(name=name, namespace=namespace)
        evidence["job"] = _serialize_job(j)
        selector = ",".join(f"{k}={v}" for k, v in (j.spec.selector.match_labels or {}).items())
    except ApiException as e:
        evidence["error"] = f"read job: {e.reason}"
        return evidence

    try:
        events = core.list_namespaced_event(
            namespace=namespace,
            field_selector=f"involvedObject.name={name},involvedObject.kind=Job",
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
                {"name": p.metadata.name, "phase": p.status.phase, "restartCount": sum((cs.restart_count or 0) for cs in (p.status.container_statuses or []))}
                for p in all_pods.items
            ]
        except ApiException:
            pass

    return evidence


def collect_cronjob(
    namespace: str,
    name: str,
    context: str | None,
    include_previous_logs: bool,
    max_log_lines: int,
    max_events: int,
    max_pods: int,
) -> dict[str, Any]:
    batch = get_batch_v1(context)
    core = get_core_v1(context)
    evidence: dict[str, Any] = {
        "target": {"kind": "CronJob", "namespace": namespace, "name": name},
        "cronjob": {},
        "workload_events": [],
        "active_jobs": [],
        "error": None,
    }
    try:
        c = batch.read_namespaced_cron_job(name=name, namespace=namespace)
        evidence["cronjob"] = _serialize_cronjob(c)
    except ApiException as e:
        evidence["error"] = f"read cronjob: {e.reason}"
        return evidence

    try:
        events = core.list_namespaced_event(
            namespace=namespace,
            field_selector=f"involvedObject.name={name},involvedObject.kind=CronJob",
            limit=max_events,
        )
        evidence["workload_events"] = [
            {"type": e.type, "reason": e.reason, "message": e.message}
            for e in (events.items or [])
        ]
    except ApiException:
        evidence["workload_events"] = []

    # Collect active jobs
    try:
        jobs = batch.list_namespaced_job(namespace=namespace)
        for j in jobs.items:
            # Check if job is owned by this cronjob
            if any(ref.kind == "CronJob" and ref.name == name for ref in (j.metadata.owner_references or [])):
                evidence["active_jobs"].append({
                    "name": j.metadata.name,
                    "active": j.status.active or 0,
                    "succeeded": j.status.succeeded or 0,
                    "failed": j.status.failed or 0,
                })
    except ApiException:
        pass

    return evidence
