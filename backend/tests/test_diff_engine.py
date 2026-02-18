"""Tests for the diff engine (compare two analyses)."""
import pytest
from app.diff_engine import (
    _parse_evidence,
    compute_diffs,
)


class TestParseEvidence:
    def test_empty_or_none_returns_empty_dict(self):
        assert _parse_evidence(None) == {}
        assert _parse_evidence("") == {}
        assert _parse_evidence("   ") == {}

    def test_valid_json_returns_parsed(self):
        ev = {"pod": {"status": {"phase": "Running"}}}
        assert _parse_evidence('{"pod":{"status":{"phase":"Running"}}}') == ev

    def test_invalid_json_returns_empty_dict(self):
        assert _parse_evidence("not json at all") == {}
        # Truncated JSON may be salvaged to partial object
        out = _parse_evidence('{"truncated": true')
        assert out == {} or "truncated" in out


class TestComputeDiffs:
    def test_pod_phase_change(self):
        a = {
            "analysis_json": {},
            "evidence_summary": '{"pod":{"status":{"phase":"Pending","conditions":[],"containerStatuses":[]}}}',
        }
        b = {
            "analysis_json": {},
            "evidence_summary": '{"pod":{"status":{"phase":"Running","conditions":[],"containerStatuses":[]}}}',
        }
        changes = compute_diffs(a, b)
        phase_changes = [c for c in changes if c.get("type") == "pod_phase"]
        assert len(phase_changes) == 1
        assert phase_changes[0]["before"] == "Pending"
        assert phase_changes[0]["after"] == "Running"
        assert "phase" in phase_changes[0]["path"]

    def test_restart_count_change(self):
        a = {
            "analysis_json": {},
            "evidence_summary": '{"pod":{"status":{"phase":"Running","conditions":[],"containerStatuses":[{"name":"app","ready":true,"restartCount":2,"state":{"running":{}},"lastState":{"terminated":{"reason":"Completed","exitCode":0}}}]}}}',
        }
        b = {
            "analysis_json": {},
            "evidence_summary": '{"pod":{"status":{"phase":"Running","conditions":[],"containerStatuses":[{"name":"app","ready":true,"restartCount":3,"state":{"running":{}},"lastState":{"terminated":{"reason":"Error","exitCode":1}}}]}}}',
        }
        changes = compute_diffs(a, b)
        restart_changes = [c for c in changes if c.get("type") == "restart_count"]
        assert len(restart_changes) == 1
        assert restart_changes[0]["before"] == 2
        assert restart_changes[0]["after"] == 3
        last_state = [c for c in changes if c.get("type") == "last_state"]
        assert len(last_state) == 1
        assert last_state[0]["after"].get("terminated", {}).get("exitCode") == 1

    def test_events_new_warning(self):
        a = {
            "analysis_json": {},
            "evidence_summary": '{"pod_events":[{"type":"Normal","reason":"Scheduled"}]}',
        }
        b = {
            "analysis_json": {},
            "evidence_summary": '{"pod_events":[{"type":"Normal","reason":"Scheduled"},{"type":"Warning","reason":"BackOff","message":"Back-off restarting"}]}',
        }
        changes = compute_diffs(a, b)
        event_changes = [c for c in changes if c.get("type") == "event"]
        assert len(event_changes) >= 1
        assert any("BackOff" in str(c.get("after")) for c in event_changes)

    def test_analysis_json_summary_and_commands(self):
        a = {
            "analysis_json": {"summary": "Pod is healthy", "kubectl_commands": ["kubectl get pod x"]},
            "evidence_summary": "{}",
        }
        b = {
            "analysis_json": {"summary": "Pod restarted", "kubectl_commands": ["kubectl get pod x", "kubectl logs x"]},
            "evidence_summary": "{}",
        }
        changes = compute_diffs(a, b)
        summary_changes = [c for c in changes if c.get("type") == "summary"]
        assert len(summary_changes) == 1
        cmd_changes = [c for c in changes if c.get("type") == "kubectl_commands"]
        assert len(cmd_changes) == 1
        assert len(cmd_changes[0]["after"]) == 2

    def test_no_changes_same_analysis(self):
        a = {
            "analysis_json": {"summary": "Ok"},
            "evidence_summary": '{"pod":{"status":{"phase":"Running"}}}',
        }
        changes = compute_diffs(a, a)
        assert changes == []

    def test_missing_evidence_handled(self):
        a = {"analysis_json": {}, "evidence_summary": None}
        b = {"analysis_json": {"summary": "New"}, "evidence_summary": "{}"}
        changes = compute_diffs(a, b)
        summary_changes = [c for c in changes if c.get("type") == "summary"]
        assert len(summary_changes) == 1
