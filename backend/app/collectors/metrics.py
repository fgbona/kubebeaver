"""Best-effort metrics from metrics-server (optional)."""
from __future__ import annotations

import logging
from typing import Any

try:
    from kubernetes import client
    from kubernetes.client.rest import ApiException
    _metrics_available = True
except ImportError:
    _metrics_available = False

logger = logging.getLogger(__name__)


def get_pod_metrics(namespace: str, context: str | None) -> dict[str, Any] | None:
    if not _metrics_available:
        return None
    try:
        from kubernetes import config
        if context:
            config.load_kube_config(context=context)
        else:
            config.load_kube_config()
        custom_api = client.CustomObjectsApi()
        result = custom_api.list_namespaced_custom_object(
            group="metrics.k8s.io",
            version="v1beta1",
            namespace=namespace,
            plural="pods",
        )
        return result
    except ApiException as e:
        if e.status == 403:
            logger.info("Metrics: insufficient RBAC for metrics.k8s.io")
        else:
            logger.debug("Metrics not available: %s", e.reason)
        return None
    except Exception as e:
        logger.debug("Metrics error: %s", e)
        return None


def get_node_metrics(context: str | None) -> dict[str, Any] | None:
    if not _metrics_available:
        return None
    try:
        from kubernetes import config
        if context:
            config.load_kube_config(context=context)
        else:
            config.load_kube_config()
        custom_api = client.CustomObjectsApi()
        result = custom_api.list_cluster_custom_object(
            group="metrics.k8s.io",
            version="v1beta1",
            plural="nodes",
        )
        return result
    except Exception as e:
        logger.debug("Node metrics error: %s", e)
        return None
