from __future__ import annotations

from functools import lru_cache
from pathlib import Path

from langchain_aws import BedrockEmbeddings
from langchain_core.documents import Document
from langchain_core.vectorstores import InMemoryVectorStore
from langchain_text_splitters import RecursiveCharacterTextSplitter

from fencecoach.settings import settings


@lru_cache(maxsize=1)
def get_knowledge_store() -> InMemoryVectorStore:
    """Build a small local vector index from the project's permitted knowledge files."""
    root = settings.fencecoach_knowledge_dir
    paths = sorted(root.glob("*.md")) if root.exists() else []
    if not paths:
        raise RuntimeError(f"No Markdown knowledge files found in {root.resolve()}")
    if not settings.bedrock_embedding_model_id:
        raise RuntimeError("Set BEDROCK_EMBEDDING_MODEL_ID before using RAG")

    source_docs = [
        Document(
            page_content=path.read_text(encoding="utf-8"),
            metadata={"source": path.name},
        )
        for path in paths
    ]
    splitter = RecursiveCharacterTextSplitter(chunk_size=700, chunk_overlap=100)
    chunks = splitter.split_documents(source_docs)
    for index, chunk in enumerate(chunks):
        chunk.metadata["chunk_id"] = f"{chunk.metadata['source']}#chunk-{index}"

    embeddings = BedrockEmbeddings(
        model_id=settings.bedrock_embedding_model_id,
        region_name=settings.aws_region,
    )
    store = InMemoryVectorStore(embeddings)
    store.add_documents(chunks)
    return store


def search_knowledge(query: str, limit: int = 4) -> list[Document]:
    return get_knowledge_store().similarity_search(query, k=limit)
