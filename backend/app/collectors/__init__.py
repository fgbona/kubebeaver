"""Collectors dispatch by target kind and return evidence dict."""
from app.collectors.pod import collect_pod
from app.collectors.workload import (
    collect_deployment,
    collect_statefulset,
    collect_daemonset,
    collect_replicaset,
    collect_job,
    collect_cronjob,
)
from app.collectors.node import collect_node

__all__ = ["collect_evidence"]


def collect_evidence(
    kind: str,
    namespace: str | None,
    name: str,
    context: str | None,
    include_previous_logs: bool,
    max_log_lines: int,
    max_events: int,
    max_pods: int,
) -> dict:
    if kind == "Pod":
        return collect_pod(
            namespace=namespace or "default",
            name=name,
            context=context,
            include_previous_logs=include_previous_logs,
            max_log_lines=max_log_lines,
            max_events=max_events,
        )
    if kind == "Deployment":
        return collect_deployment(
            namespace=namespace or "default",
            name=name,
            context=context,
            include_previous_logs=include_previous_logs,
            max_log_lines=max_log_lines,
            max_events=max_events,
            max_pods=max_pods,
        )
    if kind == "StatefulSet":
        return collect_statefulset(
            namespace=namespace or "default",
            name=name,
            context=context,
            include_previous_logs=include_previous_logs,
            max_log_lines=max_log_lines,
            max_events=max_events,
            max_pods=max_pods,
        )
    if kind == "DaemonSet":
        return collect_daemonset(
            namespace=namespace or "default",
            name=name,
            context=context,
            include_previous_logs=include_previous_logs,
            max_log_lines=max_log_lines,
            max_events=max_events,
            max_pods=max_pods,
        )
    if kind == "ReplicaSet":
        return collect_replicaset(
            namespace=namespace or "default",
            name=name,
            context=context,
            include_previous_logs=include_previous_logs,
            max_log_lines=max_log_lines,
            max_events=max_events,
            max_pods=max_pods,
        )
    if kind == "Job":
        return collect_job(
            namespace=namespace or "default",
            name=name,
            context=context,
            include_previous_logs=include_previous_logs,
            max_log_lines=max_log_lines,
            max_events=max_events,
            max_pods=max_pods,
        )
    if kind == "CronJob":
        return collect_cronjob(
            namespace=namespace or "default",
            name=name,
            context=context,
            include_previous_logs=include_previous_logs,
            max_log_lines=max_log_lines,
            max_events=max_events,
            max_pods=max_pods,
        )
    if kind == "Node":
        return collect_node(name=name, context=context, max_events=max_events)
    return {"error": f"Unknown kind: {kind}"}
