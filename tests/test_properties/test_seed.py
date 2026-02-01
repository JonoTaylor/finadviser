"""Tests for property data seeding from Dropbox documents."""

from __future__ import annotations

import sqlite3
from decimal import Decimal

import pytest

from finadviser.db.repositories import AccountRepo, PropertyRepo
from finadviser.properties.equity_calculator import EquityCalculator
from finadviser.seed_properties import seed_properties


@pytest.fixture
def seeded_db(db: sqlite3.Connection) -> sqlite3.Connection:
    seed_properties(db)
    return db


def test_properties_created(seeded_db: sqlite3.Connection):
    repo = PropertyRepo(seeded_db)
    props = repo.list_properties()
    names = {p["name"] for p in props}
    assert "20 Denbigh Road" in names
    assert "249 Francis Road" in names


def test_owners_created(seeded_db: sqlite3.Connection):
    repo = PropertyRepo(seeded_db)
    owners = repo.list_owners()
    names = {o["name"] for o in owners}
    assert "Emily Pun" in names
    assert "Jono Taylor" in names


def test_denbigh_road_details(seeded_db: sqlite3.Connection):
    repo = PropertyRepo(seeded_db)
    props = repo.list_properties()
    denbigh = next(p for p in props if p["name"] == "20 Denbigh Road")

    assert denbigh["address"] == "20 Denbigh Road, London, E6 3LD"
    assert denbigh["purchase_price"] == 440000
    assert denbigh["purchase_date"] == "2022-07-08"


def test_francis_road_details(seeded_db: sqlite3.Connection):
    repo = PropertyRepo(seeded_db)
    props = repo.list_properties()
    francis = next(p for p in props if p["name"] == "249 Francis Road")

    assert francis["address"] == "249 Francis Road, Leyton, London, E10 6NW"
    assert francis["purchase_price"] == 435000
    assert francis["purchase_date"] == "2019-10-28"


def test_denbigh_mortgage_balance(seeded_db: sqlite3.Connection):
    """Denbigh mortgage balance should be ~£335,236 after principal repayments."""
    repo = AccountRepo(seeded_db)
    acc = repo.get_by_name("Mortgage - Santander - 20 Denbigh Road")
    balance = repo.get_balance(acc.id)
    # Borrowed: £337,500, principal repaid: £2,264, balance: -335,236
    assert balance == Decimal("-335236")


def test_francis_mortgage_balance(seeded_db: sqlite3.Connection):
    """Francis mortgage balance should be ~£325,916 after principal repayments."""
    repo = AccountRepo(seeded_db)
    acc = repo.get_by_name("Mortgage - Hinckley & Rugby - 249 Francis Road")
    balance = repo.get_balance(acc.id)
    # Borrowed: £337,500, principal repaid: £11,584, balance: -325,916
    assert balance == Decimal("-325916")


def test_denbigh_equity_split(seeded_db: sqlite3.Connection):
    """Emily ~80%, Jono ~20% per capital contributions."""
    repo = PropertyRepo(seeded_db)
    calc = EquityCalculator(seeded_db)

    denbigh = next(p for p in repo.list_properties() if p["name"] == "20 Denbigh Road")
    equity = calc.calculate(denbigh["id"])

    emily = next(e for e in equity if e["name"] == "Emily Pun")
    jono = next(e for e in equity if e["name"] == "Jono Taylor")

    # Emily: (80784 + 196216) = 277000 of ~347466 total
    assert emily["equity_pct"] == pytest.approx(79.7, abs=1.0)
    # Jono: (25466 + 45000) = 70466 of ~347466 total
    assert jono["equity_pct"] == pytest.approx(20.3, abs=1.0)


def test_francis_equity_not_exactly_equal(seeded_db: sqlite3.Connection):
    """Francis Road: Emily contributed more (deposit) so has higher equity share."""
    repo = PropertyRepo(seeded_db)
    calc = EquityCalculator(seeded_db)

    francis = next(p for p in repo.list_properties() if p["name"] == "249 Francis Road")
    equity = calc.calculate(francis["id"])

    emily = next(e for e in equity if e["name"] == "Emily Pun")
    jono = next(e for e in equity if e["name"] == "Jono Taylor")

    # Emily contributed £130,000 deposit + £11,800 costs + £16,252 principal + £5,792 = £163,844
    # Jono contributed £16,252 principal + £5,792 = £22,044
    # Emily ~88.1%, Jono ~11.9%
    assert emily["equity_pct"] > jono["equity_pct"]
    assert emily["capital_balance"] > jono["capital_balance"]


def test_denbigh_net_equity_positive(seeded_db: sqlite3.Connection):
    """Net equity = latest valuation - mortgage balance, should be positive."""
    repo = PropertyRepo(seeded_db)
    calc = EquityCalculator(seeded_db)

    denbigh = next(p for p in repo.list_properties() if p["name"] == "20 Denbigh Road")
    equity = calc.calculate(denbigh["id"])
    total = sum(e["equity_amount"] for e in equity)
    # Latest valuation: £685,000 - mortgage £335,236 = £349,764
    assert float(total) == pytest.approx(349764, abs=10)


def test_francis_net_equity(seeded_db: sqlite3.Connection):
    """Net equity = 450000 - 325916 = 124084."""
    repo = PropertyRepo(seeded_db)
    calc = EquityCalculator(seeded_db)

    francis = next(p for p in repo.list_properties() if p["name"] == "249 Francis Road")
    equity = calc.calculate(francis["id"])
    total = sum(e["equity_amount"] for e in equity)
    assert float(total) == pytest.approx(124084, abs=10)


def test_valuations_recorded(seeded_db: sqlite3.Connection):
    repo = PropertyRepo(seeded_db)

    denbigh = next(p for p in repo.list_properties() if p["name"] == "20 Denbigh Road")
    francis = next(p for p in repo.list_properties() if p["name"] == "249 Francis Road")

    denbigh_vals = repo.get_valuations(denbigh["id"])
    francis_vals = repo.get_valuations(francis["id"])

    assert len(denbigh_vals) >= 2
    assert len(francis_vals) >= 2

    # Latest Denbigh valuation (cost basis)
    assert denbigh_vals[0]["valuation"] == 685000

    # Latest Francis valuation
    assert francis_vals[0]["valuation"] == 450000


def test_mortgages_have_rate_history(seeded_db: sqlite3.Connection):
    """Each property should have mortgage rate history."""
    repo = PropertyRepo(seeded_db)

    for prop in repo.list_properties():
        mortgages = repo.get_mortgages(prop["id"])
        assert len(mortgages) >= 1
        for m in mortgages:
            rows = seeded_db.execute(
                "SELECT * FROM mortgage_rate_history WHERE mortgage_id = ?",
                (m["id"],),
            ).fetchall()
            assert len(rows) >= 1


def test_allocation_rules_set(seeded_db: sqlite3.Connection):
    """Both properties should have expense allocation rules."""
    repo = PropertyRepo(seeded_db)

    for prop in repo.list_properties():
        rules = repo.get_allocation_rules(prop["id"])
        assert len(rules) == 2  # one per owner
        total_pct = sum(r["allocation_pct"] for r in rules)
        assert total_pct == pytest.approx(100.0, abs=0.1)


def test_property_transfers_recorded(seeded_db: sqlite3.Connection):
    """Cross-property equity transfer should be recorded."""
    rows = seeded_db.execute("SELECT * FROM property_transfers").fetchall()
    assert len(rows) == 2  # one per owner
