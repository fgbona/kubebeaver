"""Tests for heuristic root-cause candidate mapping."""
import pytest

from app.heuristics import compute_heuristics, HEURISTIC_RULES


def test_empty_evidence_returns_empty():
    assert compute_heuristics({}) == []
    assert compute_heuristics({"pod": {}}) == []
    assert compute_heuristics({"pod": {"status": {}}}) == []


def test_crash_loop_back_off_from_waiting():
    evidence = {
        "pod": {
            "status": {
                "phase": "Running",
                "containerStatuses": [
                    {
                        "name": "app",
                        "state": {"waiting": {"reason": "CrashLoopBackOff", "message": "Back-off restarting"}},
                        "lastState": None,
                    }
                ],
            }
        }
    }
    result = compute_heuristics(evidence)
    assert len(result) == 1
    assert result[0]["condition"] == "CrashLoopBackOff"
    assert "pod.status.containerStatuses[0].state.waiting" in result[0]["evidence_refs"]
    candidates = result[0]["candidates"]
    assert any("crash" in c["cause"].lower() or "exit" in c["cause"].lower() for c in candidates)
    assert all(c["confidence"] in ("high", "medium") for c in candidates)


def test_image_pull_back_off_from_waiting():
    evidence = {
        "pod": {
            "status": {
                "containerStatuses": [
                    {"name": "main", "state": {"waiting": {"reason": "ImagePullBackOff"}}}
                ],
            }
        }
    }
    result = compute_heuristics(evidence)
    assert len(result) == 1
    assert result[0]["condition"] == "ImagePullBackOff"
    assert any("image" in c["cause"].lower() for c in result[0]["candidates"])


def test_err_image_pull_maps_to_rules():
    evidence = {
        "pod": {
            "status": {
                "containerStatuses": [
                    {"name": "sidecar", "state": {"waiting": {"reason": "ErrImagePull"}}}
                ],
            }
        }
    }
    result = compute_heuristics(evidence)
    assert len(result) == 1
    assert result[0]["condition"] == "ErrImagePull"
    assert result[0]["candidates"]


def test_oom_killed_from_last_state_terminated():
    evidence = {
        "pod": {
            "status": {
                "containerStatuses": [
                    {
                        "name": "app",
                        "state": {"running": {}},
                        "lastState": {"terminated": {"reason": "OOMKilled", "exitCode": 137}},
                    }
                ],
            }
        }
    }
    result = compute_heuristics(evidence)
    assert len(result) == 1
    assert result[0]["condition"] == "OOMKilled"
    assert "lastState.terminated" in result[0]["evidence_refs"][0]


def test_unschedulable_from_failed_scheduling_event():
    evidence = {
        "pod_events": [
            {"type": "Warning", "reason": "FailedScheduling", "message": "0/3 nodes available"}
        ]
    }
    result = compute_heuristics(evidence)
    assert len(result) == 1
    assert result[0]["condition"] == "Unschedulable"
    assert "pod_events[0].reason" in result[0]["evidence_refs"]
    assert any("CPU" in c["cause"] or "memory" in c["cause"] for c in result[0]["candidates"])


def test_heuristic_rules_cover_expected_conditions():
    assert "CrashLoopBackOff" in HEURISTIC_RULES
    assert "ImagePullBackOff" in HEURISTIC_RULES
    assert "ErrImagePull" in HEURISTIC_RULES
    assert "Unschedulable" in HEURISTIC_RULES
    assert "OOMKilled" in HEURISTIC_RULES
    assert "Error" in HEURISTIC_RULES
    for cond, rules in HEURISTIC_RULES.items():
        assert isinstance(rules, list)
        for item in rules:
            cause, confidence, refs = item
            assert isinstance(cause, str) and cause
            assert confidence in ("high", "medium", "low")
            assert isinstance(refs, list)


def test_evidence_refs_present_in_candidates():
    evidence = {
        "pod": {
            "status": {
                "containerStatuses": [
                    {"name": "x", "state": {"waiting": {"reason": "CrashLoopBackOff"}}}
                ],
            }
        }
    }
    result = compute_heuristics(evidence)
    for block in result:
        for cand in block["candidates"]:
            assert "evidence_refs" in cand
            assert isinstance(cand["evidence_refs"], list)
