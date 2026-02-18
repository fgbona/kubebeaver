"""Cluster health scanner: collect failure signals and produce prioritized findings."""
from __future__ import annotations

import json
import logging
import uuid
from datetime import datetime, timezone
from typing import Any

from kubernetes.client.rest import ApiException

from app.config import settings
from app.k8s_client import get_core_v1, get_apps_v1
from app.sanitize import sanitize_evidence, truncate_evidence_for_llm

logger = logging.getLogger(__name__)

# Severity order for sorting (higher = more severe)
SEVERITY_ORDER = {"critical": 4, "high": 3, "medium": 2, "low": 1, "info": 0}

# Max evidence snippet chars per finding
EVIDENCE_SNIPPET_MAX_CHARS = 2000


def _now_iso() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def _ref(kind: str, namespace: str | None, name: str) -> dict[str, str]:
    ref: dict[str, str] = {"kind": kind, "name": name}
    if namespace:
        ref["namespace"] = namespace
    return ref


def _pod_pending_minutes(pod: Any) -> float | None:
    """Return minutes in Pending if phase is Pending, else None."""
    if not pod or not getattr(pod, "status", None):
        return None
    if getattr(pod.status, "phase", None) != "Pending":
        return None
    created = getattr(pod.metadata, "creation_timestamp", None) if getattr(pod, "metadata", None) else None
    if not created:
        return None
    try:
        delta = datetime.now(timezone.utc) - created
        return delta.total_seconds() / 60.0
    except Exception:
        return None


def classify_pod_finding(
    *,
    waiting_reason: str | None,
    terminated_reason: str | None,
    phase: str | None,
    pending_minutes: float | None,
    container_name: str | None = None,
) -> tuple[str, str, str, str]:
    """
    Classify pod status into severity, category, title, description.
    Returns (severity, category, title, description).
    """
    suffix = f" (container: {container_name})" if container_name else ""
    # Terminated reasons
    if terminated_reason == "OOMKilled":
        return (
            "high",
            "resources",
            "Pod container OOMKilled",
            f"Container was killed by OOM{suffix}. Consider increasing memory limit or request.",
        )
    if terminated_reason:
        return (
            "medium",
            "crash",
            f"Pod container terminated: {terminated_reason}",
            f"Container exited with reason {terminated_reason}{suffix}. Check logs and events.",
        )
    # Waiting reasons
    if waiting_reason in ("ImagePullBackOff", "ErrImagePull"):
        return (
            "high",
            "image",
            "Image pull failed",
            f"Pod cannot pull image ({waiting_reason}){suffix}. Check image name, tag, and pull secrets.",
        )
    if waiting_reason == "CrashLoopBackOff":
        return (
            "high",
            "crash",
            "Pod in CrashLoopBackOff",
            f"Container is crashing and restarting{suffix}. Check logs and application config.",
        )
    if waiting_reason:
        return (
            "low",
            "scheduling",
            f"Pod waiting: {waiting_reason}",
            f"Container is in waiting state ({waiting_reason}){suffix}.",
        )
    # Pending phase
    if phase == "Pending" and pending_minutes is not None and pending_minutes >= settings.scan_pending_minutes:
        return (
            "medium",
            "scheduling",
            "Pod Pending too long",
            f"Pod has been Pending for {int(pending_minutes)}+ minutes. Check scheduler, resources, and node availability.",
        )
    if phase == "Pending":
        return (
            "info",
            "scheduling",
            "Pod Pending",
            "Pod is in Pending state. May be normal if recently created.",
        )
    return ("info", "unknown", "Pod status", "Pod has non-ready or unknown status.")


