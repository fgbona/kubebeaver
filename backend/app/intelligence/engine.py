"""Hybrid intelligence engine — orchestrates signals, classifier, and scoring."""
from __future__ import annotations

from typing import Any

from app.intelligence.signals import extract_signals
from app.intelligence.classifier import classify_signals
from app.intelligence.scoring import compute_confidence


def analyze_with_engine(evidence: dict[str, Any]) -> dict[str, Any]:
    """Run the full intelligence pipeline on collected evidence.

    Returns:
    {
        "signals": dict[str, Any],          # boolean + numeric signals
        "findings": list[dict[str, Any]],   # classified root causes
        "engine_confidence": float,         # 0.0 – 1.0
    }
    """
    signals = extract_signals(evidence)
    findings = classify_signals(signals)
    engine_confidence = compute_confidence(signals, findings)

    return {
        "signals": signals,
        "findings": findings,
        "engine_confidence": engine_confidence,
    }
