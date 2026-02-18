"""Application configuration from environment."""
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    # Load from .env in backend/ or parent directory (for docker-compose)
    model_config = SettingsConfigDict(
        env_file=[".env", "../.env"],
        env_file_encoding="utf-8",
        extra="ignore",
    )

    # LLM
    llm_provider: str = "openai_compatible"  # groq | openai_compatible
    groq_api_key: str = ""
    groq_model: str = "llama-3.3-70b-versatile"  # Groq model name (e.g. llama-3.1-8b-instant, llama-3.1-70b-versatile, mixtral-8x7b-32768)
    openai_base_url: str = "http://localhost:11434/v1"  # Ollama / Exo / OpenAI-compatible
    openai_api_key: str = ""
    openai_model: str = "llama3.2"  # or gpt-4, etc.

    # Limits
    request_timeout: int = 120
    max_evidence_chars: int = 60_000
    max_log_lines: int = 300
    max_events: int = 50
    max_pods_per_workload: int = 3

    # In-cluster: set IN_CLUSTER=true when running inside Kubernetes
    in_cluster: bool = False

    # History
    history_db_path: str = "data/kubebeaver.db"


settings = Settings()
