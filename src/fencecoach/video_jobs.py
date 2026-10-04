"""Durable local queue. One API process owns the supervisor; no distributed scheduling."""

from __future__ import annotations

import importlib.util
import json
import logging
import multiprocessing
import sqlite3
import threading
import time
from contextlib import closing
from datetime import UTC, datetime
from pathlib import Path
from uuid import uuid4

from pydantic import BaseModel, Field, model_validator

from fencecoach.schemas import MetricObservation, SessionCreate, SessionRecord, VideoProvenance

MAX_BYTES = 200 * 1024 * 1024
MAX_SECONDS = 120
METHOD = "stance-return-v1"
MODEL_SHA = "4eaa5eb7a98365221087693fcc286334cf0858e2eb6e15b506aa4a7ecdcec4ad"
DEMO_URL = "https://archive.org/download/MITPE.740S06/jumpe_lunge-220k_512kb.mp4"
DEMO_SHA = "f656156eda327753e7fd0dfd14c5e885ae0d4cb5dd489982627bcd2358ae27ed"
DEMO_PAGE = "https://ocw.mit.edu/courses/pe-740-fencing-spring-2007/pages/video/"


class Crop(BaseModel):
    x: float = Field(default=0, ge=0, lt=1)
    y: float = Field(default=0, ge=0, lt=1)
    width: float = Field(default=1, gt=0.1, le=1)
    height: float = Field(default=1, gt=0.1, le=1)

    @model_validator(mode="after")
    def fits(self):
        if self.x + self.width > 1.00001 or self.y + self.height > 1.00001:
            raise ValueError("Crop must fit inside the frame.")
        return self


class ReviewWindow(BaseModel):
    start_ms: int = Field(ge=0)
    end_ms: int = Field(gt=0)
    candidate_id: str | None = None

    @model_validator(mode="after")
    def ordered(self):
        if self.end_ms <= self.start_ms:
            raise ValueError("Recovery end must follow the lunge peak.")
        return self


class AcceptReview(BaseModel):
    windows: list[ReviewWindow] = Field(min_length=1, max_length=50)
    notes: str = Field(default="", max_length=2000)


class VideoJobs:
    def __init__(self, db_path: Path, directory: Path):
        self.db_path, self.directory = Path(db_path), Path(directory)
        self.db_path.parent.mkdir(parents=True, exist_ok=True)
        with closing(self.connect()) as db, db:
            db.execute(
                "CREATE TABLE IF NOT EXISTS video_jobs "
                "(id TEXT PRIMARY KEY, created_at TEXT, status TEXT, payload TEXT)"
            )

    def connect(self):
        return sqlite3.connect(self.db_path, timeout=10)

    def get(self, job_id):
        with closing(self.connect()) as db:
            row = db.execute("SELECT payload FROM video_jobs WHERE id=?", (job_id,)).fetchone()
        return json.loads(row[0]) if row else None

    def list(self):
        with closing(self.connect()) as db:
            rows = db.execute("SELECT payload FROM video_jobs ORDER BY created_at DESC LIMIT 20")
            return [json.loads(row[0]) for row in rows]

    def create(self, title, skill, crop, source="upload"):
        job = dict(
            job_id=uuid4().hex,
            title=title,
            skill_level=skill,
            crop=crop.model_dump(),
            source=source,
            status="receiving",
            progress=0,
            stage="Saving upload",
            created_at=datetime.now(UTC).isoformat(),
            error=None,
            session_id=None,
        )
        with closing(self.connect()) as db, db:
            db.execute("BEGIN IMMEDIATE")
            count = db.execute(
                "SELECT count(*) FROM video_jobs WHERE status IN ('receiving','queued','running')"
            ).fetchone()[0]
            if count >= 5:
                raise ValueError("The local queue is full. Wait for a clip to finish.")
            db.execute(
                "INSERT INTO video_jobs VALUES (?,?,?,?)",
                (job["job_id"], job["created_at"], job["status"], json.dumps(job)),
            )
        return job

    def update(self, job_id, **fields):
        with closing(self.connect()) as db, db:
            db.execute("BEGIN IMMEDIATE")
            row = db.execute("SELECT payload FROM video_jobs WHERE id=?", (job_id,)).fetchone()
            if not row:
                return
            job = json.loads(row[0])
            job.update(fields)
            db.execute(
                "UPDATE video_jobs SET status=?,payload=? WHERE id=?",
                (job["status"], json.dumps(job), job_id),
            )
        return job

    def claim(self):
        with closing(self.connect()) as db, db:
            db.execute("BEGIN IMMEDIATE")
            row = db.execute(
                "SELECT id,payload FROM video_jobs WHERE status='queued' "
                "ORDER BY created_at LIMIT 1"
            ).fetchone()
            if not row:
                return None
            job = json.loads(row[1])
            # Upload endpoints create the queue entry only after source.mp4 is complete.
            job.update(status="running", stage="Opening video", progress=2)
            db.execute(
                "UPDATE video_jobs SET status='running',payload=? WHERE id=?",
                (json.dumps(job), row[0]),
            )
        return job

    def accept(self, job_id, review: AcceptReview, result):
        with closing(self.connect()) as db, db:
            db.execute("BEGIN IMMEDIATE")
            row = db.execute("SELECT payload FROM video_jobs WHERE id=?", (job_id,)).fetchone()
            if not row:
                raise ValueError("Analysis not found.")
            job = json.loads(row[0])
            if job.get("session_id"):
                saved = db.execute(
                    "SELECT payload FROM sessions WHERE id=?", (job["session_id"],)
                ).fetchone()
                return SessionRecord.model_validate_json(saved[0])
            if job["status"] != "review_ready":
                raise ValueError("Wait for analysis before saving a review.")
            ordered = sorted(review.windows, key=lambda w: w.start_ms)
            if any(a.end_ms > b.start_ms for a, b in zip(ordered, ordered[1:])):
                raise ValueError("Recovery windows cannot overlap.")
            candidates = {c["candidate_id"]: c for c in result["candidates"]}
            metrics = []
            for i, window in enumerate(ordered):
                if window.end_ms > result["duration_ms"]:
                    raise ValueError("A window extends past the video.")
                proposal = candidates.get(window.candidate_id)
                if window.candidate_id and not proposal:
                    raise ValueError("Unknown proposal ID.")
                unchanged = proposal and all(
                    window.model_dump()[key] == proposal[key] for key in ("start_ms", "end_ms")
                )
                # Manual timings have no automatic tracking-quality estimate.
                quality = proposal["quality"] if unchanged else 0
                metrics.append(
                    MetricObservation(
                        metric_id=f"video-{job_id[:10]}-recovery-{i + 1:02}",
                        name="recovery_time",
                        value=window.end_ms - window.start_ms,
                        unit="ms",
                        confidence=quality,
                        start_ms=window.start_ms,
                        end_ms=window.end_ms,
                        provenance=VideoProvenance(
                            job_id=job_id,
                            method=METHOD,
                            model_sha256=result["model_sha256"],
                            annotation="reviewed_proposal" if unchanged else "manual_window",
                            quality_note="Landmark visibility/presence proxy, not calibrated accuracy."
                            if unchanged
                            else "Manually marked timing; tracking confidence unavailable.",
                        ),
                    )
                )
            data = SessionCreate(
                title=job["title"],
                skill_level=job["skill_level"],
                notes=review.notes,
                metrics=metrics,
            )
            session = SessionRecord(
                **data.model_dump(),
                session_id=uuid4().hex,
                created_at=datetime.now(UTC),
                is_demo=job["source"] == "mit_ocw",
                video_job_id=job_id,
            )
            db.execute(
                "INSERT INTO sessions VALUES (?,?,?)",
                (session.session_id, session.created_at.isoformat(), session.model_dump_json()),
            )
            job.update(
                status="completed",
                session_id=session.session_id,
                reviewed_windows=[w.model_dump() for w in ordered],
                stage="Review saved",
            )
            db.execute(
                "UPDATE video_jobs SET status='completed',payload=? WHERE id=?",
                (json.dumps(job), job_id),
            )
        return session


