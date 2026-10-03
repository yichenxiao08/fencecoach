from __future__ import annotations

from pathlib import Path
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    aws_region: str = "us-east-1"
    bedrock_chat_model_id: str = ""
    bedrock_embedding_model_id: str = ""
    fencecoach_knowledge_dir: Path = Path("knowledge")
    fencecoach_vector_cache_dir: Path = Path("data/vector-cache")

    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")


settings = Settings()
