"""Seed the database with property data from Dropbox documents.

Data sources:
- 20 Denbigh Road: Contract, Declaration of Trust, Mortgage Offer (Santander),
  2024 Product Transfer, Completion Statement, project spreadsheet
- 249 Francis Road: Trust Deed, ESIS (Hinckley & Rugby 2022),
  2024 Product Switch (offer letter), Outstanding Costs, Mortgage Options
"""

from __future__ import annotations

import sqlite3
from datetime import date
from decimal import Decimal

from finadviser.db.models import Account, AccountType, BookEntry, JournalEntry
from finadviser.db.connection import get_connection, initialize_database
from finadviser.db.repositories import AccountRepo, JournalRepo, PropertyRepo


def seed_properties(conn: sqlite3.Connection) -> None:
    """Populate database with all property data."""
    account_repo = AccountRepo(conn)
    journal_repo = JournalRepo(conn)
    prop_repo = PropertyRepo(conn)

    # ----------------------------------------------------------------
    # OWNERS
    # ----------------------------------------------------------------
    emily_id = prop_repo.create_owner("Emily Pun")
    jono_id = prop_repo.create_owner("Jono Taylor")

    # ----------------------------------------------------------------
    # 20 DENBIGH ROAD — Primary residence
    # Purchase price: £440,000 | Completion: 08/07/2022
    # Sellers: Ebenezer-Joshua Osofa
    # ----------------------------------------------------------------
    denbigh_id = prop_repo.create_property({
        "name": "20 Denbigh Road",
        "address": "20 Denbigh Road, London, E6 3LD",
        "purchase_date": "2022-07-08",
        "purchase_price": 440000,
    })

    # Capital accounts for each owner at Denbigh
    denbigh_cap_emily_id = account_repo.create(Account(
        name="Capital - Emily Pun - 20 Denbigh Road",
        account_type=AccountType.EQUITY,
        description="Emily's capital contributions to 20 Denbigh Road",
    ))
    denbigh_cap_jono_id = account_repo.create(Account(
        name="Capital - Jono Taylor - 20 Denbigh Road",
        account_type=AccountType.EQUITY,
        description="Jono's capital contributions to 20 Denbigh Road",
    ))

    prop_repo.add_ownership(denbigh_id, emily_id, denbigh_cap_emily_id)
    prop_repo.add_ownership(denbigh_id, jono_id, denbigh_cap_jono_id)

    # Equity tracking contra account (balances double-entry)
    equity_contra_id = account_repo.create(Account(
        name="Property Equity Contributions",
        account_type=AccountType.EQUITY,
        description="Contra account for property capital contributions",
    ))

    # --- Declaration of Trust contributions ---
    # Emily: £277,034 total (£80,784 purchase + £200,000 repairs/improvements)
    # Jono: £70,466 total (£25,466 purchase + £45,000 repairs/improvements)
    # Total project cost per trust deed: £685,000
    # Ownership: Emily 40.44%, Jono 10.29%, remaining 49.27% split equally

    # Emily's purchase contribution
    journal_repo.create_entry(
        JournalEntry(date=date(2022, 7, 8), description="Emily - purchase contribution (deposit & costs) - 20 Denbigh Road"),
        [
            BookEntry(journal_entry_id=0, account_id=denbigh_cap_emily_id, amount=Decimal("80784")),
            BookEntry(journal_entry_id=0, account_id=equity_contra_id, amount=Decimal("-80784")),
        ],
    )

    # Jono's purchase contribution
    journal_repo.create_entry(
        JournalEntry(date=date(2022, 7, 8), description="Jono - purchase contribution (deposit & costs) - 20 Denbigh Road"),
        [
            BookEntry(journal_entry_id=0, account_id=denbigh_cap_jono_id, amount=Decimal("25466")),
            BookEntry(journal_entry_id=0, account_id=equity_contra_id, amount=Decimal("-25466")),
        ],
    )

    # Emily's renovation/improvement contribution
    journal_repo.create_entry(
        JournalEntry(date=date(2023, 6, 30), description="Emily - renovation contributions - 20 Denbigh Road"),
        [
            BookEntry(journal_entry_id=0, account_id=denbigh_cap_emily_id, amount=Decimal("196216")),
            BookEntry(journal_entry_id=0, account_id=equity_contra_id, amount=Decimal("-196216")),
        ],
    )

    # Jono's renovation/improvement contribution
    journal_repo.create_entry(
        JournalEntry(date=date(2023, 6, 30), description="Jono - renovation contributions - 20 Denbigh Road"),
        [
            BookEntry(journal_entry_id=0, account_id=denbigh_cap_jono_id, amount=Decimal("45000")),
            BookEntry(journal_entry_id=0, account_id=equity_contra_id, amount=Decimal("-45000")),
        ],
    )

    # --- Denbigh Road Mortgage (Santander) ---
    # Original (July 2022): Total £337,500
    #   Part 1: £61,355 at 2.19% fixed to Jul 2024, 35yr term
    #   Part 2: £276,145 at 2.04% fixed to Oct 2024, 22yr 8mo term
    # 2024 Product Transfer (Sep 2024): Total £335,236
    #   Part 1: £255,912 at 4.41% fixed to Dec 2027, 20yr 6mo
    #   Part 2: £20,481 at 5.24% fixed to Jul 2026, 32yr 11mo (Green Loan)
    #   Part 3: £58,843 at 4.63% fixed to Sep 2027, 32yr 10mo

    denbigh_mortgage_liability_id = account_repo.create(Account(
        name="Mortgage - Santander - 20 Denbigh Road",
        account_type=AccountType.LIABILITY,
        description="Santander mortgage on 20 Denbigh Road (all parts)",
    ))

    mortgage_setup_id = account_repo.create(Account(
        name="Mortgage Setup Equity",
        account_type=AccountType.EQUITY,
        description="Contra for initial mortgage setup entries",
    ))

    denbigh_mortgage_id = prop_repo.create_mortgage({
        "property_id": denbigh_id,
        "lender": "Santander",
        "original_amount": 337500,
        "start_date": "2022-07-08",
        "term_months": 420,
        "liability_account_id": denbigh_mortgage_liability_id,
    })

    # Rate history
    prop_repo.add_mortgage_rate(denbigh_mortgage_id, 2.04, "2022-07-08")   # Part 2 dominant rate
    prop_repo.add_mortgage_rate(denbigh_mortgage_id, 4.41, "2024-09-07")   # 2024 product transfer dominant

    # Set current mortgage balance: £335,236 (as of Sep 2024 product transfer)
    journal_repo.create_entry(
        JournalEntry(date=date(2022, 7, 8), description="Initial mortgage draw - Santander - 20 Denbigh Road"),
        [
            BookEntry(journal_entry_id=0, account_id=denbigh_mortgage_liability_id, amount=Decimal("-337500")),
            BookEntry(journal_entry_id=0, account_id=mortgage_setup_id, amount=Decimal("337500")),
        ],
    )

    # Principal paid down from £337,500 to £335,236 (£2,264 principal repaid)
    journal_repo.create_entry(
        JournalEntry(date=date(2024, 9, 7), description="Principal repayment to date - Santander - 20 Denbigh Road"),
        [
            BookEntry(journal_entry_id=0, account_id=denbigh_mortgage_liability_id, amount=Decimal("2264")),
            BookEntry(journal_entry_id=0, account_id=mortgage_setup_id, amount=Decimal("-2264")),
        ],
    )

    # Valuations for 20 Denbigh Road
    prop_repo.add_valuation(denbigh_id, 450000, "2022-07-08", "Santander mortgage valuation")
    prop_repo.add_valuation(denbigh_id, 440000, "2022-07-08", "Purchase price")
    # Post-renovation: total project cost was £685,000 (purchase + works)
    # Assume conservative current valuation
    prop_repo.add_valuation(denbigh_id, 685000, "2024-09-07", "Purchase + renovation cost basis")

    # Stamp duty: £25,200 (additional rate)
    # Solicitor fees: £27,361 total

    # Expense allocation: per Declaration of Trust
    # Emily 40.44%, Jono 10.29%, remaining 49.27% split equally
    # So effective split: Emily 40.44% + 24.635% = 65.075%, Jono 10.29% + 24.635% = 34.925%
    # For ongoing expenses, the trust says costs split per beneficial interest
    prop_repo.set_allocation_rule(denbigh_id, emily_id, 65.08, "all")
    prop_repo.set_allocation_rule(denbigh_id, jono_id, 34.92, "all")

    # ----------------------------------------------------------------
    # 249 FRANCIS ROAD — Buy-to-let rental property
    # Purchase price: £435,000 | Completion: 28/10/2019
    # Leasehold flat
    # ----------------------------------------------------------------
    francis_id = prop_repo.create_property({
        "name": "249 Francis Road",
        "address": "249 Francis Road, Leyton, London, E10 6NW",
        "purchase_date": "2019-10-28",
        "purchase_price": 435000,
    })

    # Capital accounts
    francis_cap_emily_id = account_repo.create(Account(
        name="Capital - Emily Pun - 249 Francis Road",
        account_type=AccountType.EQUITY,
        description="Emily's capital contributions to 249 Francis Road",
    ))
    francis_cap_jono_id = account_repo.create(Account(
        name="Capital - Jono Taylor - 249 Francis Road",
        account_type=AccountType.EQUITY,
        description="Jono's capital contributions to 249 Francis Road",
    ))

    prop_repo.add_ownership(francis_id, emily_id, francis_cap_emily_id)
    prop_repo.add_ownership(francis_id, jono_id, francis_cap_jono_id)

    # --- Trust Deed contributions ---
    # Emily's deposit: £130,000
    # Emily's additional costs: £11,800
    # Emily's total: £141,800
    # Distribution: First £141,800 of net proceeds to Emily
    #   Then Emily gets 32.60% of gross sale price
    #   Remainder split 50/50
    # Mortgage instalments: split equally

    journal_repo.create_entry(
        JournalEntry(date=date(2019, 10, 28), description="Emily - deposit contribution - 249 Francis Road"),
        [
            BookEntry(journal_entry_id=0, account_id=francis_cap_emily_id, amount=Decimal("130000")),
            BookEntry(journal_entry_id=0, account_id=equity_contra_id, amount=Decimal("-130000")),
        ],
    )

    journal_repo.create_entry(
        JournalEntry(date=date(2019, 10, 28), description="Emily - purchase costs contribution - 249 Francis Road"),
        [
            BookEntry(journal_entry_id=0, account_id=francis_cap_emily_id, amount=Decimal("11800")),
            BookEntry(journal_entry_id=0, account_id=equity_contra_id, amount=Decimal("-11800")),
        ],
    )

    # Jono's initial cash contribution to Francis Road purchase
    # From Outstanding Costs: total costs £10,811.91, split per person = £382.50 each for outstanding
    # The deposit was all Emily's. Jono's contribution was via shared mortgage payments.
    # Original mortgage was £305,000 (Santander), so purchase = 435k - 130k deposit = 305k mortgage
    # Both pay mortgage equally. From Oct 2019 to Jul 2022 (~33 months) then remortgaged.
    # Estimate shared mortgage principal paid: modest amount in early years
    # From completion statement: redemption balance was £272,495.74, so ~£32,504 principal paid
    # Split equally = ~£16,252 each in principal
    journal_repo.create_entry(
        JournalEntry(date=date(2022, 7, 8), description="Jono - share of mortgage principal paid (Oct 2019-Jul 2022) - 249 Francis Road"),
        [
            BookEntry(journal_entry_id=0, account_id=francis_cap_jono_id, amount=Decimal("16252")),
            BookEntry(journal_entry_id=0, account_id=equity_contra_id, amount=Decimal("-16252")),
        ],
    )
    journal_repo.create_entry(
        JournalEntry(date=date(2022, 7, 8), description="Emily - share of mortgage principal paid (Oct 2019-Jul 2022) - 249 Francis Road"),
        [
            BookEntry(journal_entry_id=0, account_id=francis_cap_emily_id, amount=Decimal("16252")),
            BookEntry(journal_entry_id=0, account_id=equity_contra_id, amount=Decimal("-16252")),
        ],
    )

    # --- Francis Road Mortgage ---
    # Original: Santander, £305,000 (Oct 2019)
    # Remortgage: Hinckley & Rugby, £337,500 at 2.60% (Jun 2022)
    # Product Switch: H&R, £325,916.22 at 6.25% discount rate (Jul 2024), interest only

    francis_mortgage_liability_id = account_repo.create(Account(
        name="Mortgage - Hinckley & Rugby - 249 Francis Road",
        account_type=AccountType.LIABILITY,
        description="Hinckley & Rugby Building Society BTL mortgage on 249 Francis Road",
    ))

    francis_mortgage_id = prop_repo.create_mortgage({
        "property_id": francis_id,
        "lender": "Hinckley & Rugby Building Society",
        "original_amount": 337500,
        "start_date": "2022-06-22",
        "term_months": 420,
        "liability_account_id": francis_mortgage_liability_id,
    })

    # Rate history
    prop_repo.add_mortgage_rate(francis_mortgage_id, 2.60, "2022-06-22")   # 2yr fix
    prop_repo.add_mortgage_rate(francis_mortgage_id, 6.25, "2024-07-03")   # 2yr discount (8.04% - 1.79%)

    # Set current balance: £325,916.22 (Jul 2024, now interest-only)
    journal_repo.create_entry(
        JournalEntry(date=date(2022, 6, 22), description="Initial mortgage draw - Hinckley & Rugby - 249 Francis Road"),
        [
            BookEntry(journal_entry_id=0, account_id=francis_mortgage_liability_id, amount=Decimal("-337500")),
            BookEntry(journal_entry_id=0, account_id=mortgage_setup_id, amount=Decimal("337500")),
        ],
    )

    # Principal repaid: £337,500 - £325,916.22 = £11,583.78 (during repayment period 2022-2024)
    # Split equally between owners
    journal_repo.create_entry(
        JournalEntry(date=date(2024, 7, 3), description="Principal repayment to date - H&R - 249 Francis Road"),
        [
            BookEntry(journal_entry_id=0, account_id=francis_mortgage_liability_id, amount=Decimal("11584")),
            BookEntry(journal_entry_id=0, account_id=mortgage_setup_id, amount=Decimal("-11584")),
        ],
    )
    # Record capital contribution from principal payments (split equally)
    journal_repo.create_entry(
        JournalEntry(date=date(2024, 7, 3), description="Emily - mortgage principal (2022-2024) - 249 Francis Road"),
        [
            BookEntry(journal_entry_id=0, account_id=francis_cap_emily_id, amount=Decimal("5792")),
            BookEntry(journal_entry_id=0, account_id=equity_contra_id, amount=Decimal("-5792")),
        ],
    )
    journal_repo.create_entry(
        JournalEntry(date=date(2024, 7, 3), description="Jono - mortgage principal (2022-2024) - 249 Francis Road"),
        [
            BookEntry(journal_entry_id=0, account_id=francis_cap_jono_id, amount=Decimal("5792")),
            BookEntry(journal_entry_id=0, account_id=equity_contra_id, amount=Decimal("-5792")),
        ],
    )

    # Valuations
    prop_repo.add_valuation(francis_id, 435000, "2019-10-28", "Purchase price")
    prop_repo.add_valuation(francis_id, 450000, "2022-06-22", "Hinckley & Rugby mortgage valuation")
    prop_repo.add_valuation(francis_id, 450000, "2024-07-03", "Hinckley & Rugby assumed valuation")

    # Stamp duty: £11,750 (originally; but later the Outstanding Costs file shows £6,462 SDLT)
    # The £6,462 is from the earlier Outstanding Costs sheet (first time buyer relief may have applied)
    # The solicitor quote shows £11,750

    # Expense allocation: mortgage split equally per trust deed
    prop_repo.set_allocation_rule(francis_id, emily_id, 50.0, "all")
    prop_repo.set_allocation_rule(francis_id, jono_id, 50.0, "all")

    # ----------------------------------------------------------------
    # CROSS-PROPERTY: Equity transfer from Francis Road to Denbigh Road
    # From Completion Statement: £61,532.18 transferred from 249 Francis
    # remortgage proceeds to fund 20 Denbigh Road purchase
    # ----------------------------------------------------------------
    # This was from the remortgage surplus, shared by both owners
    conn.execute(
        """INSERT INTO property_transfers
           (from_property_id, to_property_id, owner_id, amount, journal_entry_id, transfer_date, description)
           VALUES (?, ?, ?, ?, 1, ?, ?)""",
        (francis_id, denbigh_id, emily_id, 30766.09, "2022-07-08",
         "Share of Francis Rd remortgage surplus transferred to Denbigh Rd completion"),
    )
    conn.execute(
        """INSERT INTO property_transfers
           (from_property_id, to_property_id, owner_id, amount, journal_entry_id, transfer_date, description)
           VALUES (?, ?, ?, ?, 1, ?, ?)""",
        (francis_id, denbigh_id, jono_id, 30766.09, "2022-07-08",
         "Share of Francis Rd remortgage surplus transferred to Denbigh Rd completion"),
    )

    # ----------------------------------------------------------------
    # ADDITIONAL DATA: Key costs recorded as categories
    # ----------------------------------------------------------------

    # Create property-specific expense categories
    from finadviser.db.models import Category
    from finadviser.db.repositories import CategoryRepo
    cat_repo = CategoryRepo(conn)

    cat_repo.create(Category(name="Mortgage Interest"))
    cat_repo.create(Category(name="Property Insurance"))
    cat_repo.create(Category(name="Property Maintenance"))
    cat_repo.create(Category(name="Renovation"))
    cat_repo.create(Category(name="Solicitor Fees"))
    cat_repo.create(Category(name="Stamp Duty"))
    cat_repo.create(Category(name="Rental Income"))
    cat_repo.create(Category(name="Mortgage Payment"))

    conn.commit()
    print("Property data seeded successfully.")
    print()
    print("Properties:")
    print(f"  20 Denbigh Road (id={denbigh_id})")
    print(f"    Owners: Emily Pun (id={emily_id}), Jono Taylor (id={jono_id})")
    print(f"    Purchase: £440,000 on 2022-07-08")
    print(f"    Mortgage: Santander £337,500 -> current £335,236 (2024 product transfer)")
    print(f"    Rates: 4.41% (£255,912) / 5.24% (£20,481) / 4.63% (£58,843)")
    print(f"    Monthly payment: £1,981.96")
    print(f"    Emily contributions: £277,000 (40.44% + half of 49.27% = 65.08%)")
    print(f"    Jono contributions: £70,466 (10.29% + half of 49.27% = 34.92%)")
    print()
    print(f"  249 Francis Road (id={francis_id})")
    print(f"    Owners: Emily Pun, Jono Taylor")
    print(f"    Purchase: £435,000 on 2019-10-28")
    print(f"    Mortgage: Hinckley & Rugby £337,500 -> current £325,916 (interest only since Jul 2024)")
    print(f"    Rate: 6.25% (8.04% landlord variable - 1.79% discount)")
    print(f"    Monthly payment: £1,691.10")
    print(f"    Emily deposit: £130,000 + £11,800 costs = £141,800")
    print(f"    Trust deed: first £141,800 to Emily, then 32.60% of gross, remainder 50/50")
    print(f"    Expense allocation: 50/50 (per trust deed)")


def main() -> None:
    from finadviser.config import load_config
    config = load_config()
    config.ensure_dirs()
    conn = get_connection(config.db_path)
    initialize_database(conn)
    seed_properties(conn)
    conn.close()


if __name__ == "__main__":
    main()
