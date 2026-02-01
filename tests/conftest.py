"""Shared test fixtures."""

from __future__ import annotations

import sqlite3

import pytest

from finadviser.config import AppConfig
from finadviser.db.connection import get_connection, initialize_database


@pytest.fixture
def db() -> sqlite3.Connection:
    """In-memory database for testing."""
    conn = get_connection()
    initialize_database(conn)
    yield conn
    conn.close()


@pytest.fixture
def config(tmp_path) -> AppConfig:
    """Test configuration with temp directories."""
    cfg = AppConfig(
        data_dir=tmp_path / "data",
        db_path=tmp_path / "test.db",
        bank_configs_dir=tmp_path / "bank_configs",
        anthropic_api_key="test-key",
        currency_symbol="$",
    )
    cfg.ensure_dirs()
    return cfg
