"""Reproducible retrieval baseline. This does not evaluate LLM answer correctness."""

from __future__ import annotations

import argparse
import json
import time
from datetime import UTC, datetime
from pathlib import Path

from fencecoach.rag.knowledge import load_chunks, search_knowledge


def evaluate(cases: list[dict], embeddings: bool = False) -> dict:
    results = []
    for case in cases:
        start = time.perf_counter()
        hits = search_knowledge(case["query"], limit=5, use_embeddings=embeddings)
        names = [hit.source for hit in hits]
        expected = set(case["expected_sources"])
        recall = len(expected & set(names)) / len(expected)
        ranks = [index + 1 for index, name in enumerate(names) if name in expected]
        results.append(
            {
                "query": case["query"],
                "expected_sources": sorted(expected),
                "retrieved_ids": [hit.source_id for hit in hits],
                "document_recall_at_5": recall,
                "reciprocal_rank": 1 / min(ranks) if ranks else 0,
                "latency_ms": round((time.perf_counter() - start) * 1000, 3),
            }
        )
    return {
        "created_at": datetime.now(UTC).isoformat(),
        "question_count": len(results),
        "chunk_count": len(load_chunks()),
        "document_recall_at_5": sum(r["document_recall_at_5"] for r in results) / len(results),
        "mean_reciprocal_rank": sum(r["reciprocal_rank"] for r in results) / len(results),
        "mean_latency_ms": sum(r["latency_ms"] for r in results) / len(results),
        "limitations": "Small authored development set; document-level relevance labels. "
        "Not a held-out benchmark or a measure of coaching accuracy.",
        "results": results,
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--dataset", type=Path, default=Path("evals/retrieval.json"))
    parser.add_argument("--output", type=Path, default=Path("data/evals/retrieval-baseline.json"))
    parser.add_argument(
        "--embeddings", action="store_true", help="Use configured Bedrock embeddings (paid)."
    )
    args = parser.parse_args()
    cases = json.loads(args.dataset.read_text(encoding="utf-8-sig"))
    if not cases or any(not case.get("expected_sources") for case in cases):
        parser.error("Every evaluation case requires at least one expected source.")
    if args.embeddings:
        from fencecoach.settings import settings

        if not settings.bedrock_embedding_model_id:
            parser.error("Set BEDROCK_EMBEDDING_MODEL_ID before evaluating embeddings.")
    result = evaluate(cases, args.embeddings)
    result["retrieval_method"] = "bedrock-vector" if args.embeddings else "bm25"
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(result, indent=2), encoding="utf-8")
    print(json.dumps({key: value for key, value in result.items() if key != "results"}, indent=2))
    print(f"Full result: {args.output}")


if __name__ == "__main__":
    main()
