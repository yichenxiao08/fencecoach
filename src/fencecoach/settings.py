from __future__ import annotations

from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    fencecoach_chat_provider: str = "local"
    fencecoach_coaching_worker: bool = True
    fencecoach_coaching_concurrency: int = 1
    ollama_base_url: str = "http://127.0.0.1:11434"
    ollama_chat_model: str = "qwen3:4b"
    fencecoach_database_url: str = ""
    fencecoach_worker_concurrency: int = 1
    fencecoach_queue_limit: int = 100
    fencecoach_gesture_model: Path = Path("models/gestures.json")
    fencecoach_s3_bucket: str = ""
    fencecoach_s3_prefix: str = "fencecoach"
    fencecoach_s3_endpoint: str = ""
    aws_region: str = "us-east-1"
    bedrock_chat_model_id: str = ""
    bedrock_embedding_model_id: str = ""
    fencecoach_knowledge_dir: Path = Path("knowledge")
    fencecoach_db_path: Path = Path("data/fencecoach.sqlite3")
    fencecoach_video_dir: Path = Path("data/videos")
    fencecoach_pose_model: Path = Path("models/pose_landmarker_full.task")
    fencecoach_video_worker: bool = True

    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")


settings = Settings()