def availability(model: Path):
    missing = [name for name in ("av", "mediapipe") if importlib.util.find_spec(name) is None]
    return {
        "available": not missing and model.is_file(),
        "missing": missing,
        "model_ready": model.is_file(),
        "max_seconds": MAX_SECONDS,
        "max_bytes": MAX_BYTES,
    }


def process_job(db_path, directory, model, job_id):
    jobs = VideoJobs(Path(db_path), Path(directory))
    try:
        from fencecoach.video_pipeline import analyze

        analyze(jobs, job_id, Path(model))
        jobs.update(job_id, status="review_ready", progress=100, stage="Review your time windows")
    except Exception as exc:
        logging.exception("Video analysis failed for %s", job_id)
        jobs.update(job_id, status="failed", stage="Analysis interrupted", error=str(exc)[:600])


class VideoWorker:
    """One supervised child per clip; native decoding cannot block the HTTP event loop."""

    def __init__(self, jobs, model):
        self.jobs, self.model = jobs, model
        self.stop = threading.Event()
        self.thread = threading.Thread(target=self.run, daemon=True, name="video-supervisor")

    def start(self):
        for job in self.jobs.list():
            if job["status"] in {"running", "receiving"}:
                self.jobs.update(
                    job["job_id"],
                    status="failed",
                    stage="Interrupted by restart",
                    error="Server restarted during analysis. Retry this clip.",
                )
        self.thread.start()

    def close(self):
        self.stop.set()
        self.thread.join(timeout=4)

    def run(self):
        while not self.stop.is_set():
            try:
                job = self.jobs.claim()
                if not job:
                    self.stop.wait(1)
                    continue
                child = multiprocessing.get_context("spawn").Process(
                    target=process_job,
                    args=(
                        str(self.jobs.db_path),
                        str(self.jobs.directory),
                        str(self.model),
                        job["job_id"],
                    ),
                    daemon=True,
                )
                child.start()
                started = time.monotonic()
                while child.is_alive() and not self.stop.wait(0.5):
                    if time.monotonic() - started > 600:
                        break
                if child.is_alive():
                    child.terminate()
                    child.join(timeout=2)
                    if child.is_alive():
                        child.kill()
                        child.join(timeout=2)
                    self.jobs.update(
                        job["job_id"],
                        status="failed",
                        stage="Analysis stopped",
                        error="Analysis exceeded 10 minutes or the server stopped. Retry a shorter clip.",
                    )
                else:
                    child.join()
                    if self.jobs.get(job["job_id"])["status"] == "running":
                        self.jobs.update(
                            job["job_id"],
                            status="failed",
                            stage="Worker exited",
                            error="The video worker exited unexpectedly. Retry a clearer or shorter clip.",
                        )
                child.close()
            except Exception:
                logging.exception("Video supervisor failed")
                self.stop.wait(2)
