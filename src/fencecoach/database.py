"""SQLite for local use; PostgreSQL transactions for independent API/worker replicas."""

from __future__ import annotations

import sqlite3
from pathlib import Path

from fencecoach.settings import settings


class Database:
    def __init__(self, path: Path):
        self.postgres = bool(settings.fencecoach_database_url)
        if self.postgres:
            import psycopg

            self.connection = psycopg.connect(settings.fencecoach_database_url)
        else:
            path.parent.mkdir(parents=True, exist_ok=True)
            self.connection = sqlite3.connect(path, timeout=30)
            self.connection.execute("PRAGMA journal_mode=WAL")
            self.connection.execute("PRAGMA foreign_keys=ON")

    def execute(self, sql, params=()):
        # Only application-owned SQL is passed here. No SQL comes from an LLM or client.
        if self.postgres:
            sql = sql.replace("?", "%s")
            if sql == "BEGIN IMMEDIATE":
                sql = "SELECT pg_advisory_xact_lock(740)"
        return self.connection.execute(sql, params)

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc, traceback):
        if exc_type:
            self.connection.rollback()
        else:
            self.connection.commit()

    def close(self):
        self.connection.close()
