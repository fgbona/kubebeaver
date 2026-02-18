"""Factory for LLM provider based on config."""
from app.config import settings
from app.llm.base import LLMProvider
from app.llm.groq_provider import GroqProvider
from app.llm.openai_compatible_provider import OpenAICompatibleProvider


def get_llm_provider() -> LLMProvider:
    p = (settings.llm_provider or "openai_compatible").strip().lower()
    if p == "groq":
        return GroqProvider()
    return OpenAICompatibleProvider()
