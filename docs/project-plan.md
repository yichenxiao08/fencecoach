> Updated implementation: see [core app v0.5](core-app.md). The earlier milestones below describe the original demo.

# FenceCoach: project plan

## Goal

Build a fencing practice coach that combines measured movement data with a tool-using LLM agent. The video pipeline produces timestamped evidence; the agent retrieves relevant coaching notes, queries session measurements, and returns a cited practice report. The LLM does not judge raw video or invent biomechanical measurements.

## Product choices

- Start with foil and three actions: en garde, advance/retreat, and lunge/recovery.
- Use fixed side-on phone footage for the first dataset.
- Keep the first agent to one explicit LangGraph workflow with a small set of tools. Add multiple agents only if evaluation shows a real need.
- Keep exact numeric history in a database or typed request state. Use vector retrieval for coaching knowledge and clip summaries, not for arithmetic.
- Use authored or open-licensed coaching notes. Do not ingest copyrighted books without permission.
- No bout scoring, multi-person tracking, real-time feedback, or medical advice in the MVP.

## Architecture

```text
Phone video -> pose worker -> timestamped events + metric JSON
                                      |
Browser/API -> LangGraph agent -------+
                 |                    |
                 +-> metric tools     +-> knowledge RAG
                 +-> clip search          (cited coaching notes)
                 +-> baseline comparison
                           |
                 evidence-grounded report -> practice dashboard
```

The project plan emphasizes the LLM system: retrieval, tool calls, explicit graph state, structured output, citations, and evals. Pose estimation is a deterministic evidence producer.

## Build sequence

1. **LLM/RAG vertical slice (local):** typed session-metric input, a LangChain retriever over the small coaching library, and a LangGraph workflow with tools for metrics, baselines, and knowledge search. Return structured claims and citations.
2. **Evaluation before complexity:** create a question set with expected metric IDs and knowledge sources. Track retrieval recall@5, tool selection accuracy, citation correctness, unsupported-claim rate, latency, and token cost. Compare answers with and without RAG; manually inspect a sample rather than relying only on an LLM judge.
3. **Pose pipeline:** decode short clips, estimate landmarks, label action windows, derive a small set of reliable measures, and attach clip timestamps. Start with manually labeled clips and report event F1 and timing error.
4. **Session memory and UI:** persist sessions and trends, then add a simple dashboard with clip links and follow-up questions.
5. **MCP and cloud:** expose stable metric/history tools over MCP only after local tools work. Containerize the service, deploy first to one AWS runtime, instrument it, and track per-analysis cost. Later redeploy the same image to Azure or Google Cloud to demonstrate portability.

## Initial LLM workflow

1. Load the user's question, skill level, and exact session metrics into graph state.
2. Let the agent call `get_session_metrics`, `compare_to_baseline`, or `search_coaching_library` as needed.
3. Format a typed report with observations, evidence IDs, one next drill, and limitations.
4. Reject unsupported claims in the next iteration by validating cited metric and source IDs against tool results.

Use LangChain for model integrations, tools, embeddings, and retrievers. Use LangGraph for explicit routing, bounded tool loops, and resumable state. Keep this a single agent workflow; avoid a supervisor plus analyst plus knowledge agent plus critic until the evals justify it.

## Data and safety

- Use your own clips with participants' consent, or attributed footage whose license permits the intended use.
- Keep raw footage local for the first phase; store only derived metrics in examples.
- Store model IDs, source names, timestamps, confidence, and evaluation results so answers are reproducible.
- If pose confidence is weak, report insufficient evidence instead of giving a technique correction.
- Coaching guidance is not injury diagnosis or treatment.

## Resume evidence to collect

- Pose event F1 and timing error on manually labeled clips.
- RAG recall@5 and citation correctness on a fixed question set.
- Percentage of claims grounded in metrics or retrieved sources.
- Correct tool-call rate, p95 response latency, and cost per coaching report.
- A/B result for RAG on/off and evidence validator on/off.

Write résumé bullets only after measuring these values.

## Build status (October 3, 2026)

The first interactive build now includes a responsive browser dashboard, session measurement imports, local SQLite history, a no-account demo, the live Bedrock adapter, BM25 or optional embedding retrieval, bounded agent tooling, structured reports, citation ID validation, trace/usage metadata, exports, a retrieval baseline script, Docker packaging and GitHub Actions checks. A first local video slice now adds bounded uploads, a durable job queue, MediaPipe landmarks, PyAV previews, recovery proposals, human interval review and metric provenance. See [the pipeline notes](video-pipeline.md). Independent event labels and timing evaluation are the next milestone; this detector has no accuracy benchmark yet.

The backend API is separate from the browser client. A hosted, installable web app can reuse this interface; a native mobile client can call the same session and report endpoints. Authentication, session ownership, private object storage and a distributed job queue are required before multi-user deployment.
