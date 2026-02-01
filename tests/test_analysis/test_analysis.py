"""Tests for AI analysis with mocked Claude responses."""

from __future__ import annotations

import sqlite3
from datetime import date
from decimal import Decimal
from unittest.mock import MagicMock, patch

import pytest

from finadviser.analysis.data_preparer import DataPreparer
from finadviser.analysis.schemas import (
    BatchCategorizationResult,
    BudgetAnalysis,
    SpendingAnalysis,
)
from finadviser.config import AppConfig
from finadviser.db.models import Account, AccountType, BookEntry, JournalEntry
from finadviser.db.repositories import AccountRepo, JournalRepo


@pytest.fixture
def populated_db(db: sqlite3.Connection) -> sqlite3.Connection:
    """Database with some sample transactions."""
    account_repo = AccountRepo(db)
    journal_repo = JournalRepo(db)

    bank = account_repo.get_by_name("Bank")
    expense = account_repo.get_by_name("Uncategorized Expense")
    income = account_repo.get_by_name("Uncategorized Income")

    # Add some income
    journal_repo.create_entry(
        JournalEntry(date=date(2025, 1, 1), description="Salary"),
        [
            BookEntry(journal_entry_id=0, account_id=bank.id, amount=Decimal("5000")),
            BookEntry(journal_entry_id=0, account_id=income.id, amount=Decimal("-5000")),
        ],
    )

    # Add some expenses
    for desc, amount in [
        ("Groceries", Decimal("-200")),
        ("Rent", Decimal("-1500")),
        ("Transport", Decimal("-100")),
    ]:
        journal_repo.create_entry(
            JournalEntry(date=date(2025, 1, 15), description=desc),
            [
                BookEntry(journal_entry_id=0, account_id=bank.id, amount=amount),
                BookEntry(journal_entry_id=0, account_id=expense.id, amount=-amount),
            ],
        )

    return db


def test_data_preparer_spending_context(populated_db: sqlite3.Connection, config: AppConfig):
    """Test that spending context includes relevant data."""
    preparer = DataPreparer(populated_db, config)
    context = preparer.prepare_context("What am I spending money on?")

    assert "ACCOUNT BALANCES:" in context
    assert "MONTHLY SPENDING" in context or "RECENT TRANSACTIONS" in context


def test_data_preparer_property_context(populated_db: sqlite3.Connection, config: AppConfig):
    """Test that property queries include property data."""
    preparer = DataPreparer(populated_db, config)
    context = preparer.prepare_context("How is my property equity?")

    assert "ACCOUNT BALANCES:" in context
    # Should mention properties section even if empty
    assert "PROPERT" in context.upper()


def test_data_preparer_net_worth_context(populated_db: sqlite3.Connection, config: AppConfig):
    """Test net worth context preparation."""
    preparer = DataPreparer(populated_db, config)
    context = preparer.prepare_context("What is my net worth?")

    assert "NET WORTH SUMMARY:" in context
    assert "Total Assets:" in context


def test_spending_analysis_schema():
    """Test SpendingAnalysis schema validation."""
    analysis = SpendingAnalysis(
        period="January 2025",
        total_spending=1800,
        total_income=5000,
        savings_rate=64.0,
        categories=[],
        summary="Good savings rate",
    )
    assert analysis.savings_rate == 64.0


def test_budget_analysis_schema():
    """Test BudgetAnalysis schema validation."""
    analysis = BudgetAnalysis(
        monthly_income=5000,
        needs_pct=50,
        wants_pct=30,
        savings_pct=20,
    )
    assert analysis.needs_pct + analysis.wants_pct + analysis.savings_pct == 100


@patch("finadviser.analysis.claude_client.anthropic")
def test_claude_client_chat(mock_anthropic):
    """Test Claude client with mocked API."""
    from finadviser.analysis.claude_client import ClaudeClient

    # Mock the response
    mock_message = MagicMock()
    mock_message.content = [MagicMock(text="Here is your spending analysis...")]

    mock_client = MagicMock()
    mock_client.messages.create.return_value = mock_message
    mock_anthropic.Anthropic.return_value = mock_client

    client = ClaudeClient("test-key")
    response = client.chat("Analyze my spending", "Some financial context")

    assert response == "Here is your spending analysis..."
    mock_client.messages.create.assert_called_once()


@patch("finadviser.analysis.claude_client.anthropic")
def test_claude_categorize_batch(mock_anthropic):
    """Test batch categorization with mocked API."""
    from finadviser.analysis.claude_client import ClaudeClient

    mock_message = MagicMock()
    mock_message.content = [MagicMock(text='{"WOOLWORTHS": "Groceries", "UBER": "Transport"}')]

    mock_client = MagicMock()
    mock_client.messages.create.return_value = mock_message
    mock_anthropic.Anthropic.return_value = mock_client

    client = ClaudeClient("test-key")
    result = client.categorize_batch(
        ["WOOLWORTHS", "UBER"],
        ["Groceries", "Transport", "Entertainment"],
    )

    assert result["WOOLWORTHS"] == "Groceries"
    assert result["UBER"] == "Transport"
