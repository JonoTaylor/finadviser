"""SQLite connection factory and initialization."""

from __future__ import annotations

import sqlite3
from pathlib import Path

from finadviser.db.schema import SCHEMA_SQL


def get_connection(db_path: Path | None = None) -> sqlite3.Connection:
    """Create a new SQLite connection with recommended settings."""
    path = str(db_path) if db_path else ":memory:"
    conn = sqlite3.connect(path)
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA foreign_keys=ON")
    conn.execute("PRAGMA busy_timeout=5000")
    conn.row_factory = sqlite3.Row
    return conn


def initialize_database(conn: sqlite3.Connection) -> None:
    """Create all tables, views, triggers, and seed data."""
    conn.executescript(SCHEMA_SQL)
    conn.commit()
