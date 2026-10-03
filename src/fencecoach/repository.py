from __future__ import annotations

import sqlite3
from contextlib import closing
from datetime import UTC, datetime
from pathlib import Path
from uuid import uuid4

from fencecoach.schemas import RunRecord, SessionCreate, SessionRecord


class Repository:
    """Local SQLite store. Each operation owns its connection for worker-thread safety."""

    def __init__(self, path: Path):
        self.path = path

    def _connect(self):
        self.path.parent.mkdir(parents=True, exist_ok=True)
        db = sqlite3.connect(self.path, timeout=10)
        db.execute("PRAGMA foreign_keys = ON")
        db.execute("PRAGMA journal_mode = WAL")
        db.execute(
            "CREATE TABLE IF NOT EXISTS sessions "
            "(id TEXT PRIMARY KEY, created_at TEXT NOT NULL, payload TEXT NOT NULL)"
        )
        db.execute(
            "CREATE TABLE IF NOT EXISTS runs "
            "(id TEXT PRIMARY KEY, session_id TEXT NOT NULL REFERENCES sessions(id), "
            "created_at TEXT NOT NULL, payload TEXT NOT NULL)"
        )
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
            return [RunRecord.model_validate_json(row[0]) for row in rows]

    def get_run(self, run_id: str) -> RunRecord | None:
        with closing(self._connect()) as db:
            row = db.execute("SELECT payload FROM runs WHERE id = ?", (run_id,)).fetchone()
        return RunRecord.model_validate_json(row[0]) if row else None
