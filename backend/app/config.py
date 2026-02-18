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
    max_compare_chars: int = 8_000  # Max chars sent to LLM for compare (diff + minimal context)
    max_log_lines: int = 300
    max_events: int = 50
    max_pods_per_workload: int = 3

    # Scan
    scan_max_findings: int = 200  # Cap findings per scan to bound payload
    scan_pending_minutes: int = 5  # Pod Pending longer than this = finding

    # In-cluster: set IN_CLUSTER=true when running inside Kubernetes
    in_cluster: bool = False

    # History / Database
    history_db_path: str = "data/kubebeaver.db"  # Used when DATABASE_URL is not set (SQLite)
    database_url: str = ""  # Optional: e.g. mysql+aiomysql://user:pass@host/db or postgresql+asyncpg://user:pass@host/db

    # Redis cache (optional: leave empty to disable cache)
    redis_url: str = ""  # e.g. redis://localhost:6379/0
    cache_ttl_contexts: int = 60  # seconds
    cache_ttl_namespaces: int = 60
    cache_ttl_resources: int = 30
    cache_ttl_analyze: int = 300  # 5 minutes


settings = Settings()
