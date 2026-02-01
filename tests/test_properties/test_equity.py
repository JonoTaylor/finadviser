"""Tests for property equity calculations."""

from __future__ import annotations

import sqlite3
from datetime import date
from decimal import Decimal

import pytest

from finadviser.db.models import Account, AccountType, BookEntry, JournalEntry
from finadviser.db.repositories import AccountRepo, JournalRepo, PropertyRepo
from finadviser.properties.equity_calculator import EquityCalculator
from finadviser.properties.transfer_engine import TransferEngine


@pytest.fixture
def property_setup(db: sqlite3.Connection):
    """Set up a property with two owners."""
    account_repo = AccountRepo(db)
    prop_repo = PropertyRepo(db)
    journal_repo = JournalRepo(db)

    # Create property
    prop_id = prop_repo.create_property({
        "name": "123 Main St",
        "address": "123 Main Street",
        "purchase_date": "2024-01-01",
        "purchase_price": 500000,
    })

    # Create owners
    owner_a = prop_repo.create_owner("Alice")
    owner_b = prop_repo.create_owner("Bob")

    # Create capital accounts
    cap_a_id = account_repo.create(Account(
        name="Capital - Alice - 123 Main St",
        account_type=AccountType.EQUITY,
    ))
    cap_b_id = account_repo.create(Account(
        name="Capital - Bob - 123 Main St",
        account_type=AccountType.EQUITY,
    ))

    # Link ownership
    prop_repo.add_ownership(prop_id, owner_a, cap_a_id)
    prop_repo.add_ownership(prop_id, owner_b, cap_b_id)

    # Add valuation
    prop_repo.add_valuation(prop_id, 550000, "2025-01-01")

    # Create mortgage liability account
    mortgage_liability_id = account_repo.create(Account(
        name="Mortgage - 123 Main St",
        account_type=AccountType.LIABILITY,
    ))

    # Record initial mortgage
    prop_repo.create_mortgage({
        "property_id": prop_id,
        "lender": "Big Bank",
        "original_amount": 400000,
        "start_date": "2024-01-01",
        "term_months": 360,
        "liability_account_id": mortgage_liability_id,
    })

    # Set mortgage balance via book entry
    equity_account = account_repo.get_or_create("Mortgage Setup", AccountType.EQUITY)
    journal_repo.create_entry(
        JournalEntry(date=date(2024, 1, 1), description="Initial mortgage"),
        [
            BookEntry(journal_entry_id=0, account_id=mortgage_liability_id, amount=Decimal("-400000")),
            BookEntry(journal_entry_id=0, account_id=equity_account.id, amount=Decimal("400000")),
        ],
    )

    # Record capital contributions
    # Alice contributed 60k deposit
    contrib_account = account_repo.get_or_create("Deposit Contributions", AccountType.EQUITY)
    journal_repo.create_entry(
        JournalEntry(date=date(2024, 1, 1), description="Alice deposit contribution"),
        [
            BookEntry(journal_entry_id=0, account_id=cap_a_id, amount=Decimal("60000")),
            BookEntry(journal_entry_id=0, account_id=contrib_account.id, amount=Decimal("-60000")),
        ],
    )

    # Bob contributed 40k deposit
    journal_repo.create_entry(
        JournalEntry(date=date(2024, 1, 1), description="Bob deposit contribution"),
        [
            BookEntry(journal_entry_id=0, account_id=cap_b_id, amount=Decimal("40000")),
            BookEntry(journal_entry_id=0, account_id=contrib_account.id, amount=Decimal("-40000")),
        ],
    )

    return {
        "property_id": prop_id,
        "owner_a": owner_a,
        "owner_b": owner_b,
        "cap_a_id": cap_a_id,
        "cap_b_id": cap_b_id,
        "mortgage_liability_id": mortgage_liability_id,
    }


