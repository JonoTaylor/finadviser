"""Tests for CSV import pipeline."""

from __future__ import annotations

import sqlite3
import shutil
from decimal import Decimal
from pathlib import Path

import pytest

from finadviser.config import AppConfig
from finadviser.db.connection import get_connection, initialize_database
from finadviser.db.repositories import AccountRepo, JournalRepo
from finadviser.importing.bank_config import BankConfig, ColumnMapping, load_bank_config
from finadviser.importing.categorizer import RuleCategorizer
from finadviser.importing.csv_parser import parse_csv
from finadviser.importing.duplicate_detector import DuplicateDetector
from finadviser.importing.import_pipeline import ImportPipeline

FIXTURES = Path(__file__).parent.parent / "fixtures"


@pytest.fixture
def config_with_bank(tmp_path) -> AppConfig:
    """Config with bank config copied to temp dir."""
    bank_dir = tmp_path / "bank_configs"
    bank_dir.mkdir()
    shutil.copy(FIXTURES / "sample_bank_config.yaml", bank_dir / "test-bank.yaml")

    cfg = AppConfig(
        data_dir=tmp_path / "data",
        db_path=tmp_path / "test.db",
        bank_configs_dir=bank_dir,
    )
    cfg.ensure_dirs()
    return cfg


def test_parse_csv():
    """Test parsing sample CSV file."""
    config = BankConfig(
        name="test",
        date_format="%d/%m/%Y",
        columns=ColumnMapping(date="Date", description="Description", amount="Amount"),
    )
    transactions = parse_csv(FIXTURES / "sample_transactions.csv", config)

    assert len(transactions) == 13
    assert transactions[0].description == "SALARY DEPOSIT"
    assert transactions[0].amount == Decimal("5000.00")
    assert transactions[1].description == "WOOLWORTHS 1234"
    assert transactions[1].amount == Decimal("-85.50")


def test_parse_csv_fingerprints():
    """Test that fingerprints are generated."""
    config = BankConfig(
        name="test",
        date_format="%d/%m/%Y",
        columns=ColumnMapping(date="Date", description="Description", amount="Amount"),
    )
    transactions = parse_csv(FIXTURES / "sample_transactions.csv", config)

    # All should have fingerprints
    for txn in transactions:
        assert txn.fingerprint
        assert len(txn.fingerprint) == 64  # SHA-256 hex


def test_duplicate_detection(db: sqlite3.Connection):
    """Test duplicate detection within and across batches."""
    config = BankConfig(
        name="test",
        date_format="%d/%m/%Y",
        columns=ColumnMapping(date="Date", description="Description", amount="Amount"),
    )
    transactions = parse_csv(FIXTURES / "sample_transactions.csv", config)

    account_repo = AccountRepo(db)
    bank = account_repo.get_by_name("Bank")

    detector = DuplicateDetector(db)
    checked = detector.check(transactions, bank.id)

    # No duplicates on first run
    assert all(not t.is_duplicate for t in checked)


def test_load_bank_config():
    """Test loading bank config from YAML."""
    config = load_bank_config(FIXTURES / "sample_bank_config.yaml")
    assert config.name == "test-bank"
    assert config.date_format == "%d/%m/%Y"
    assert config.columns.date == "Date"


def test_full_import_pipeline(db: sqlite3.Connection, config_with_bank):
    """Test the full import pipeline end-to-end."""
    pipeline = ImportPipeline(db, config_with_bank)
    result = pipeline.run(
        FIXTURES / "sample_transactions.csv",
        bank_config_name="test-bank",
        account_name="Bank",
    )

    assert result.imported_count == 13
    assert result.duplicate_count == 0
    assert result.total_count == 13

    # Verify journal entries were created
    journal_repo = JournalRepo(db)
    entries = journal_repo.list_entries(limit=100)
    assert len(entries) == 13


def test_import_dedup(db: sqlite3.Connection, config_with_bank):
    """Test that re-importing the same file detects duplicates."""
    pipeline = ImportPipeline(db, config_with_bank)

    # First import
    result1 = pipeline.run(
        FIXTURES / "sample_transactions.csv",
        bank_config_name="test-bank",
        account_name="Bank",
    )
    assert result1.imported_count == 13

    # Second import - all should be duplicates
    result2 = pipeline.run(
        FIXTURES / "sample_transactions.csv",
        bank_config_name="test-bank",
        account_name="Bank",
    )
    assert result2.imported_count == 0
    assert result2.duplicate_count == 13


def test_import_preview(db: sqlite3.Connection, config_with_bank):
    """Test preview mode doesn't write to DB."""
    pipeline = ImportPipeline(db, config_with_bank)
    preview = pipeline.preview(
        FIXTURES / "sample_transactions.csv",
        bank_config_name="test-bank",
        account_name="Bank",
    )

    assert len(preview) == 13

    # Should not have created any journal entries
    journal_repo = JournalRepo(db)
    entries = journal_repo.list_entries(limit=100)
    assert len(entries) == 0


def test_categorizer(db: sqlite3.Connection):
    """Test rule-based categorizer."""
    from finadviser.db.models import CategorizationRule, MatchType
    from finadviser.db.repositories import CategoryRepo

    cat_repo = CategoryRepo(db)
    groceries = cat_repo.get_by_name("Groceries")

    # Add a rule
    cat_repo.add_rule(CategorizationRule(
        pattern="woolworths",
        category_id=groceries.id,
        match_type=MatchType.CONTAINS,
    ))

    categorizer = RuleCategorizer(db)

    from finadviser.db.models import RawTransaction
    from datetime import date

    txns = [
        RawTransaction(date=date(2025, 1, 1), description="WOOLWORTHS 1234", amount=Decimal("-50")),
        RawTransaction(date=date(2025, 1, 1), description="UNKNOWN STORE", amount=Decimal("-30")),
    ]

    categorized = categorizer.categorize(txns)
    assert categorized[0].suggested_category_id == groceries.id
    assert categorized[1].suggested_category_id is None
