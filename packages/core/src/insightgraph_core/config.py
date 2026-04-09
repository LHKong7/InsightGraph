from pathlib import Path

from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    """InsightGraph configuration loaded from environment variables with IG_ prefix."""

    # Neo4j
    neo4j_uri: str = "bolt://localhost:7687"
    neo4j_user: str = "neo4j"
    neo4j_password: str = "insightgraph"

    # LLM
    llm_model: str = "gpt-4o-mini"
    llm_api_key: str = ""
    embedding_model: str = "text-embedding-3-small"

    # Redis / Celery
    redis_url: str = "redis://localhost:6379"
    celery_broker_url: str = "redis://localhost:6379/0"
    celery_result_backend: str = "redis://localhost:6379/1"

    # Storage
    upload_dir: Path = Path("/tmp/insightgraph/uploads")
    max_file_size_mb: int = 100

    # Extraction
    extraction_batch_size: int = 5
    extraction_max_concurrency: int = 5

    # Domain
    domain: str = "default"

    model_config = {"env_prefix": "IG_"}


def get_settings() -> Settings:
    return Settings()
