"""Durable coaching requests with progress and bounded concurrency."""

from __future__ import annotations

import json
import logging
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from contextlib import closing
from datetime import UTC, datetime
from uuid import uuid4

from fencecoach.coach.graph import EvidenceValidationError, run_coach
from fencecoach.schemas import CoachRequest
from fencecoach.settings import settings


class CoachingJobs:
    def __init__(self, repository):
        self.repository = repository
        with closing(repository._connect()) as db, db:
            db.execute(
                "CREATE TABLE IF NOT EXISTS coaching_jobs (id TEXT PRIMARY KEY, status TEXT NOT NULL, created_at TEXT NOT NULL, payload TEXT NOT NULL)"
            )

    def create(self, request: CoachRequest, mode):
        job = dict(
            job_id=uuid4().hex,
            session_id=request.session_id,
            status="queued",
            stage="Waiting for coach",
            created_at=datetime.now(UTC).isoformat(),
            request=request.model_dump(mode="json"),
            mode=mode,
            error=None,
            run_id=None,
        )
        with closing(self.repository._connect()) as db, db:
            db.execute("BEGIN IMMEDIATE")
            if (
                db.execute(
                    "SELECT count(*) FROM coaching_jobs WHERE status IN ('queued','running')"
                ).fetchone()[0]
                >= 50
            ):
                raise ValueError("Coaching queue is full. Try again shortly.")
            db.execute(
                "INSERT INTO coaching_jobs VALUES (?,?,?,?)",
                (job["job_id"], job["status"], job["created_at"], json.dumps(job)),
            )
        return self.public(job)

    @staticmethod
    def public(job):
        return {k: v for k, v in job.items() if k not in {"request", "owner", "lease_until"}}

    def get(self, job_id):
        with closing(self.repository._connect()) as db:
            row = db.execute("SELECT payload FROM coaching_jobs WHERE id=?", (job_id,)).fetchone()
            return self.public(json.loads(row[0])) if row else None

    def claim(self, owner):
        with closing(self.repository._connect()) as db, db:
            db.execute("BEGIN IMMEDIATE")
            for row in db.execute(
                "SELECT id,payload FROM coaching_jobs WHERE status='running'"
            ).fetchall():
                stale = json.loads(row[1])
                if stale.get("lease_until", 0) < time.time():
                    stale.update(
                        status="failed",
                        error="The coaching worker stopped. Submit your question again.",
                        stage="Interrupted",
                    )
                    db.execute(
                        "UPDATE coaching_jobs SET status='failed',payload=? WHERE id=?",
                        (json.dumps(stale), row[0]),
                    )
            row = db.execute(
                "SELECT id,payload FROM coaching_jobs WHERE status='queued' ORDER BY created_at LIMIT 1"
            ).fetchone()
            if not row:
                return None
            job = json.loads(row[1])
            job.update(
                status="running",
                stage="Reading session evidence",
                owner=owner,
                lease_until=time.time() + 45,
            )
            db.execute(
                "UPDATE coaching_jobs SET status='running',payload=? WHERE id=?",
                (json.dumps(job), row[0]),
            )
            return job

    def update(self, job_id, owner, **fields):
        with closing(self.repository._connect()) as db, db:
            db.execute("BEGIN IMMEDIATE")
            row = db.execute("SELECT payload FROM coaching_jobs WHERE id=?", (job_id,)).fetchone()
            job = json.loads(row[0])
            if job["status"] != "running" or job.get("owner") != owner:
                return False
            job.update(fields, lease_until=time.time() + 45)
            db.execute(
                "UPDATE coaching_jobs SET status=?,payload=? WHERE id=?",
                (job["status"], json.dumps(job), job_id),
            )
            return True


class CoachingWorker:
    def __init__(self, jobs):
        self.jobs = jobs
        self.stop = threading.Event()
        self.thread = threading.Thread(
            target=self.supervise, daemon=True, name="coaching-supervisor"
        )

    def start(self):
        self.thread.start()

    def close(self):
        self.stop.set()
        self.thread.join(timeout=3)

    def execute(self, job, owner):
        try:
            stages = {
                "gather_metrics": "Reading session evidence",
                "retrieve": "Finding relevant practice notes",
                "agent": "Planning your next practice",
                "tools": "Checking measurements and training history",
                "format_report": "Writing your coaching review",
                "validate": "Checking evidence references",
            }
            run = run_coach(
                CoachRequest.model_validate(job["request"]),
                job["mode"],
                on_step=lambda step: self.jobs.update(
                    job["job_id"], owner, stage=stages.get(step, "Reviewing evidence")
                ),
            )
            # Save run and complete job in one transaction, only while this worker owns the lease.
            with closing(self.jobs.repository._connect()) as db, db:
                db.execute("BEGIN IMMEDIATE")
                current = json.loads(
                    db.execute(
                        "SELECT payload FROM coaching_jobs WHERE id=?", (job["job_id"],)
                    ).fetchone()[0]
                )
                if current["status"] != "running" or current.get("owner") != owner:
                    return
                db.execute(
                    "INSERT INTO runs VALUES (?,?,?,?)",
                    (run.run_id, run.session_id, run.created_at.isoformat(), run.model_dump_json()),
                )
                current.update(status="completed", stage="Review ready", run_id=run.run_id)
                db.execute(
                    "UPDATE coaching_jobs SET status='completed',payload=? WHERE id=?",
                    (json.dumps(current), job["job_id"]),
                )
        except Exception as exc:
            logging.exception("Coaching job failed")
            self.jobs.update(
                job["job_id"],
                owner,
                status="failed",
                stage="Review interrupted",
                error=str(exc)[:400]
                if isinstance(exc, (EvidenceValidationError, RuntimeError))
                else "The model request was interrupted. Check the model server and submit your question again.",
            )

    def supervise(self):
        owner = uuid4().hex
        active = {}
        concurrency = max(1, min(8, settings.fencecoach_coaching_concurrency))
        with ThreadPoolExecutor(max_workers=concurrency, thread_name_prefix="coach") as pool:
            while not self.stop.wait(1):
                try:
                    for job_id, future in list(active.items()):
                        if future.done():
                            del active[job_id]
                        else:
                            self.jobs.update(job_id, owner)
                    while len(active) < concurrency:
                        job = self.jobs.claim(owner)
                        if not job:
                            break
                        active[job["job_id"]] = pool.submit(self.execute, job, owner)
                except Exception:
                    logging.exception("Coaching supervisor failed")
