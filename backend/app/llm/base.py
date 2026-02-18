"""Abstract LLM provider interface."""
from abc import ABC, abstractmethod
from dataclasses import dataclass


@dataclass
class LLMResponse:
    """Response from LLM provider with content and usage metrics."""
    content: str
    tokens_used: int = 0
    prompt_tokens: int = 0
    completion_tokens: int = 0


class LLMProvider(ABC):
    @abstractmethod
    async def complete(self, prompt: str, timeout: int) -> LLMResponse:
        """Send prompt to LLM and return response with content and token usage."""
        ...

    @property
    @abstractmethod
    def is_configured(self) -> bool:
        """Whether API key / endpoint is set."""
        ...
