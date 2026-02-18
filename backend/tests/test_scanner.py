"""Tests for scanner classification and helpers."""
import pytest

from app.scanner import (
    classify_pod_finding,
    classify_node_findings,
    classify_replica_mismatch,
    SEVERITY_ORDER,
)


class TestClassifyPodFinding:
    def test_oomkilled(self):
        sev, cat, title, desc = classify_pod_finding(
            waiting_reason=None,
            terminated_reason="OOMKilled",
            phase="Running",
            pending_minutes=None,
        )
        assert sev == "high"
        assert cat == "resources"
        assert "OOM" in title or "OOM" in desc

    def test_image_pull_back_off(self):
        sev, cat, title, desc = classify_pod_finding(
            waiting_reason="ImagePullBackOff",
            terminated_reason=None,
            phase="Pending",
            pending_minutes=1,
        )
        assert sev == "high"
        assert cat == "image"

    def test_err_image_pull(self):
        sev, cat, _, _ = classify_pod_finding(
            waiting_reason="ErrImagePull",
            terminated_reason=None,
            phase="Pending",
            pending_minutes=None,
        )
        assert sev == "high"
        assert cat == "image"

    def test_crash_loop_back_off(self):
        sev, cat, title, _ = classify_pod_finding(
            waiting_reason="CrashLoopBackOff",
            terminated_reason=None,
            phase="Running",
            pending_minutes=None,
        )
        assert sev == "high"
        assert cat == "crash"
        assert "CrashLoop" in title

    def test_pending_long(self):
        sev, cat, _, desc = classify_pod_finding(
            waiting_reason=None,
            terminated_reason=None,
            phase="Pending",
            pending_minutes=10,
        )
        assert sev == "medium"
        assert cat == "scheduling"
        assert "Pending" in desc

    def test_terminated_generic(self):
        sev, cat, _, _ = classify_pod_finding(
            waiting_reason=None,
            terminated_reason="Error",
            phase="Failed",
            pending_minutes=None,
        )
        assert sev == "medium"
        assert cat == "crash"

    def test_container_name_in_description(self):
        _, _, _, desc = classify_pod_finding(
            waiting_reason="CrashLoopBackOff",
            terminated_reason=None,
            phase="Running",
            pending_minutes=None,
            container_name="app",
        )
        assert "container: app" in desc


class TestClassifyNodeFindings:
    def test_node_not_ready(self):
        class Cond:
            def __init__(self, t: str, s: str):
                self.type = t
                self.status = s

        class Node:
            metadata = type("M", (), {"name": "node-1"})()
            status = type("S", (), {"conditions": [Cond("Ready", "False")]})()

        findings = classify_node_findings(Node())
        assert any(f[1] == "node" and "NotReady" in f[2] for f in findings)

    def test_memory_pressure(self):
        class Cond:
            def __init__(self, t: str, s: str):
                self.type = t
                self.status = s

        class Node:
            metadata = type("M", (), {"name": "n1"})()
            status = type(
                "S",
                (),
                {
                    "conditions": [
                        Cond("Ready", "True"),
                        Cond("MemoryPressure", "True"),
                    ]
                },
            )()

        findings = classify_node_findings(Node())
        assert any("MemoryPressure" in f[2] for f in findings)
        assert any(f[0] == "high" for f in findings)


class TestClassifyReplicaMismatch:
    def test_zero_ready_high_severity(self):
        sev, cat, _, desc = classify_replica_mismatch(
            "Deployment", "default", "web", desired=3, ready=0
        )
        assert sev == "high"
        assert "desired=3" in desc
        assert "ready=0" in desc

    def test_partial_ready_medium(self):
        sev, _, _, _ = classify_replica_mismatch(
            "StatefulSet", "default", "db", desired=3, ready=2
        )
        assert sev == "medium"


class TestSeverityOrder:
    def test_order(self):
        assert SEVERITY_ORDER["critical"] > SEVERITY_ORDER["high"]
        assert SEVERITY_ORDER["high"] > SEVERITY_ORDER["medium"]
        assert SEVERITY_ORDER["info"] == 0
