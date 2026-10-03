from __future__ import annotations

import math
import re
from collections import Counter
from functools import lru_cache

from langchain_core.documents import Document
from langchain_text_splitters import RecursiveCharacterTextSplitter

from fencecoach.schemas import KnowledgeSource
from fencecoach.settings import settings


@lru_cache(maxsize=1)
def load_chunks() -> list[Document]:
    root = settings.fencecoach_knowledge_dir
    paths = sorted(root.glob("*.md"))
    if not paths:
        raise RuntimeError(f"No coaching notes found in {root.resolve()}")
    splitter = RecursiveCharacterTextSplitter(chunk_size=900, chunk_overlap=120)
    chunks = []
    for path in paths:
        parts = splitter.split_text(path.read_text(encoding="utf-8-sig"))
        for index, part in enumerate(parts):
            chunks.append(
                Document(
                    page_content=part,
                    metadata={
                        "source": path.name,
                        "chunk_id": f"{path.name}#chunk-{index}",
                    },
                )
            )
    return chunks


def _terms(text: str) -> list[str]:
    return re.findall(r"[a-z0-9]+", text.lower())


def lexical_search(query: str, limit: int = 5) -> list[KnowledgeSource]:
    """Small BM25 retriever: local, inspectable, and requires no embedding account."""
    chunks = load_chunks()
    counts = [Counter(_terms(chunk.page_content)) for chunk in chunks]
    lengths = [sum(count.values()) for count in counts]
    average = sum(lengths) / len(lengths)
    scores = []
    for index, count in enumerate(counts):
        score = 0.0
        for term in set(_terms(query)):
            frequency = count[term]
            if not frequency:
                continue
            df = sum(term in doc for doc in counts)
            idf = math.log(1 + (len(chunks) - df + 0.5) / (df + 0.5))
            score += (
                idf * frequency * 2.5 / (frequency + 1.5 * (0.25 + 0.75 * lengths[index] / average))
            )
        scores.append((score, index))
    ranked = sorted(scores, key=lambda pair: (-pair[0], pair[1]))[:limit]
    return [_source(chunks[index], score) for score, index in ranked if score > 0]


def _source(doc: Document, score: float | None = None) -> KnowledgeSource:
    return KnowledgeSource(
        source_id=doc.metadata["chunk_id"],
        source=doc.metadata["source"],
        text=doc.page_content,
        score=score,
    )


@lru_cache(maxsize=1)
def get_knowledge_store():
    from langchain_aws import BedrockEmbeddings
    from langchain_core.vectorstores import InMemoryVectorStore

    embeddings = BedrockEmbeddings(
        model_id=settings.bedrock_embedding_model_id, region_name=settings.aws_region
    )
    store = InMemoryVectorStore(embeddings)
    store.add_documents(load_chunks())
    return store


def search_knowledge(query: str, limit: int = 5, use_embeddings: bool = False):
    if use_embeddings and settings.bedrock_embedding_model_id:
        return [_source(doc) for doc in get_knowledge_store().similarity_search(query, k=limit)]
    return lexical_search(query, limit)
