"""Mortgage payment tracking with principal/interest split."""

from __future__ import annotations

import sqlite3
from datetime import date
from decimal import Decimal

from finadviser.db.models import AccountType, BookEntry, JournalEntry
from finadviser.db.repositories import AccountRepo, JournalRepo, PropertyRepo


class MortgageTracker:
    """Records mortgage payments split into principal and interest.

    Principal reduces the liability and increases the payer's capital account.
    Interest is an expense.
    """

    def __init__(self, conn: sqlite3.Connection) -> None:
        self.conn = conn
        self.prop_repo = PropertyRepo(conn)
        self.journal_repo = JournalRepo(conn)
        self.account_repo = AccountRepo(conn)

    def record_payment(
        self,
        mortgage_id: int,
        payment_date: date,
        total_amount: Decimal,
        principal_amount: Decimal,
        interest_amount: Decimal,
        payer_owner_id: int,
        from_account_id: int,
    ) -> int:
        """Record a mortgage payment with principal/interest split.

        Creates balanced journal entries:
        - Credit from_account (bank) by total
        - Debit mortgage liability by principal (reduces debt)
        - Debit interest expense by interest
        - Credit payer's capital account by principal (builds equity)

        Actually since double-entry sums to zero:
        - from_account: -total (money leaving bank)
        - mortgage liability: +principal (liability reducing = positive for liabilities)
        - interest expense: +interest (expense increasing)
        - capital account: +principal (equity building for payer)

        Wait, that won't balance. Let's think carefully:

        The payment flows:
        1. Bank account decreases (credit in accounting, negative in our system)
        2. Mortgage liability decreases (debit in accounting, for liabilities this is positive)
        3. Interest expense increases (debit in accounting, positive)

        For the capital account tracking (separate from the main entry):
        We need to record that the payer contributed principal to the property.
        """
        mortgages = self.prop_repo.get_mortgages(0)  # need to get mortgage by id
        mortgage_row = self.conn.execute(
            "SELECT * FROM mortgages WHERE id = ?", (mortgage_id,)
        ).fetchone()
        if not mortgage_row:
            raise ValueError(f"Mortgage {mortgage_id} not found")

        liability_account_id = mortgage_row["liability_account_id"]

        # Get payer's capital account for this property
        ownership = self.prop_repo.get_ownership(mortgage_row["property_id"])
        payer_capital_account_id = None
        for own in ownership:
            if own["owner_id"] == payer_owner_id:
                payer_capital_account_id = own["capital_account_id"]
                break

        if payer_capital_account_id is None:
            raise ValueError(f"Owner {payer_owner_id} does not own property {mortgage_row['property_id']}")

        # Get or create interest expense account
        interest_account = self.account_repo.get_or_create(
            "Mortgage Interest", AccountType.EXPENSE
        )

        # Create journal entry for the mortgage payment
        # Entries must sum to zero:
        # from_account (bank): -total (money out)
        # liability: +principal (debt reduced - for liability accounts, positive = reduction)
        # interest expense: +interest (expense incurred)
        # These sum to: -total + principal + interest = 0 (since total = principal + interest)

        journal = JournalEntry(
            date=payment_date,
            description=f"Mortgage payment - {mortgage_row['lender']}",
        )
        entries = [
            BookEntry(journal_entry_id=0, account_id=from_account_id, amount=-total_amount),
            BookEntry(journal_entry_id=0, account_id=liability_account_id, amount=principal_amount),
            BookEntry(journal_entry_id=0, account_id=interest_account.id, amount=interest_amount),
        ]
        journal_id = self.journal_repo.create_entry(journal, entries)

        # Separate journal entry for capital contribution
        # This records that the payer's equity in the property increased by the principal amount
        # Debit capital account (positive = increase in equity)
        # Credit an equity-tracking contra account
        equity_tracking = self.account_repo.get_or_create(
            f"Equity Contributions - {mortgage_row['lender']}", AccountType.EQUITY
        )
        capital_journal = JournalEntry(
            date=payment_date,
            description=f"Capital contribution via mortgage principal - {mortgage_row['lender']}",
        )
        capital_entries = [
            BookEntry(journal_entry_id=0, account_id=payer_capital_account_id, amount=principal_amount),
            BookEntry(journal_entry_id=0, account_id=equity_tracking.id, amount=-principal_amount),
        ]
        self.journal_repo.create_entry(capital_journal, capital_entries)

        return journal_id

    def get_payment_history(self, mortgage_id: int) -> list[dict]:
        """Get all payments for a mortgage."""
        mortgage_row = self.conn.execute(
            "SELECT * FROM mortgages WHERE id = ?", (mortgage_id,)
        ).fetchone()
        if not mortgage_row:
            return []

        rows = self.conn.execute(
            """SELECT je.id, je.date, je.description,
                      GROUP_CONCAT(a.name || ':' || be.amount, '|') AS entries_summary
               FROM journal_entries je
               JOIN book_entries be ON be.journal_entry_id = je.id
               JOIN accounts a ON a.id = be.account_id
               WHERE je.description LIKE ?
               GROUP BY je.id
               ORDER BY je.date DESC""",
            (f"%{mortgage_row['lender']}%",),
        ).fetchall()
        return [dict(r) for r in rows]
