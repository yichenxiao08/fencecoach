# Architecture and mobile path

## Implemented boundaries

- `api.py`: HTTP endpoints, request validation, static browser delivery and controlled error responses.
- `repository.py`: SQLite sessions and report runs, with per-operation connections and foreign keys.
- `coach/graph.py`: evidence gathering, retrieval, agent tool routing, structured report formatting and citation validation.
- `rag/knowledge.py`: Markdown chunking with stable per-file chunk IDs, local BM25 and optional Bedrock embeddings.
- `web/`: responsive browser client. It imports measurement JSON and calls the same API a future mobile client can use.
- `evaluation.py`: repeatable retrieval measurement over authored relevance labels.

Every run is persisted with the question, sources, model, retrieval method, activity trace, latency, token usage and report. Token counts are what the provider exposes, not cost estimates. Source ID validation checks provenance membership; it does not validate the reasoning or expertise of a coaching claim. Failed generation is not saved as a successful run.

Knowledge IDs stay stable while a file's chunk boundaries stay stable. Historical runs store the actual retrieved text, so editing a knowledge file does not rewrite old reports. More robust content-hash/version IDs can be added before a larger production corpus.

## Deployment path

1. Deploy one container to a cloud runtime with HTTPS. Keep model calls on the server. Set runtime permissions for model access.
2. Replace local SQLite with a managed database or persistent-volume strategy suitable for the chosen runtime. A container filesystem is not permanent cloud storage, and local SQLite is not designed for replicated application instances.
3. Add account authentication and enforce session ownership at every API endpoint. Store raw videos in private object storage with short-lived upload/download URLs.
4. Analyze video using a queued worker, with durable job state and progress polling. Keep large media outside the JSON coaching request.
5. Add per-user quotas, bounded upload limits, observed model costs, and monitoring before wider release.

## Phone app path

The existing UI already adapts to a narrow phone-sized browser. After HTTPS hosting, a web manifest, app icons and service worker can make it installable as a progressive web app. Offline reports may be possible; live AI and server video analysis need connectivity. Those installability features are not in this build.

A native iOS/Android interface can reuse session creation, report generation, history and export endpoints. Native camera capture and signed video upload are the main new client capabilities. API versioning and a generated typed client would help before maintaining two interfaces. Native packaging and App Store publication are separate work; the LangGraph and RAG backend can remain in Python.

## Validation performed during the first build

The local backend suite exercises the real graph in demo mode and fake live models for tool-loop limits and invalid citations. It does not verify an actual Bedrock model. Browser checks cover loading a demo and generating a cited report. Docker Desktop's daemon was unavailable locally; CI contains a container build and smoke check.
