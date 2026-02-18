"""Kubernetes API client wrapper with in-cluster and kubeconfig support."""
from __future__ import annotations

import logging
from typing import Any

from kubernetes import client, config
from kubernetes.client.rest import ApiException
from kubernetes.config.config_exception import ConfigException

from app.config import settings

logger = logging.getLogger(__name__)

# Load once; can be refreshed if needed
_core_v1: client.CoreV1Api | None = None
_apps_v1: client.AppsV1Api | None = None
_metrics_available: bool | None = None


def _load_config(context: str | None = None) -> None:
    global _core_v1, _apps_v1
    try:
        if settings.in_cluster:
            config.load_incluster_config()
            logger.info("Loaded in-cluster Kubernetes config")
        else:
            config.load_kube_config(context=context)
            logger.info("Loaded kubeconfig", extra={"context": context})
    except ConfigException as e:
        logger.warning("Kubernetes config not available: %s", e)
        raise
    _core_v1 = client.CoreV1Api()
    _apps_v1 = client.AppsV1Api()


def get_core_v1(context: str | None = None) -> client.CoreV1Api:
    if _core_v1 is None:
        _load_config(context)
    assert _core_v1 is not None
    return _core_v1


def get_apps_v1(context: str | None = None) -> client.AppsV1Api:
    if _apps_v1 is None:
        _load_config(context)
    assert _apps_v1 is not None
    return _apps_v1


def list_contexts() -> list[dict[str, str]]:
    """Return list of {name, current} for each context. In-cluster returns single entry."""
    if settings.in_cluster:
        return [{"name": "in-cluster", "current": True}]
    try:
        ctx_list, active_ctx = config.list_kube_config_contexts()
        current_name = active_ctx.get("name") if active_ctx and isinstance(active_ctx, dict) else None
        return [
            {"name": c["name"], "current": c["name"] == current_name}
            for c in (ctx_list or [])
        ]
    except (ConfigException, Exception) as e:
        logger.exception("Failed to list contexts: %s", e)
        return []


def list_namespaces(context: str | None = None) -> list[str]:
    try:
        core = get_core_v1(context)
        ret = core.list_namespace(limit=500)
        return [ns.metadata.name for ns in ret.items]
    except ApiException as e:
        logger.warning("list_namespaces API error: %s", e.reason)
        raise
    except Exception as e:
        logger.exception("list_namespaces failed: %s", e)
        raise


def list_resources(
    kind: str,
    namespace: str | None,
    context: str | None = None,
) -> list[dict[str, Any]]:
    """List resources by kind. namespace required for Pod/Deployment/StatefulSet; optional for Node."""
    core = get_core_v1(context)
    apps = get_apps_v1(context)
    result: list[dict[str, Any]] = []
    try:
        if kind == "Pod":
            if not namespace:
                return []
            ret = core.list_namespaced_pod(namespace=namespace, limit=500)
            for p in ret.items:
                result.append({"name": p.metadata.name, "namespace": namespace, "kind": "Pod"})
        elif kind == "Deployment":
            if not namespace:
                return []
            ret = apps.list_namespaced_deployment(namespace=namespace, limit=500)
            for d in ret.items:
                result.append({"name": d.metadata.name, "namespace": namespace, "kind": "Deployment"})
        elif kind == "StatefulSet":
            if not namespace:
                return []
            ret = apps.list_namespaced_stateful_set(namespace=namespace, limit=500)
            for s in ret.items:
                result.append({"name": s.metadata.name, "namespace": namespace, "kind": "StatefulSet"})
        elif kind == "Node":
            ret = core.list_node(limit=500)
            for n in ret.items:
                result.append({"name": n.metadata.name, "namespace": None, "kind": "Node"})
        else:
            return []
    except ApiException as e:
        logger.warning("list_resources API error: %s", e.reason)
        raise
    return result


def check_connection(context: str | None = None) -> bool:
    try:
        get_core_v1(context)
        core = get_core_v1(context)
        core.list_namespace(limit=1)
        return True
    except Exception:
        return False
