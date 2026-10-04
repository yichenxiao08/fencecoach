# FenceCoach

A fencing training app with an evidence-grounded LLM coaching workflow. The interface combines Piste's athletic training screens, Replay Studio's immersive review, and a deliberate practice journal. The primary color is fencing-strip red, with green reserved for completed practice. The API and browser interface are separate so a mobile client can reuse the coaching backend later.

## Try it locally

Requires Python 3.12 or later. From the repository folder in PowerShell:

```powershell
py -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements.lock
.\.venv\Scripts\python.exe -m pip install -e '.[dev]'
.\.venv\Scripts\python.exe -m uvicorn fencecoach.api:app --host 127.0.0.1 --port 8000
```

Open http://127.0.0.1:8000. **Start training** opens a guided drill and camera setup. **Explore sample review** opens a synthetic session. In **Coach**, submit a question to generate a saved review. Demo mode runs the actual LangGraph workflow with a deterministic report formatter: it makes no LLM calls, requires no accounts, and does not interpret open-ended questions. Sample imagery and landmarks are illustrative, not analyzed footage.

Import your own measurements using **Import a session**. The import dialog accepts a measurement array or complete session JSON; download its synthetic format example if needed. Each measurement needs a unique source ID, name, value, unit and confidence. Timestamps and a same-unit baseline are optional. Sessions and reports survive restarts in local SQLite at `data/fencecoach.sqlite3`. Export them from the review's measurement details or the coach's report details.

**Record** supports real, silent camera capture in browsers with `getUserMedia` and `MediaRecorder`, or an existing video upload. Camera access starts on an explicit click. Captured drafts remain in memory until a measurement session is imported; attached clips are stored in this browser's IndexedDB, not uploaded to the server. Download a copy before clearing browser data or switching devices. Recording is limited to ten minutes; clip storage accepts up to 200 MB. The app does not extract measurements from video yet.

**Review** groups actual measurements by name and unit, preserves their source IDs and confidence, and seeks attached footage to supplied time windows. **Coach** passes the selected measurement ID into the existing graph while retaining the whole session as context. Saved reviews retain that focus. **Progress** computes imported session counts, weekly practice days and means for matching measurement names and units. Built-in sample sessions do not count toward goals. Dates are import dates; matching units do not establish comparable recording conditions. History currently uses the most recent 200 stored sessions.

## Design prototypes

Open http://127.0.0.1:8000/static/prototypes-compare.html to compare three clickable mobile design directions, or http://127.0.0.1:8000/static/prototypes.html for the guided gallery. Walk through training, camera setup, replay, progress and a sample coaching conversation. These prototypes use generated imagery and synthetic measurements; camera capture, playback and coach replies are simulated. See [the design study](docs/design-study.md) for references and the recommended direction.

## Live AI

Copy `.env.example` to `.env`. Set `BEDROCK_CHAT_MODEL_ID` to a Bedrock Converse model that supports tool calls and structured outputs in your AWS region. Set up AWS credentials through the normal AWS SDK credential chain, then restart the server and select **Live AI**. A configured model ID enables the option; it does not verify credentials or provider access. Provider charges apply.

Set `BEDROCK_EMBEDDING_MODEL_ID` to enable vector retrieval. Without it, live AI uses the local BM25 retriever. Demo always uses BM25. The vector index is currently rebuilt in memory after a server restart. No LangChain, LangGraph or LangSmith signup is needed, and cloud tracing is not configured.

The live workflow uses the [LangGraph graph API](https://docs.langchain.com/oss/python/langgraph/graph-api) and [LangChain Bedrock integration](https://docs.langchain.com/oss/python/integrations/chat/bedrock):

```text
session metrics -> retrieve notes -> agent -> optional tool loop -> typed report -> source ID validation
                                      ^           |
                                      +-----------+
```

Tools read exact measurements, compute same-unit baseline deltas, and retrieve coaching knowledge. Model calls are limited to three agent rounds and eight additional tool calls. A structured formatter produces the report; a deterministic validator rejects evidence IDs that are not in the session or retrieved notes. Skill level is included in the model context. Report runs expose source text, retrieval method, tool events, model ID, latency and available token usage. They do not expose model reasoning.

**Validation scope:** valid source IDs do not establish semantic correctness. Summary assertions, unsupported numeric claims, instruction injection resistance and coaching quality still require independent evaluation. A confidence threshold of 0.65 is a prototype engineering choice, not a validated sports standard. The authored coaching notes are a small development corpus, not expert-certified guidance.

## Docker

```powershell
docker compose up --build
```

The Compose service binds to localhost and keeps SQLite in a named volume. The container runs as a non-root user and includes a health check. AWS access is not included in the image: supply credentials outside the image for local live calls, and use a runtime IAM role for a later AWS deployment. Do not put credentials in Git or build arguments.

## Checks and measurement

```powershell
.\.venv\Scripts\python.exe -m unittest discover -s tests -v
.\.venv\Scripts\python.exe -m ruff check src tests scripts
.\.venv\Scripts\python.exe -m fencecoach.evaluation
```

The ten-question authored retrieval set produces document recall@5, mean reciprocal rank, per-question retrieved IDs and retrieval latency in `data/evals/retrieval-baseline.json`. The dataset is deliberately small and useful for regression work; these results are not a held-out performance benchmark or coaching accuracy score. Add independently labeled questions and distractor documents before claiming résumé metrics. `--embeddings` compares the configured Bedrock retrieval path and incurs provider charges.

Tests cover persistence, malformed measurements, invalid citations, low-confidence demo behavior, bounded model tool calls, and provider failure handling using fake models. GitHub Actions also builds the container and exercises its demo API without AWS secrets. Real Bedrock inference has not been validated locally.

## Current scope and next steps

Implemented: responsive training app with a red design system, drill library and saved drills, camera capture and device-local clip playback, measurement JSON import, actual practice history, synthetic demo, session/report storage, RAG over authored notes, live agent adapter, selected-measurement context, source ID validation, run metadata, JSON/video exports, retrieval evaluation, Docker packaging and CI.

Next: a video/pose worker with annotated event windows; a larger labeled evaluation set; session history tools; stable MCP tool transport; authentication and private object storage for synced clips; cloud deployment. Automatic video analysis, a mobile installer, MCP transport and public hosting are not implemented yet. This local app has no authentication and should remain on localhost.

See [the project plan](docs/project-plan.md) and [architecture notes](docs/architecture.md).
