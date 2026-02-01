"""Tests for database schema creation and integrity."""

from __future__ import annotations

import sqlite3
from datetime import date
from decimal import Decimal

import pytest

from finadviser.db.models import Account, AccountType, BookEntry, Category, JournalEntry
from finadviser.db.repositories import AccountRepo, CategoryRepo, JournalRepo


def test_tables_created(db: sqlite3.Connection):
    """Verify all expected tables exist."""
    tables = {
        row[0]
        for row in db.execute(
            "SELECT name FROM sqlite_master WHERE type='table'"
        ).fetchall()
    }
    expected = {
        "accounts", "categories", "categorization_rules",
        "journal_entries", "book_entries",
        "import_batches", "transaction_fingerprints",
        "properties", "owners", "property_ownership",
        "mortgages", "mortgage_rate_history",
        "property_valuations", "equity_snapshots",
        "property_transfers", "expense_allocation_rules",
        "ai_conversations", "ai_messages",
    }
    assert expected.issubset(tables)


def test_default_accounts_created(db: sqlite3.Connection):
    """Verify system accounts are seeded."""
    repo = AccountRepo(db)
    bank = repo.get_by_name("Bank")
    assert bank is not None
    assert bank.account_type == AccountType.ASSET
    assert bank.is_system


def test_default_categories_created(db: sqlite3.Connection):
    """Verify system categories are seeded."""
    repo = CategoryRepo(db)
    cats = repo.list_all()
    cat_names = {c.name for c in cats}
    assert "Groceries" in cat_names
    assert "Transport" in cat_names
    assert "Uncategorized" in cat_names


def test_double_entry_balance_enforcement(db: sqlite3.Connection):
    """Verify that unbalanced journal entries are rejected."""
    repo = JournalRepo(db)
    account_repo = AccountRepo(db)

    bank = account_repo.get_by_name("Bank")
    expense = account_repo.get_by_name("Uncategorized Expense")

    journal = JournalEntry(date=date(2025, 1, 1), description="Test")

    # Unbalanced entries should raise
    with pytest.raises(ValueError, match="sum to zero"):
        repo.create_entry(journal, [
            BookEntry(journal_entry_id=0, account_id=bank.id, amount=Decimal("-100")),
            BookEntry(journal_entry_id=0, account_id=expense.id, amount=Decimal("50")),
        ])


def test_balanced_entry_succeeds(db: sqlite3.Connection):
    """Verify that balanced journal entries are accepted."""
    repo = JournalRepo(db)
    account_repo = AccountRepo(db)

    bank = account_repo.get_by_name("Bank")
    expense = account_repo.get_by_name("Uncategorized Expense")

    journal = JournalEntry(date=date(2025, 1, 1), description="Groceries")
    journal_id = repo.create_entry(journal, [
        BookEntry(journal_entry_id=0, account_id=bank.id, amount=Decimal("-50")),
        BookEntry(journal_entry_id=0, account_id=expense.id, amount=Decimal("50")),
    ])

    assert journal_id > 0

    # Verify balance
    balance = account_repo.get_balance(bank.id)
    assert balance == Decimal("-50")


def test_crud_operations(db: sqlite3.Connection):
    """Test basic CRUD on accounts and categories."""
    account_repo = AccountRepo(db)
    cat_repo = CategoryRepo(db)

    # Create account
    new_acc = Account(name="Savings", account_type=AccountType.ASSET, description="Savings account")
    acc_id = account_repo.create(new_acc)
    assert acc_id > 0

    # Read
    fetched = account_repo.get_by_id(acc_id)
    assert fetched.name == "Savings"

    # List by type
    assets = account_repo.list_by_type(AccountType.ASSET)
    assert any(a.name == "Savings" for a in assets)

    # Create category
    new_cat = Category(name="Subscriptions")
    cat_id = cat_repo.create(new_cat)
    assert cat_id > 0

    fetched_cat = cat_repo.get_by_id(cat_id)
    assert fetched_cat.name == "Subscriptions"


def test_views_work(db: sqlite3.Connection):
    """Verify views return data."""
    # v_account_balances should work even with no entries
    rows = db.execute("SELECT * FROM v_account_balances").fetchall()
    assert len(rows) >= 4  # system accounts