def test_equity_calculation(db: sqlite3.Connection, property_setup):
    """Test basic equity calculation."""
    calc = EquityCalculator(db)
    equity = calc.calculate(property_setup["property_id"])

    assert len(equity) == 2

    # Alice has 60k of 100k total capital = 60%
    alice = next(e for e in equity if e["name"] == "Alice")
    assert alice["equity_pct"] == pytest.approx(60.0)
    assert alice["capital_balance"] == Decimal("60000")

    # Bob has 40k of 100k total capital = 40%
    bob = next(e for e in equity if e["name"] == "Bob")
    assert bob["equity_pct"] == pytest.approx(40.0)
    assert bob["capital_balance"] == Decimal("40000")

    # Market equity = valuation(550k) - mortgage(400k) = 150k
    # Alice: 60% of 150k = 90k
    assert float(alice["equity_amount"]) == pytest.approx(90000, abs=1)
    # Bob: 40% of 150k = 60k
    assert float(bob["equity_amount"]) == pytest.approx(60000, abs=1)


def test_equity_after_principal_payment(db: sqlite3.Connection, property_setup):
    """Test equity changes after mortgage principal payment by one owner."""
    account_repo = AccountRepo(db)
    journal_repo = JournalRepo(db)

    # Alice pays 10k in principal
    contrib_account = account_repo.get_or_create("Principal Contributions", AccountType.EQUITY)
    journal_repo.create_entry(
        JournalEntry(date=date(2025, 1, 1), description="Alice principal payment"),
        [
            BookEntry(journal_entry_id=0, account_id=property_setup["cap_a_id"], amount=Decimal("10000")),
            BookEntry(journal_entry_id=0, account_id=contrib_account.id, amount=Decimal("-10000")),
        ],
    )

    # Reduce mortgage
    equity_account = account_repo.get_or_create("Mortgage Payments", AccountType.EQUITY)
    journal_repo.create_entry(
        JournalEntry(date=date(2025, 1, 1), description="Mortgage principal reduction"),
        [
            BookEntry(journal_entry_id=0, account_id=property_setup["mortgage_liability_id"], amount=Decimal("10000")),
            BookEntry(journal_entry_id=0, account_id=equity_account.id, amount=Decimal("-10000")),
        ],
    )

    calc = EquityCalculator(db)
    equity = calc.calculate(property_setup["property_id"])

    alice = next(e for e in equity if e["name"] == "Alice")
    bob = next(e for e in equity if e["name"] == "Bob")

    # Alice now has 70k of 110k total capital ≈ 63.6%
    assert alice["capital_balance"] == Decimal("70000")
    assert alice["equity_pct"] == pytest.approx(63.636, abs=0.1)

    # Market equity = 550k - 390k = 160k
    assert float(alice["equity_amount"]) == pytest.approx(101818, abs=100)


def test_cross_property_transfer(db: sqlite3.Connection, property_setup):
    """Test equity transfer between properties."""
    account_repo = AccountRepo(db)
    prop_repo = PropertyRepo(db)

    # Create second property
    prop2_id = prop_repo.create_property({
        "name": "456 Oak Ave",
        "purchase_date": "2025-01-01",
        "purchase_price": 300000,
    })

    # Alice is owner of both
    cap_a2_id = account_repo.create(Account(
        name="Capital - Alice - 456 Oak Ave",
        account_type=AccountType.EQUITY,
    ))
    prop_repo.add_ownership(prop2_id, property_setup["owner_a"], cap_a2_id)

    # Transfer 20k equity from property 1 to property 2
    engine = TransferEngine(db)
    journal_id = engine.transfer_equity(
        from_property_id=property_setup["property_id"],
        to_property_id=prop2_id,
        owner_id=property_setup["owner_a"],
        amount=Decimal("20000"),
        transfer_date=date(2025, 6, 1),
    )

    assert journal_id > 0

    # Check balances
    alice_cap1 = account_repo.get_balance(property_setup["cap_a_id"])
    alice_cap2 = account_repo.get_balance(cap_a2_id)

    assert alice_cap1 == Decimal("40000")  # 60k - 20k
    assert alice_cap2 == Decimal("20000")  # 0 + 20k

    # Verify transfer record
    transfers = engine.get_transfers(property_id=property_setup["property_id"])
    assert len(transfers) == 1
    assert transfers[0]["amount"] == 20000


def test_calculate_all_properties(db: sqlite3.Connection, property_setup):
    """Test calculating equity for all properties."""
    calc = EquityCalculator(db)
    all_equity = calc.calculate_all()

    assert property_setup["property_id"] in all_equity
    assert len(all_equity[property_setup["property_id"]]) == 2
