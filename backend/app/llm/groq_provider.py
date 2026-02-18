"""Groq API provider."""
import json
import logging
from typing import Any

import httpx

from app.config import settings
from app.llm.base import LLMProvider, LLMResponse

logger = logging.getLogger(__name__)


class GroqProvider(LLMProvider):
    def __init__(self) -> None:
        self._api_key = (settings.groq_api_key or "").strip()
        self._model = settings.groq_model or "llama-3.1-8b-instant"

    @property
    def is_configured(self) -> bool:
        return bool(self._api_key)

    async def complete(self, prompt: str, timeout: int) -> LLMResponse:
        if not self._api_key:
            raise ValueError("GROQ_API_KEY is not set")
        url = "https://api.groq.com/openai/v1/chat/completions"
        payload: dict[str, Any] = {
            "model": self._model,
            "messages": [{"role": "user", "content": prompt}],
            "temperature": 0.2,
            "max_tokens": 4096,
        }
        headers = {
            "Authorization": f"Bearer {self._api_key}",
            "Content-Type": "application/json",
        }
        try:
            async with httpx.AsyncClient(timeout=timeout) as client:
                resp = await client.post(url, json=payload, headers=headers)
                resp.raise_for_status()
                data = resp.json()
        except httpx.HTTPStatusError as e:
            error_body = ""
            try:
                error_body = e.response.text
            except Exception:
                pass
            logger.error(
                "Groq API error: %s %s. Response: %s",
                e.response.status_code,
                e.response.reason_phrase,
                error_body[:500],
            )
            raise ValueError(
                f"Groq API error {e.response.status_code}: {e.response.reason_phrase}. "
                f"Check your API key and model name. Response: {error_body[:200]}"
            ) from e
        choice = (data.get("choices") or [None])[0]
        if not choice:
            raise ValueError("No completion in Groq response")
        content = (choice.get("message") or {}).get("content") or ""
        usage = data.get("usage", {})
        return LLMResponse(
            content=content,
            tokens_used=usage.get("total_tokens", 0),
            prompt_tokens=usage.get("prompt_tokens", 0),
            completion_tokens=usage.get("completion_tokens", 0),
        )
