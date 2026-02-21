"""Tests for deterministic signal extraction."""
import pytest
from app.intelligence.signals import extract_signals


def test_empty_evidence_returns_default_signals():
    signals = extract_signals({})
    assert signals["crash_loop_back_off"] is False
    assert signals["image_pull_back_off"] is False
    assert signals["oom_killed"] is False
    assert signals["unschedulable"] is False
    assert signals["restart_count"] == 0
    assert signals["node_not_ready"] is False
    assert signals["replica_mismatch"] is False
    assert signals["warning_event_count"] == 0


def test_crash_loop_detected_from_waiting_state():
    evidence = {
        "pod": {
            "status": {
                "containerStatuses": [
                    {"state": {"waiting": {"reason": "CrashLoopBackOff"}}, "restartCount": 5}
                ]
            }
        }
    }
    signals = extract_signals(evidence)
    assert signals["crash_loop_back_off"] is True
    assert signals["restart_count"] == 5


def test_image_pull_back_off_detected():
    evidence = {
        "pod": {
            "status": {
                "containerStatuses": [
                    {"state": {"waiting": {"reason": "ImagePullBackOff"}}, "restartCount": 0}
                ]
            }
        }
    }
    signals = extract_signals(evidence)
    assert signals["image_pull_back_off"] is True


def test_err_image_pull_also_sets_image_pull_back_off():
    evidence = {
        "pod": {
            "status": {
                "containerStatuses": [
                    {"state": {"waiting": {"reason": "ErrImagePull"}}, "restartCount": 0}
                ]
            }
        }
    }
    signals = extract_signals(evidence)
    assert signals["image_pull_back_off"] is True


def test_oom_killed_from_last_state_terminated():
    evidence = {
        "pod": {
            "status": {
                "containerStatuses": [
                    {
                        "state": {"running": {}},
                        "lastState": {"terminated": {"reason": "OOMKilled", "exitCode": 137}},
                        "restartCount": 3,
                    }
                ]
            }
        }
    }
    signals = extract_signals(evidence)
    assert signals["oom_killed"] is True
    assert signals["restart_count"] == 3


def test_unschedulable_from_failed_scheduling_event():
    evidence = {
        "pod_events": [
            {"type": "Warning", "reason": "FailedScheduling", "message": "0/3 nodes available"}
        ]
    }
    signals = extract_signals(evidence)
    assert signals["unschedulable"] is True


def test_warning_event_count_aggregated():
    evidence = {
        "pod_events": [
            {"type": "Warning", "reason": "BackOff"},
            {"type": "Warning", "reason": "FailedMount"},
            {"type": "Normal", "reason": "Scheduled"},
        ]
    }
    signals = extract_signals(evidence)
    assert signals["warning_event_count"] == 2


def test_replica_mismatch_from_deployment():
    evidence = {
        "deployment": {
            "spec": {"replicas": 3},
            "status": {"readyReplicas": 1, "replicas": 3},
        }
    }
    signals = extract_signals(evidence)
    assert signals["replica_mismatch"] is True


def test_no_replica_mismatch_when_ready():
    evidence = {
        "deployment": {
            "spec": {"replicas": 3},
            "status": {"readyReplicas": 3, "replicas": 3},
        }
    }
    signals = extract_signals(evidence)
    assert signals["replica_mismatch"] is False


def test_node_not_ready_from_node_conditions():
    evidence = {
        "node": {
            "status": {
                "conditions": [
                    {"type": "Ready", "status": "False"}
                ]
            }
        }
    }
    signals = extract_signals(evidence)
    assert signals["node_not_ready"] is True


def test_restart_count_summed_across_containers():
    evidence = {
        "pod": {
            "status": {
                "containerStatuses": [
                    {"state": {}, "restartCount": 2},
                    {"state": {}, "restartCount": 4},
                ]
            }
        }
    }
    signals = extract_signals(evidence)
    assert signals["restart_count"] == 6


def test_warning_events_across_multiple_event_keys():
    evidence = {
        "pod_events": [{"type": "Warning", "reason": "BackOff"}],
        "deployment_events": [{"type": "Warning", "reason": "ReplicaSetError"}],
        "node_events": [{"type": "Normal", "reason": "NodeReady"}],
    }
    signals = extract_signals(evidence)
    assert signals["warning_event_count"] == 2
