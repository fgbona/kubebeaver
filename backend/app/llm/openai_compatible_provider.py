"""OpenAI-compatible endpoint (Ollama, Exo, OpenAI, etc.)."""
import logging
from typing import Any

import httpx

from app.config import settings
from app.llm.base import LLMProvider, LLMResponse

logger = logging.getLogger(__name__)


class OpenAICompatibleProvider(LLMProvider):
    def __init__(self) -> None:
        self._base_url = (settings.openai_base_url or "").rstrip("/")
        self._api_key = (settings.openai_api_key or "").strip()
        self._model = settings.openai_model or "llama3.2"

    @property
    def is_configured(self) -> bool:
        return bool(self._base_url)

    async def complete(self, prompt: str, timeout: int) -> LLMResponse:
        if not self._base_url:
            raise ValueError("OPENAI_BASE_URL is not set")
        url = f"{self._base_url}/chat/completions"
        payload: dict[str, Any] = {
            "model": self._model,
            "messages": [{"role": "user", "content": prompt}],
            "temperature": 0.2,
            "max_tokens": 4096,
        }
        headers = {"Content-Type": "application/json"}
        if self._api_key:
            headers["Authorization"] = f"Bearer {self._api_key}"
        try:
            async with httpx.AsyncClient(timeout=timeout) as client:
                resp = await client.post(url, json=payload, headers=headers)
                resp.raise_for_status()
                data = resp.json()
        except httpx.ConnectError as e:
            raise ValueError(
                f"Cannot reach LLM at {url}. "
                "If the backend runs in Docker and the LLM (e.g. Ollama) is on the host, set OPENAI_BASE_URL=http://host.docker.internal:11434/v1 and ensure Ollama is running. "
                "On Linux you may need 'extra_hosts: [host.docker.internal:host-gateway]' in compose."
            ) from e
        choice = (data.get("choices") or [None])[0]
        if not choice:
            raise ValueError("No completion in response")
        content = (choice.get("message") or {}).get("content") or ""
        usage = data.get("usage", {})
        # Fallback: estimate tokens if usage not provided (rough: ~4 chars per token)
        total_tokens = usage.get("total_tokens", 0)
        if not total_tokens and content:
            total_tokens = len(prompt.split()) + len(content.split())  # Rough word-based estimate
        return LLMResponse(
            content=content,
            tokens_used=total_tokens,
            prompt_tokens=usage.get("prompt_tokens", 0),
            completion_tokens=usage.get("completion_tokens", 0),
        )
