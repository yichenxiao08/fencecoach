"""Explicit provider selection: sample reports never masquerade as a live LLM."""

from __future__ import annotations

import json
from urllib.error import URLError
from urllib.request import urlopen

from fencecoach.settings import settings


def provider_status():
    model_ready = False
    error = None
    try:
        with urlopen(settings.ollama_base_url.rstrip("/") + "/api/tags", timeout=2) as response:
            models = json.load(response).get("models", [])
        model_ready = any(m.get("name") == settings.ollama_chat_model for m in models)
    except (URLError, TimeoutError, ValueError, OSError):
        error = "Local model server is not running."
    provider = settings.fencecoach_chat_provider
    return {
        "provider": provider,
        "local_ready": model_ready,
        "bedrock_ready": bool(settings.bedrock_chat_model_id),
        "live_configured": model_ready
        if provider == "local"
        else bool(settings.bedrock_chat_model_id),
        "model_id": settings.ollama_chat_model
        if provider == "local"
        else settings.bedrock_chat_model_id,
        "local_error": error
        or (None if model_ready else "The selected local model is not downloaded."),
    }


def chat_model(mode):
    if mode == "local":
        from langchain_ollama import ChatOllama

        if not provider_status()["local_ready"]:
            raise RuntimeError(
                "Local coaching model is not ready. Start Ollama and pull the configured model."
            )
        return ChatOllama(
            model=settings.ollama_chat_model,
            base_url=settings.ollama_base_url,
            temperature=0,
            reasoning=False,
            num_ctx=8192,
            num_predict=1200,
            client_kwargs={"timeout": 180},
        )
    if mode == "bedrock":
        from botocore.config import Config
        from langchain_aws import ChatBedrockConverse

        if not settings.bedrock_chat_model_id:
            raise RuntimeError(
                "Configure BEDROCK_CHAT_MODEL_ID and AWS credentials for cloud coaching."
            )
        return ChatBedrockConverse(
            model=settings.bedrock_chat_model_id,
            region_name=settings.aws_region,
            temperature=0,
            config=Config(connect_timeout=10, read_timeout=120, retries={"max_attempts": 1}),
        )
    return None
