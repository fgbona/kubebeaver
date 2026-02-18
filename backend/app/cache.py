"""Optional Redis cache for API responses. Disabled when REDIS_URL is not set."""
from __future__ import annotations

import json
import logging
from typing import Any

from app.config import settings

logger = logging.getLogger(__name__)

_redis: Any = None


def _enabled() -> bool:
    return bool(settings.redis_url and settings.redis_url.strip())


async def _get_client() -> Any | None:
    global _redis
    if not _enabled():
        return None
    if _redis is not None:
        return _redis
    try:
        from redis.asyncio import Redis
        _redis = Redis.from_url(
            settings.redis_url.strip(),
            decode_responses=True,
        )
        await _redis.ping()
        logger.info("Redis cache connected")
        return _redis
    except Exception as e:
        logger.warning("Redis cache disabled: %s", e)
        return None


async def close() -> None:
    """Close Redis connection (call on shutdown)."""
    global _redis
    if _redis is not None:
        try:
            await _redis.aclose()
        except Exception as e:
            logger.warning("Redis close: %s", e)
        _redis = None


async def get(key: str) -> Any | None:
    """Get value from cache. Returns None if cache disabled or key missing."""
    client = await _get_client()
    if client is None:
        return None
    try:
        raw = await client.get(key)
        if raw is None:
            return None
        return json.loads(raw)
    except Exception as e:
        logger.debug("Cache get %s: %s", key[:50], e)
        return None


async def set(key: str, value: Any, ttl_seconds: int) -> None:
    """Set value in cache. No-op if cache disabled."""
    client = await _get_client()
    if client is None:
        return
    try:
        await client.set(key, json.dumps(value, default=str), ex=ttl_seconds)
    except Exception as e:
        logger.debug("Cache set %s: %s", key[:50], e)


def cache_key(prefix: str, *parts: Any) -> str:
    """Build a cache key from prefix and parts (None-safe)."""
    safe = [str(p) if p is not None else "" for p in parts]
    return f"kubebeaver:{prefix}:{':'.join(safe)}"
