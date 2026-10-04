from __future__ import annotations

import logging
from pathlib import Path

from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from fencecoach.coach.graph import EvidenceValidationError, run_coach
from fencecoach.repository import Repository
from fencecoach.schemas import (
    CoachingReport,
    CoachRequest,
    ReportRequest,
    RunRecord,
    SessionCreate,
    SessionRecord,
)
from fencecoach.settings import settings

logger = logging.getLogger(__name__)
app = FastAPI(
    title="FenceCoach",
    version="0.3.0",
    description="Cited coaching reports over measured fencing-session data.",
)
repository = Repository(settings.fencecoach_db_path)
web = Path(__file__).parent / "web"
app.mount("/static", StaticFiles(directory=web), name="static")


@app.get("/", include_in_schema=False)
def dashboard():
    return FileResponse(web / "index.html")


@app.get("/health")
def health():
    return {"status": "ok", "version": "0.3.0"}


@app.get("/api/config")
def configuration():
    return {
        "live_configured": bool(settings.bedrock_chat_model_id),
        "embedding_configured": bool(settings.bedrock_embedding_model_id),
        "region": settings.aws_region,
        "model_id": settings.bedrock_chat_model_id or None,
        "demo_available": True,
    }


@app.get("/api/sessions", response_model=list[SessionRecord])
def list_sessions():
    return repository.list_sessions()


@app.post("/api/sessions", response_model=SessionRecord, status_code=201)
def create_session(data: SessionCreate):
    return repository.create_session(data)


@app.post("/api/demo", response_model=SessionRecord, status_code=201)
def load_demo():
    data = SessionCreate.model_validate_json(
        (web / "sample-session.json").read_text(encoding="utf-8-sig")
    )
    return repository.create_session(data, is_demo=True)


@app.get("/api/sessions/{session_id}", response_model=SessionRecord)
def get_session(session_id: str):
    result = repository.get_session(session_id)
    if not result:
        raise HTTPException(404, "Session not found.")
    return result


@app.get("/api/sessions/{session_id}/reports", response_model=list[RunRecord])
def list_reports(session_id: str):
    get_session(session_id)
    return repository.list_runs(session_id)


def _report_or_error(request: CoachRequest, mode: str):
    try:
        return run_coach(request, mode)
    except EvidenceValidationError as exc:
        raise HTTPException(422, str(exc)) from exc
    except RuntimeError as exc:
        raise HTTPException(503, str(exc)) from exc
    except Exception as exc:
        logger.exception("Coaching provider failed")
        raise HTTPException(
            502,
            "The AI provider request failed. Check model access, AWS credentials "
            "and the server log, or choose Demo mode.",
        ) from exc


@app.post("/api/sessions/{session_id}/reports", response_model=RunRecord, status_code=201)
def create_report(session_id: str, data: ReportRequest):
    session = get_session(session_id)
    if data.focus_metric_id and not any(
        metric.metric_id == data.focus_metric_id for metric in session.metrics
    ):
        raise HTTPException(422, "The selected measurement is not in this session.")
    request = CoachRequest(
        session_id=session.session_id,
        question=data.question,
        skill_level=session.skill_level,
        metrics=session.metrics,
        focus_metric_id=data.focus_metric_id,
    )
    return repository.save_run(_report_or_error(request, data.mode))


@app.get("/api/reports/{run_id}", response_model=RunRecord)
def get_report(run_id: str):
    run = repository.get_run(run_id)
    if not run:
        raise HTTPException(404, "Report not found.")
    return run


@app.post("/coach", response_model=CoachingReport)
def original_coaching_endpoint(request: CoachRequest):
    return _report_or_error(request, "bedrock").report
