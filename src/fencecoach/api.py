from fastapi import FastAPI, HTTPException

from fencecoach.coach.graph import coach
from fencecoach.schemas import CoachRequest, CoachingReport

app = FastAPI(
    title="FenceCoach API",
    description="Evidence-grounded coaching over fencing-session measurements.",
    version="0.1.0",
)


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.post("/coach", response_model=CoachingReport)
def create_coaching_report(request: CoachRequest) -> CoachingReport:
    try:
        return coach(request)
    except RuntimeError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
