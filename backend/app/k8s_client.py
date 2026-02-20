"""Kubernetes API client wrapper with in-cluster and kubeconfig support."""
from __future__ import annotations

import logging
import urllib3
from typing import Any

from kubernetes import client, config
from kubernetes.client.rest import ApiException
from kubernetes.config.config_exception import ConfigException

from app.config import settings

# Disable SSL warnings for self-signed certificates
urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)

logger = logging.getLogger(__name__)

# Cache clients per context to avoid reloading unnecessarily
_clients_by_context: dict[str | None, tuple[client.CoreV1Api, client.AppsV1Api, client.BatchV1Api]] = {}
_current_context: str | None = None
_metrics_available: bool | None = None


def _load_config(context: str | None = None) -> tuple[client.CoreV1Api, client.AppsV1Api, client.BatchV1Api]:
    """Load Kubernetes config for a specific context and return API clients."""
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

    # Create a configuration with SSL verification disabled for environments with self-signed certificates
    # This is common in internal/development environments (e.g., Rancher)
    configuration = client.Configuration.get_default_copy()
    configuration.verify_ssl = False
    configuration.ssl_ca_cert = None

    # Create API clients with the custom configuration
    api_client = client.ApiClient(configuration)
    core_v1 = client.CoreV1Api(api_client=api_client)
    apps_v1 = client.AppsV1Api(api_client=api_client)
    batch_v1 = client.BatchV1Api(api_client=api_client)
    return core_v1, apps_v1, batch_v1


def get_core_v1(context: str | None = None) -> client.CoreV1Api:
    """Get CoreV1Api client for the specified context. Creates new client if context changed."""
    global _clients_by_context

    # Check if we already have clients for this context
    if context in _clients_by_context:
        core_v1, _, _ = _clients_by_context[context]
        return core_v1

    # Load config and create new clients for this context
    core_v1, apps_v1, batch_v1 = _load_config(context)
    _clients_by_context[context] = (core_v1, apps_v1, batch_v1)
    logger.debug("Created new Kubernetes clients for context: %s", context)
    return core_v1


def get_apps_v1(context: str | None = None) -> client.AppsV1Api:
    """Get AppsV1Api client for the specified context. Creates new client if context changed."""
    global _clients_by_context

    # Check if we already have clients for this context
    if context in _clients_by_context:
        _, apps_v1, _ = _clients_by_context[context]
        return apps_v1

    # Load config and create new clients for this context
    core_v1, apps_v1, batch_v1 = _load_config(context)
    _clients_by_context[context] = (core_v1, apps_v1, batch_v1)
    logger.debug("Created new Kubernetes clients for context: %s", context)
    return apps_v1


def get_batch_v1(context: str | None = None) -> client.BatchV1Api:
    """Get BatchV1Api client for the specified context. Creates new client if context changed."""
    global _clients_by_context

    # Check if we already have clients for this context
    if context in _clients_by_context:
        _, _, batch_v1 = _clients_by_context[context]
        return batch_v1

    # Load config and create new clients for this context
    core_v1, apps_v1, batch_v1 = _load_config(context)
    _clients_by_context[context] = (core_v1, apps_v1, batch_v1)
    logger.debug("Created new Kubernetes clients for context: %s", context)
    return batch_v1


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
        logger.info("list_namespaces called with context=%s", context)
        core = get_core_v1(context)
        ret = core.list_namespace(limit=500)
        namespaces = [ns.metadata.name for ns in ret.items]
        logger.info("list_namespaces returned %d namespaces for context=%s", len(namespaces), context)
        return namespaces
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
    """List resources by kind. namespace required for namespaced resources; not required for Node."""
    core = get_core_v1(context)
    apps = get_apps_v1(context)
    batch = get_batch_v1(context)
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
        elif kind == "DaemonSet":
            if not namespace:
                return []
            ret = apps.list_namespaced_daemon_set(namespace=namespace, limit=500)
            for d in ret.items:
                result.append({"name": d.metadata.name, "namespace": namespace, "kind": "DaemonSet"})
        elif kind == "ReplicaSet":
            if not namespace:
                return []
            ret = apps.list_namespaced_replica_set(namespace=namespace, limit=500)
            for r in ret.items:
                result.append({"name": r.metadata.name, "namespace": namespace, "kind": "ReplicaSet"})
        elif kind == "Job":
            if not namespace:
                return []
            ret = batch.list_namespaced_job(namespace=namespace, limit=500)
            for j in ret.items:
                result.append({"name": j.metadata.name, "namespace": namespace, "kind": "Job"})
        elif kind == "CronJob":
            if not namespace:
                return []
            ret = batch.list_namespaced_cron_job(namespace=namespace, limit=500)
            for c in ret.items:
                result.append({"name": c.metadata.name, "namespace": namespace, "kind": "CronJob"})
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
