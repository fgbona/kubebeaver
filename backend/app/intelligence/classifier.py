"""Rules-based heuristic classifier mapping signals to root causes with numeric confidence."""
from __future__ import annotations

from typing import Any


def classify_signals(signals: dict[str, Any]) -> list[dict[str, Any]]:
    """Map extracted signals to classified root causes.

    Each finding is a dict with:
    - root_cause: str (identifier, snake_case)
    - confidence: float (0.0 - 1.0)
    - signals_triggered: list[str]
    - description: str (human-readable explanation)

    Rules:
    - OOMKilled -> resource_exhaustion (0.95); suppresses app_runtime_error
    - ImagePullBackOff -> image_error (0.99)
    - CrashLoopBackOff without OOMKilled -> app_runtime_error (0.8)
    - Unschedulable -> scheduling_issue (0.9)
    - ReplicaMismatch -> rollout_issue (0.85)
    - NodeNotReady -> node_failure (0.9)
    """
    findings: list[dict[str, Any]] = []

    if signals.get("oom_killed"):
        findings.append({
            "root_cause": "resource_exhaustion",
            "confidence": 0.95,
            "signals_triggered": ["oom_killed"],
            "description": "Container was killed due to exceeding memory limit (OOMKilled).",
        })

    if signals.get("image_pull_back_off"):
        findings.append({
            "root_cause": "image_error",
            "confidence": 0.99,
            "signals_triggered": ["image_pull_back_off"],
            "description": "Image pull failed. Check image name, tag, and registry credentials.",
        })

    # CrashLoop without OOM -> generic app runtime error
    if signals.get("crash_loop_back_off") and not signals.get("oom_killed"):
        findings.append({
            "root_cause": "app_runtime_error",
            "confidence": 0.8,
            "signals_triggered": ["crash_loop_back_off"],
            "description": "Application is crashing repeatedly. Check logs for error details.",
        })

    if signals.get("unschedulable"):
        findings.append({
            "root_cause": "scheduling_issue",
            "confidence": 0.9,
            "signals_triggered": ["unschedulable"],
            "description": "Pod cannot be scheduled. Check node resources, selectors, and taints.",
        })

    if signals.get("replica_mismatch"):
        findings.append({
            "root_cause": "rollout_issue",
            "confidence": 0.85,
            "signals_triggered": ["replica_mismatch"],
            "description": "Ready replicas are less than desired. Rollout may be stalled.",
        })

    if signals.get("node_not_ready"):
        findings.append({
            "root_cause": "node_failure",
            "confidence": 0.9,
            "signals_triggered": ["node_not_ready"],
            "description": "Node is reporting NotReady status. Check kubelet and system resources.",
        })

    return findings
