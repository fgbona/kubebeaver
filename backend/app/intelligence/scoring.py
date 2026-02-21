"""Combine signals and findings into a single engine_confidence float (0–1)."""
from __future__ import annotations

from typing import Any


def compute_confidence(
    signals: dict[str, Any],
    findings: list[dict[str, Any]],
) -> float:
    """Produce an aggregate engine_confidence score (0.0 – 1.0).

    Algorithm:
    - Base: max confidence among all findings (0.0 if no findings)
    - restart_count bonus: min(restart_count * 0.01, 0.05)
    - warning_event_count bonus: min(warning_count * 0.01, 0.05)
    - multi-finding bonus: min((len(findings) - 1) * 0.02, 0.05)
    - Final: round(min(sum, 1.0), 4)
    """
    if not findings:
        return 0.0

    base = max(f["confidence"] for f in findings)
    restart_bonus = min((signals.get("restart_count") or 0) * 0.01, 0.05)
    warning_bonus = min((signals.get("warning_event_count") or 0) * 0.01, 0.05)
    multi_bonus = min((len(findings) - 1) * 0.02, 0.05)

    return round(min(base + restart_bonus + warning_bonus + multi_bonus, 1.0), 4)
