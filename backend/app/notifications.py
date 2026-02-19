"""Optional notifications on critical/high scan findings (webhook + Slack)."""
from __future__ import annotations

import asyncio
import logging
from typing import Any

import httpx

from app.config import settings

logger = logging.getLogger(__name__)


def _counts_by_severity(counts: dict[str, int]) -> str:
    parts = [f"{sev}: {n}" for sev, n in sorted(counts.items(), key=lambda x: (-x[1], x[0]))]
    return ", ".join(parts) if parts else "0"


def _top_findings(findings: list[dict[str, Any]], limit: int = 3) -> list[dict[str, Any]]:
    order = {"critical": 4, "high": 3, "medium": 2, "low": 1, "info": 0}
    sorted_f = sorted(
        findings,
        key=lambda f: (-order.get(f.get("severity", "info"), 0), f.get("title", "")),
    )
    return [
        {"severity": f.get("severity", "info"), "title": (f.get("title") or "")[:200]}
        for f in sorted_f[:limit]
    ]


def _has_critical_or_high(counts: dict[str, int]) -> bool:
    return (counts.get("critical") or 0) + (counts.get("high") or 0) > 0


def _scan_detail_url(scan_id: str) -> str | None:
    base = (settings.base_url or "").rstrip("/")
    if not base:
        return None
    return f"{base}/#/scan?id={scan_id}"


async def send_webhook(scan_id: str, counts: dict[str, int], findings: list[dict[str, Any]]) -> None:
    """POST generic JSON to WEBHOOK_URL. No-op if not configured."""
    url = (settings.webhook_url or "").strip()
    if not url:
        return
    payload: dict[str, Any] = {
        "source": "kubebeaver",
        "scan_id": scan_id,
        "counts_by_severity": counts,
        "summary": _counts_by_severity(counts),
        "top_findings": _top_findings(findings, 3),
    }
    link = _scan_detail_url(scan_id)
    if link:
        payload["scan_url"] = link
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            r = await client.post(url, json=payload)
            if r.status_code >= 400:
                logger.warning("Webhook POST %s status %s", url, r.status_code)
    except Exception as e:
        logger.warning("Webhook POST failed: %s", e)


async def send_slack(scan_id: str, counts: dict[str, int], findings: list[dict[str, Any]]) -> None:
    """POST Slack message to SLACK_WEBHOOK_URL. No-op if not configured."""
    url = (settings.slack_webhook_url or "").strip()
    if not url:
        return
    summary = _counts_by_severity(counts)
    top = _top_findings(findings, 3)
    link = _scan_detail_url(scan_id)
    lines = [
        "*KubeBeaver scan* found critical/high findings",
        f"*Counts:* {summary}",
        "*Top findings:*",
    ]
    for t in top:
        lines.append(f"  • [{t['severity']}] {t['title']}")
    if link:
        lines.append(f"<{link}|View scan details>")
    text = "\n".join(lines)
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            r = await client.post(url, json={"text": text})
            if r.status_code >= 400:
                logger.warning("Slack webhook POST status %s", r.status_code)
    except Exception as e:
        logger.warning("Slack webhook POST failed: %s", e)


async def notify_on_findings(
    scan_id: str,
    counts: dict[str, int],
    findings: list[dict[str, Any]],
) -> None:
    """If there are critical/high findings, send to webhook and/or Slack. Does not raise."""
    if not _has_critical_or_high(counts):
        return
    await asyncio.gather(
        send_webhook(scan_id, counts, findings),
        send_slack(scan_id, counts, findings),
    )
