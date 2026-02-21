"""Tests for heuristic classifier with numeric confidence."""
import pytest
from app.intelligence.classifier import classify_signals


def _empty_signals():
    return {
        "crash_loop_back_off": False, "image_pull_back_off": False,
        "oom_killed": False, "unschedulable": False, "restart_count": 0,
        "node_not_ready": False, "replica_mismatch": False, "warning_event_count": 0,
    }


def test_empty_signals_returns_empty_list():
    result = classify_signals(_empty_signals())
    assert result == []


def test_oom_killed_produces_resource_exhaustion():
    signals = {**_empty_signals(), "oom_killed": True}
    result = classify_signals(signals)
    assert len(result) == 1
    assert result[0]["root_cause"] == "resource_exhaustion"
    assert result[0]["confidence"] == pytest.approx(0.95)
    assert result[0]["signals_triggered"] == ["oom_killed"]


def test_image_pull_back_off_produces_image_error():
    signals = {**_empty_signals(), "image_pull_back_off": True}
    result = classify_signals(signals)
    matches = [r for r in result if r["root_cause"] == "image_error"]
    assert len(matches) == 1
    assert matches[0]["confidence"] == pytest.approx(0.99)
    assert "image_pull_back_off" in matches[0]["signals_triggered"]


def test_crash_loop_without_oom_produces_app_runtime_error():
    signals = {**_empty_signals(), "crash_loop_back_off": True, "restart_count": 3}
    result = classify_signals(signals)
    matches = [r for r in result if r["root_cause"] == "app_runtime_error"]
    assert len(matches) == 1
    assert matches[0]["confidence"] == pytest.approx(0.8)


def test_oom_suppresses_app_runtime_error():
    # When OOM is present, crash loop should NOT produce app_runtime_error
    signals = {**_empty_signals(), "crash_loop_back_off": True, "oom_killed": True}
    result = classify_signals(signals)
    root_causes = {r["root_cause"] for r in result}
    assert "resource_exhaustion" in root_causes
    assert "app_runtime_error" not in root_causes


def test_unschedulable_produces_scheduling_issue():
    signals = {**_empty_signals(), "unschedulable": True}
    result = classify_signals(signals)
    matches = [r for r in result if r["root_cause"] == "scheduling_issue"]
    assert len(matches) == 1
    assert matches[0]["confidence"] == pytest.approx(0.9)
    assert "unschedulable" in matches[0]["signals_triggered"]


def test_replica_mismatch_produces_rollout_issue():
    signals = {**_empty_signals(), "replica_mismatch": True}
    result = classify_signals(signals)
    matches = [r for r in result if r["root_cause"] == "rollout_issue"]
    assert len(matches) == 1
    assert matches[0]["confidence"] == pytest.approx(0.85)


def test_node_not_ready_produces_node_failure():
    signals = {**_empty_signals(), "node_not_ready": True}
    result = classify_signals(signals)
    matches = [r for r in result if r["root_cause"] == "node_failure"]
    assert len(matches) == 1
    assert matches[0]["confidence"] == pytest.approx(0.9)


def test_multiple_signals_produce_multiple_findings():
    signals = {**_empty_signals(), "oom_killed": True, "replica_mismatch": True, "warning_event_count": 3}
    result = classify_signals(signals)
    root_causes = {r["root_cause"] for r in result}
    assert "resource_exhaustion" in root_causes
    assert "rollout_issue" in root_causes


def test_each_finding_has_required_fields():
    signals = {**_empty_signals(), "image_pull_back_off": True}
    result = classify_signals(signals)
    for finding in result:
        assert "root_cause" in finding
        assert "confidence" in finding
        assert "signals_triggered" in finding
        assert "description" in finding
        assert isinstance(finding["confidence"], float)
        assert 0.0 <= finding["confidence"] <= 1.0
        assert isinstance(finding["signals_triggered"], list)
        assert isinstance(finding["description"], str)
        assert len(finding["description"]) > 0


def test_confidence_values_are_floats_not_strings():
    signals = {**_empty_signals(), "oom_killed": True}
    result = classify_signals(signals)
    assert isinstance(result[0]["confidence"], float)


def test_no_duplicate_findings_for_same_root_cause():
    # Even with multiple triggering conditions, each root_cause appears once
    signals = {**_empty_signals(), "image_pull_back_off": True}
    result = classify_signals(signals)
    root_causes = [r["root_cause"] for r in result]
    assert len(root_causes) == len(set(root_causes))