def classify_node_findings(node: Any) -> list[tuple[str, str, str, str]]:
    """
    From a Node API object, return list of (severity, category, title, description).
    """
    findings: list[tuple[str, str, str, str]] = []
    name = getattr(getattr(node, "metadata", None), "name", None) or "unknown"
    conditions = getattr(getattr(node, "status", None), "conditions", None) or []
    condition_map = {c.type: c for c in conditions}

    for cond_type, cond in condition_map.items():
        if getattr(cond, "status", None) != "True":
            continue
        if cond_type == "Ready":
            continue
        if cond_type == "MemoryPressure":
            findings.append((
                "high",
                "node",
                "Node under MemoryPressure",
                f"Node {name} has MemoryPressure. Pods may be evicted or fail to schedule.",
            ))
        elif cond_type == "DiskPressure":
            findings.append((
                "high",
                "node",
                "Node under DiskPressure",
                f"Node {name} has DiskPressure. Check disk usage and consider expanding or cleaning.",
            ))
        elif cond_type == "PIDPressure":
            findings.append((
                "medium",
                "node",
                "Node under PIDPressure",
                f"Node {name} has PIDPressure. Process count is high.",
            ))
        else:
            findings.append((
                "low",
                "node",
                f"Node condition: {cond_type}",
                f"Node {name} condition {cond_type} is True.",
            ))

    ready = condition_map.get("Ready")
    if ready and getattr(ready, "status", None) != "True":
        findings.append((
            "critical",
            "node",
            "Node NotReady",
            f"Node {name} is not Ready. Workloads may not schedule or run correctly.",
        ))
    return findings


def _occurred_at_from_node(node: Any) -> str | None:
    """Extract last transition time from node conditions. Returns ISO string or None."""
    conditions = getattr(getattr(node, "status", None), "conditions", None) or []
    best = None
    for c in conditions:
        t = getattr(c, "last_transition_time", None)
        if t:
            try:
                s = t.isoformat() if hasattr(t, "isoformat") else str(t)
                if s and (best is None or s > best):
                    best = s
            except Exception:
                pass
    if best and "+" not in best and not best.endswith("Z"):
        best = best + "Z"
    return best


def classify_replica_mismatch(
    kind: str,
    namespace: str,
    name: str,
    desired: int,
    ready: int,
) -> tuple[str, str, str, str]:
    """Replica count mismatch for Deployment/StatefulSet."""
    severity = "high" if desired > 0 and ready == 0 else "medium"
    return (
        severity,
        "config",
        f"{kind} replica mismatch",
        f"{kind} {namespace}/{name}: desired={desired}, ready={ready}. Check pod status and events.",
    )


def _suggested_commands_pod(namespace: str, name: str, kind_hint: str) -> list[str]:
    cmds = [
        f"kubectl get pod -n {namespace} {name} -o wide",
        f"kubectl describe pod -n {namespace} {name}",
        f"kubectl logs -n {namespace} {name} --tail=100",
    ]
    if kind_hint == "image":
        cmds.append(f"kubectl get pod -n {namespace} {name} -o jsonpath='{{.status.containerStatuses}}'")
    return cmds


def _suggested_commands_node(name: str) -> list[str]:
    return [
        f"kubectl describe node {name}",
        f"kubectl get node {name} -o wide",
    ]


def _suggested_commands_workload(kind: str, namespace: str, name: str) -> list[str]:
    return [
        f"kubectl get {kind.lower()} -n {namespace} {name} -o wide",
        f"kubectl describe {kind.lower()} -n {namespace} {name}",
        f"kubectl get pods -n {namespace} -l app.kubernetes.io/name={name} 2>/dev/null || kubectl get pods -n {namespace}",
    ]


def _occurred_at_from_container_status(cs: Any, pod: Any) -> str | None:
    """Extract when the issue happened from container status or pod metadata. Returns ISO string or None."""
    def to_iso(dt: Any) -> str | None:
        if dt is None:
            return None
        try:
            if hasattr(dt, "isoformat"):
                s = dt.isoformat()
                return s + "Z" if not s.endswith("Z") and "+" not in s else s
            return str(dt)
        except Exception:
            return None
    # Prefer terminated time (crash/finish), then running started, then pod creation
    if cs and getattr(cs, "last_state", None):
        term = getattr(cs.last_state, "terminated", None)
        if term:
            t = getattr(term, "finished_at", None) or getattr(term, "started_at", None)
            if t:
                return to_iso(t)
    if cs and getattr(cs, "state", None):
        term = getattr(cs.state, "terminated", None)
        if term:
            t = getattr(term, "finished_at", None) or getattr(term, "started_at", None)
            if t:
                return to_iso(t)
        run = getattr(cs.state, "running", None)
        if run:
            t = getattr(run, "started_at", None)
            if t:
                return to_iso(t)
    if pod and getattr(pod, "metadata", None):
        t = getattr(pod.metadata, "creation_timestamp", None)
        if t:
            return to_iso(t)
    return None


