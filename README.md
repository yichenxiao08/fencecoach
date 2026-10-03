# FenceCoach

FenceCoach is a local-first project for an evidence-grounded AI fencing coach. It is designed around the LLM workflow—RAG, tool use, explicit LangGraph routing, structured reports, and evaluation—with pose analysis supplying measurable evidence.

## Current build

The first vertical slice accepts session measurements and a question, exposes metric/baseline/RAG tools to a LangGraph agent, and asks the model for a structured report with citations. Video upload, pose estimation, persistent athlete history, frontend, MCP transport, and cloud deployment are planned follow-ups; they are not implemented yet.

## Run locally

1. Install Python 3.11+ and AWS CLI credentials with access to Amazon Bedrock.
2. Copy `.env.example` to `.env` and set `BEDROCK_CHAT_MODEL_ID` and `BEDROCK_EMBEDDING_MODEL_ID` to model IDs available in your AWS region.
3. Install the package and run the API:

   ```powershell
   py -m venv .venv
   .\.venv\Scripts\Activate.ps1
   pip install -e .
   uvicorn fencecoach.api:app --reload --app-dir src
   ```

4. Open `http://127.0.0.1:8000/docs` and send a `POST /coach` request with a session ID, a question, and at least one metric.

The first RAG query builds an in-memory vector index from Markdown files in `knowledge/`, using the configured Bedrock embedding model. AWS credentials are read through the normal AWS SDK credential chain; never put keys in source control.

## Example request

```json
{
  "session_id": "practice-001",
  "question": "What should I focus on in my recovery?",
  "skill_level": "beginner",
  "metrics": [
    {
      "metric_id": "attempt-04-recovery-ms",
      "name": "recovery_time",
      "value": 920,
      "unit": "ms",
      "confidence": 0.88,
      "baseline_value": 1050,
      "start_ms": 2400,
      "end_ms": 3320
    }
  ]
}
```

## Project principles

- The LLM never derives measurements from video; deterministic code does that.
- Numeric questions use metric tools. RAG finds coaching notes and clip summaries.
- Every coaching observation should cite a metric ID or a knowledge chunk ID.
- The agent has a bounded tool loop and should state when evidence is insufficient.
- Use self-authored or open-licensed knowledge material and footage you have permission to use.

See [the project plan](docs/project-plan.md) for scope, architecture, evaluation criteria, and the cloud roadmap.
