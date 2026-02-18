"""Sanitize evidence before sending to LLM: redact secrets, truncate."""
import re
import logging
from typing import Any

logger = logging.getLogger(__name__)

# Patterns and keys to redact
REDACT_KEYS = frozenset({
    "token", "bearer", "authorization", "secret", "password", "api_key", "apikey",
    "credentials", "cookie", "auth", "private_key", "client_secret",
})
REDACT_ENV_PATTERN = re.compile(
    r"(PASSWORD|SECRET|TOKEN|KEY|CREDENTIAL|PRIVATE|AUTH)(_[A-Z0-9_]*)?=.*",
    re.IGNORECASE,
)
BASE64_PATTERN = re.compile(r"[A-Za-z0-9+/]{50,}={0,2}")


def _redact_value(val: Any) -> Any:
    if isinstance(val, dict):
        return {k: _redact_value(v) for k, v in val.items()}
    if isinstance(val, list):
        return [_redact_value(i) for i in val]
    if isinstance(val, str):
        if any(k in val.lower() for k in ("bearer ", "basic ", "token")):
            return "[REDACTED]"
        # Long base64-like strings
        if len(val) > 40 and BASE64_PATTERN.fullmatch(val.strip()):
            return "[REDACTED_BASE64]"
        # Env-style sensitive
        if REDACT_ENV_PATTERN.match(val.strip()):
            return "[REDACTED_ENV]"
        return val
    return val


def _redact_dict(obj: dict[str, Any]) -> dict[str, Any]:
    out: dict[str, Any] = {}
    for k, v in obj.items():
        key_lower = k.lower().replace("_", "").replace("-", "")
        if any(rk.replace("_", "") in key_lower for rk in REDACT_KEYS):
            out[k] = "[REDACTED]"
        else:
            out[k] = _redact_value(v)
    return out


def sanitize_evidence(evidence: dict[str, Any]) -> dict[str, Any]:
    """Recursively redact sensitive keys and values in evidence dict."""
    return _redact_dict(evidence)


def truncate_log_lines(lines: list[str], max_lines: int) -> list[str]:
    if len(lines) <= max_lines:
        return lines
    return lines[-max_lines:]


def truncate_evidence_for_llm(evidence: dict[str, Any], max_chars: int) -> tuple[dict[str, Any], dict[str, Any]]:
    """
    Truncate evidence to stay under max_chars. Returns (truncated_evidence, truncation_report).
    Report: truncated (bool), sections_truncated (list), total_chars_before, total_chars_after.
    """
    import json
    raw_str = json.dumps(evidence, default=str)
    total_before = len(raw_str)
    report: dict[str, Any] = {
        "truncated": False,
        "sections_truncated": [],
        "total_chars_before": total_before,
        "total_chars_after": total_before,
    }
    if total_before <= max_chars:
        return evidence, report

    # Prefer truncating log sections first
    truncated = dict(evidence)
    for key in ("pod_logs", "previous_logs", "events", "pod_events"):
        if key not in truncated or not isinstance(truncated[key], (list, dict, str)):
            continue
        if isinstance(truncated[key], list):
            # Truncate list items (e.g. event list, log lines)
            orig = truncated[key]
            if len(orig) > 50:
                truncated[key] = orig[:50]
                truncated[f"_{key}_truncated"] = len(orig) - 50
                report["sections_truncated"].append(key)
        elif isinstance(truncated[key], dict):
            for subk, subv in list(truncated[key].items())[:10]:
                if isinstance(subv, list) and len(subv) > 200:
                    truncated[key][subk] = subv[-200:]
                    report["sections_truncated"].append(f"{key}.{subk}")

    raw_str = json.dumps(truncated, default=str)
    if len(raw_str) > max_chars:
        # Last resort: cut the string and keep a summary key
        truncated["_full_evidence_truncated"] = True
        truncated["_summary"] = str(truncated)[:2000] + "..."
        for k in list(truncated.keys()):
            if k.startswith("_") or k in ("pod_logs", "previous_logs", "events", "pod_events"):
                continue
            raw_str = json.dumps(truncated, default=str)
            if len(raw_str) <= max_chars:
                break
            # Remove largest non-critical key
            sizes = {k: len(json.dumps(v, default=str)) for k, v in truncated.items() if not k.startswith("_")}
            if not sizes:
                break
            drop = max(sizes, key=sizes.get)
            truncated[drop] = f"[TRUNCATED: {sizes[drop]} chars]"
            report["sections_truncated"].append(drop)

    report["truncated"] = True
    report["total_chars_after"] = len(json.dumps(truncated, default=str))
    return truncated, report
