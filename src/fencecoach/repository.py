from __future__ import annotations

from contextlib import closing
from datetime import UTC, datetime
from pathlib import Path
from uuid import uuid4

from fencecoach.database import Database
from fencecoach.schemas import (
    RunRecord,
    SessionCreate,
    SessionRecord,
    TrainingLog,
    TrainingLogCreate,
)


class Repository:
    """Local SQLite store. Each operation owns its connection for worker-thread safety."""

    def __init__(self, path: Path):
        self.path = path

    def _connect(self):
        db = Database(self.path)
        db.execute(
            "CREATE TABLE IF NOT EXISTS sessions "
            "(id TEXT PRIMARY KEY, created_at TEXT NOT NULL, payload TEXT NOT NULL)"
        )
        db.execute(
            "CREATE TABLE IF NOT EXISTS runs "
            "(id TEXT PRIMARY KEY, session_id TEXT NOT NULL REFERENCES sessions(id), "
            "created_at TEXT NOT NULL, payload TEXT NOT NULL)"
        )
        db.execute(
            "CREATE TABLE IF NOT EXISTS training_logs "
            "(id TEXT PRIMARY KEY, practiced_on TEXT NOT NULL, payload TEXT NOT NULL)"
        )
        db.execute(
            "CREATE TABLE IF NOT EXISTS practice_plans (id TEXT PRIMARY KEY, payload TEXT NOT NULL)"
        )
        db.execute("CREATE INDEX IF NOT EXISTS runs_session_date ON runs(session_id,created_at)")
        db.execute("CREATE INDEX IF NOT EXISTS logs_date ON training_logs(practiced_on)")
        db.connection.commit()
        return db

    def create_session(self, data: SessionCreate, is_demo: bool = False) -> SessionRecord:
        session = SessionRecord(
            **data.model_dump(),
            session_id=uuid4().hex,
            created_at=datetime.now(UTC),
            is_demo=is_demo,
        )
        with closing(self._connect()) as db, db:
            db.execute(
                "INSERT INTO sessions VALUES (?, ?, ?)",
                (session.session_id, session.created_at.isoformat(), session.model_dump_json()),
            )
        return session

    def list_sessions(self) -> list[SessionRecord]:
        with closing(self._connect()) as db:
            rows = db.execute("SELECT payload FROM sessions ORDER BY created_at DESC LIMIT 200")
            return [SessionRecord.model_validate_json(row[0]) for row in rows]

    def get_session(self, session_id: str) -> SessionRecord | None:
        with closing(self._connect()) as db:
            row = db.execute("SELECT payload FROM sessions WHERE id = ?", (session_id,)).fetchone()
        return SessionRecord.model_validate_json(row[0]) if row else None

    def save_run(self, run: RunRecord) -> RunRecord:
        with closing(self._connect()) as db, db:
            db.execute(
                "INSERT INTO runs VALUES (?, ?, ?, ?)",
                (
                    run.run_id,
                    run.session_id,
                    run.created_at.isoformat(),
                    run.model_dump_json(),
                ),
            )
        return run

    def list_runs(self, session_id: str) -> list[RunRecord]:
        with closing(self._connect()) as db:
            rows = db.execute(
                "SELECT payload FROM runs WHERE session_id = ? ORDER BY created_at DESC LIMIT 50",
                (session_id,),
            )
            return [
                run
                for row in rows
                if (run := RunRecord.model_validate_json(row[0])).mode == "demo"
                or (run.report.observations and run.citation_ids_valid)
            ]

    def get_run(self, run_id: str) -> RunRecord | None:
        with closing(self._connect()) as db:
            row = db.execute("SELECT payload FROM runs WHERE id = ?", (run_id,)).fetchone()
        return RunRecord.model_validate_json(row[0]) if row else None

    def list_logs(self) -> list[TrainingLog]:
        with closing(self._connect()) as db:
            rows = db.execute(
                "SELECT payload FROM training_logs ORDER BY practiced_on DESC LIMIT 1000"
            )
            return [TrainingLog.model_validate_json(row[0]) for row in rows]

    def save_log(self, data: TrainingLogCreate, log_id: str | None = None) -> TrainingLog:
        if data.session_id and not self.get_session(data.session_id):
            raise ValueError("The linked review does not exist.")
        now = datetime.now(UTC)
        with closing(self._connect()) as db, db:
            old = (
                db.execute("SELECT payload FROM training_logs WHERE id=?", (log_id,)).fetchone()
                if log_id
                else None
            )
            if log_id and not old:
                raise KeyError("Training log not found.")
            log = TrainingLog(
                **data.model_dump(),
                log_id=log_id or uuid4().hex,
                created_at=TrainingLog.model_validate_json(old[0]).created_at if old else now,
                updated_at=now,
            )
            db.execute(
                "INSERT INTO training_logs VALUES (?,?,?) ON CONFLICT(id) DO UPDATE SET practiced_on=excluded.practiced_on,payload=excluded.payload",
                (log.log_id, log.practiced_on.isoformat(), log.model_dump_json()),
            )
        return log

    def delete_log(self, log_id):
        with closing(self._connect()) as db, db:
            result = db.execute("DELETE FROM training_logs WHERE id=?", (log_id,))
            return result.rowcount > 0

    def coaching_context(self, session_id):
        logs = [
            {**log.model_dump(mode="json"), "notes": log.notes[:200]}
            for log in self.list_logs()[:14]
        ]
        reviews = [
            {
                "run_id": r.run_id,
                "question": r.question[:300],
                "summary": r.report.summary[:450],
                "next_drill": r.report.next_drill.model_dump() if r.report.next_drill else None,
            }
            for r in reversed(self.list_runs(session_id)[:6])
        ]
        history = [
            {
                "session_id": session.session_id,
                "title": session.title,
                "date": str(session.practiced_on or session.created_at.date()),
                "capture_profile": session.capture_profile,
                "metrics": [
                    {k: v for k, v in m.model_dump(mode="json").items() if k != "provenance"}
                    for m in session.metrics[:120]
                ],
            }
            for session in self.list_sessions()
            if session.session_id != session_id and not session.is_demo
        ][:10]
        return {"training_history": logs, "previous_reviews": reviews, "session_history": history}

    def list_plans(self):
        import json

        with closing(self._connect()) as db:
            return sorted(
                [json.loads(row[0]) for row in db.execute("SELECT payload FROM practice_plans")],
                key=lambda plan: plan["created_at"],
            )

    def save_plan(self, run_id):
        import json

        run = self.get_run(run_id)
        if not run or not run.report.next_drill:
            raise ValueError("This review has no supported practice recommendation to save.")
        plan = {
            "plan_id": run_id,
            "session_id": run.session_id,
            "created_at": run.created_at.isoformat(),
            "mode": run.mode,
            **run.report.next_drill.model_dump(),
        }
        with closing(self._connect()) as db, db:
            db.execute(
                "INSERT INTO practice_plans VALUES (?,?) ON CONFLICT(id) DO NOTHING",
                (run_id, json.dumps(plan)),
            )
        return plan