def run_scan(
    context: str | None,
    scope: str,
    namespace: str | None,
    include_logs: bool,
) -> tuple[list[dict[str, Any]], str | None, str | None]:
    """
    Run cluster/namespace health scan. Returns (findings, summary_markdown, error).
    On RBAC/API errors, returns partial findings and error message.
    """
    core = get_core_v1(context)
    apps = get_apps_v1(context)
    max_findings = settings.scan_max_findings
    pending_min = settings.scan_pending_minutes
    findings: list[dict[str, Any]] = []
    errors: list[str] = []
    evidence_store: dict[str, str] = {}  # ref_id -> truncated snippet

    def add_finding(
        severity: str,
        category: str,
        title: str,
        description: str,
        affected_refs: list[dict],
        evidence_refs: list[str],
        suggested_commands: list[str],
        evidence_snippet: str | None = None,
        occurred_at: str | None = None,
    ) -> None:
        if len(findings) >= max_findings:
            return
        findings.append({
            "severity": severity,
            "category": category,
            "title": title,
            "description": description,
            "affected_refs": affected_refs,
            "evidence_refs": evidence_refs,
            "suggested_commands": suggested_commands,
            "evidence_snippet": evidence_snippet,
            "occurred_at": occurred_at,
        })

    # ---- Pods ----
    try:
        if scope == "namespace" and namespace:
            pod_list = core.list_namespaced_pod(namespace=namespace, limit=500)
        else:
            pod_list = core.list_pod_for_all_namespaces(limit=1000)
        pods = pod_list.items or []
    except ApiException as e:
        errors.append(f"list pods: {e.reason} (RBAC or scope)")
        pods = []

    for pod in pods:
        if len(findings) >= max_findings:
            break
        ns = pod.metadata.namespace
        name = pod.metadata.name
        phase = getattr(pod.status, "phase", None) if pod.status else None
        pending_minutes = _pod_pending_minutes(pod)
        for cs in (pod.status.container_statuses or []) if pod.status else []:
            waiting_reason = None
            terminated_reason = None
            if cs.state and getattr(cs.state, "waiting", None):
                waiting_reason = getattr(cs.state.waiting, "reason", None)
            if cs.state and getattr(cs.state, "terminated", None):
                terminated_reason = getattr(cs.state.terminated, "reason", None)
            if cs.last_state and getattr(cs.last_state, "terminated", None):
                terminated_reason = getattr(cs.last_state.terminated, "reason", None)
            if waiting_reason or terminated_reason or (phase == "Pending" and (pending_minutes is None or pending_minutes >= pending_min)):
                sev, cat, tit, desc = classify_pod_finding(
                    waiting_reason=waiting_reason,
                    terminated_reason=terminated_reason,
                    phase=phase,
                    pending_minutes=pending_minutes,
                    container_name=cs.name,
                )
                ref_id = f"pod-{ns}-{name}-{cs.name}"
                evidence_snippet = None
                if include_logs and (cat in ("crash", "resources", "image")):
                    try:
                        log_stream = core.read_namespaced_pod_log(
                            name=name, namespace=ns, container=cs.name, tail_lines=30, previous=(cat == "crash"),
                        )
                        lines = (log_stream or "").splitlines()
                        from app.sanitize import truncate_log_lines
                        lines = truncate_log_lines(lines, 20)
                        raw = {"pod_logs": {cs.name: lines}}
                        sanitized = sanitize_evidence(raw)
                        truncated, _ = truncate_evidence_for_llm(sanitized, EVIDENCE_SNIPPET_MAX_CHARS)
                        evidence_snippet = json.dumps(truncated, default=str)[:EVIDENCE_SNIPPET_MAX_CHARS]
                    except ApiException:
                        evidence_snippet = "[Logs not available - check RBAC]"
                    evidence_store[ref_id] = evidence_snippet or ""
                occurred_at = _occurred_at_from_container_status(cs, pod)
                add_finding(
                    severity=sev,
                    category=cat,
                    title=tit,
                    description=desc,
                    affected_refs=[_ref("Pod", ns, name)],
                    evidence_refs=[ref_id] if evidence_snippet else [],
                    suggested_commands=_suggested_commands_pod(ns, name, cat),
                    evidence_snippet=evidence_snippet,
                    occurred_at=occurred_at,
                )
        # No container status but pod Pending
        if not (pod.status and pod.status.container_statuses) and phase == "Pending" and pending_minutes is not None and pending_minutes >= pending_min:
            sev, cat, tit, desc = classify_pod_finding(phase=phase, pending_minutes=pending_minutes, waiting_reason=None, terminated_reason=None)
            add_finding(
                severity=sev,
                category=cat,
                title=tit,
                description=desc,
                affected_refs=[_ref("Pod", ns, name)],
                evidence_refs=[],
                suggested_commands=_suggested_commands_pod(ns, name, "scheduling"),
                evidence_snippet=None,
                occurred_at=_occurred_at_from_container_status(None, pod),
            )

    # ---- Deployments / StatefulSets ----
    if scope == "namespace" and namespace:
        namespaces_to_scan = [namespace]
    else:
        try:
            ns_list = core.list_namespace(limit=200)
            namespaces_to_scan = [n.metadata.name for n in (ns_list.items or [])]
        except ApiException as e:
            errors.append(f"list namespaces: {e.reason}")
            namespaces_to_scan = list({p.metadata.namespace for p in pods}) if pods else []

    for ns in namespaces_to_scan[:100]:
        if len(findings) >= max_findings:
            break
        try:
            for d in (apps.list_namespaced_deployment(namespace=ns, limit=200).items or []):
                if len(findings) >= max_findings:
                    break
                desired = d.spec.replicas or 0
                ready = d.status.ready_replicas or 0
                if desired != ready:
                    sev, cat, tit, desc = classify_replica_mismatch("Deployment", ns, d.metadata.name, desired, ready)
                    add_finding(
                        severity=sev,
                        category=cat,
                        title=tit,
                        description=desc,
                        affected_refs=[_ref("Deployment", ns, d.metadata.name)],
                        evidence_refs=[],
                        suggested_commands=_suggested_commands_workload("Deployment", ns, d.metadata.name),
                        evidence_snippet=None,
                    )
            for s in (apps.list_namespaced_stateful_set(namespace=ns, limit=200).items or []):
                if len(findings) >= max_findings:
                    break
                desired = s.spec.replicas or 0
                ready = s.status.ready_replicas or 0
                if desired != ready:
                    sev, cat, tit, desc = classify_replica_mismatch("StatefulSet", ns, s.metadata.name, desired, ready)
                    add_finding(
                        severity=sev,
                        category=cat,
                        title=tit,
                        description=desc,
                        affected_refs=[_ref("StatefulSet", ns, s.metadata.name)],
                        evidence_refs=[],
                        suggested_commands=_suggested_commands_workload("StatefulSet", ns, s.metadata.name),
                        evidence_snippet=None,
                    )
        except ApiException as e:
            errors.append(f"list workloads in {ns}: {e.reason}")

    # ---- Nodes ----
    try:
        node_list = core.list_node(limit=500)
        for node in (node_list.items or []):
            if len(findings) >= max_findings:
                break
            for sev, cat, tit, desc in classify_node_findings(node):
                add_finding(
                    severity=sev,
                    category=cat,
                    title=tit,
                    description=desc,
                    affected_refs=[_ref("Node", None, node.metadata.name)],
                    evidence_refs=[],
                    suggested_commands=_suggested_commands_node(node.metadata.name),
                    evidence_snippet=None,
                    occurred_at=_occurred_at_from_node(node),
                )
    except ApiException as e:
        errors.append(f"list nodes: {e.reason}")

    # Sort by severity (critical first)
    findings.sort(key=lambda f: (SEVERITY_ORDER.get(f["severity"], -1), f["title"]), reverse=True)

    # Summary markdown
    counts = {"critical": 0, "high": 0, "medium": 0, "low": 0, "info": 0}
    for f in findings:
        counts[f["severity"]] = counts.get(f["severity"], 0) + 1
    summary_lines = [
        f"## Scan summary ({_now_iso()})",
        f"- **Critical:** {counts['critical']} | **High:** {counts['high']} | **Medium:** {counts['medium']} | **Low:** {counts['low']} | **Info:** {counts['info']}",
        f"- Total findings: {len(findings)}",
    ]
    if errors:
        summary_lines.append("\n**Errors (partial results):**")
        for e in errors:
            summary_lines.append(f"- {e}")
    summary_markdown = "\n".join(summary_lines)
    error_msg = "; ".join(errors) if errors else None
    return findings, summary_markdown, error_msg
