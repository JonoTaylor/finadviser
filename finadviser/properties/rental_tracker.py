"""Rental income and expense allocation between property owners."""

from __future__ import annotations

import sqlite3
from datetime import date
from decimal import Decimal

from finadviser.db.models import AccountType, BookEntry, JournalEntry
from finadviser.db.repositories import AccountRepo, JournalRepo, PropertyRepo


class RentalTracker:
    """Allocates rental income/expenses to owners based on allocation rules."""

    def __init__(self, conn: sqlite3.Connection) -> None:
        self.conn = conn
        self.prop_repo = PropertyRepo(conn)
        self.journal_repo = JournalRepo(conn)
        self.account_repo = AccountRepo(conn)

    def record_rental_income(
        self,
        property_id: int,
        amount: Decimal,
        income_date: date,
        description: str = "Rental income",
        to_account_id: int | None = None,
    ) -> int:
        """Record rental income and allocate to owners per allocation rules.

        Creates journal entries:
        - Credit rental income account
        - Debit bank/asset account
        - Credit each owner's capital account per their allocation %
        """
        ownership = self.prop_repo.get_ownership(property_id)
        if not ownership:
            raise ValueError(f"No owners for property {property_id}")

        rules = self.prop_repo.get_allocation_rules(property_id)
        allocations = self._get_allocations(ownership, rules)

        # Bank account receives the income
        if to_account_id is None:
            bank = self.account_repo.get_or_create("Bank", AccountType.ASSET)
            to_account_id = bank.id

        rental_income_account = self.account_repo.get_or_create(
            "Rental Income", AccountType.INCOME
        )

        # Main income entry: bank debit, income credit
        journal = JournalEntry(date=income_date, description=description)
        entries = [
            BookEntry(journal_entry_id=0, account_id=to_account_id, amount=amount),
            BookEntry(journal_entry_id=0, account_id=rental_income_account.id, amount=-amount),
        ]
        journal_id = self.journal_repo.create_entry(journal, entries)

        # Capital allocation entries
        equity_tracking = self.account_repo.get_or_create("Rental Income Equity", AccountType.EQUITY)

        for owner_id, pct in allocations.items():
            owner_amount = amount * Decimal(str(pct)) / Decimal("100")
            if owner_amount == 0:
                continue

            # Find this owner's capital account
            capital_account_id = None
            for own in ownership:
                if own["owner_id"] == owner_id:
                    capital_account_id = own["capital_account_id"]
                    break

            if capital_account_id:
                cap_journal = JournalEntry(
                    date=income_date,
                    description=f"Rental income allocation - {pct}%",
                )
                cap_entries = [
                    BookEntry(journal_entry_id=0, account_id=capital_account_id, amount=owner_amount),
                    BookEntry(journal_entry_id=0, account_id=equity_tracking.id, amount=-owner_amount),
                ]
                self.journal_repo.create_entry(cap_journal, cap_entries)

        return journal_id

    def record_property_expense(
        self,
        property_id: int,
        amount: Decimal,
        expense_date: date,
        description: str = "Property expense",
        from_account_id: int | None = None,
        expense_type: str = "all",
    ) -> int:
        """Record a property expense and allocate to owners.

        Expense reduces each owner's capital account per allocation rules.
        """
        ownership = self.prop_repo.get_ownership(property_id)
        if not ownership:
            raise ValueError(f"No owners for property {property_id}")

        rules = self.prop_repo.get_allocation_rules(property_id)
        allocations = self._get_allocations(ownership, rules, expense_type)

        if from_account_id is None:
            bank = self.account_repo.get_or_create("Bank", AccountType.ASSET)
            from_account_id = bank.id

        expense_account = self.account_repo.get_or_create("Property Expenses", AccountType.EXPENSE)

        # Main expense entry
        journal = JournalEntry(date=expense_date, description=description)
        entries = [
            BookEntry(journal_entry_id=0, account_id=from_account_id, amount=-amount),
            BookEntry(journal_entry_id=0, account_id=expense_account.id, amount=amount),
        ]
        journal_id = self.journal_repo.create_entry(journal, entries)

        # Capital reduction entries
        equity_tracking = self.account_repo.get_or_create("Property Expense Equity", AccountType.EQUITY)

        for owner_id, pct in allocations.items():
            owner_amount = amount * Decimal(str(pct)) / Decimal("100")
            if owner_amount == 0:
                continue

            capital_account_id = None
            for own in ownership:
                if own["owner_id"] == owner_id:
                    capital_account_id = own["capital_account_id"]
                    break

            if capital_account_id:
                cap_journal = JournalEntry(
                    date=expense_date,
                    description=f"Property expense allocation - {pct}%",
                )
                cap_entries = [
                    BookEntry(journal_entry_id=0, account_id=capital_account_id, amount=-owner_amount),
                    BookEntry(journal_entry_id=0, account_id=equity_tracking.id, amount=owner_amount),
                ]
                self.journal_repo.create_entry(cap_journal, cap_entries)

        return journal_id

    def _get_allocations(
        self, ownership: list[dict], rules: list[dict], expense_type: str = "all"
    ) -> dict[int, float]:
        """Determine allocation percentages for each owner.

        Falls back to equal split if no rules are defined.
        """
        allocations: dict[int, float] = {}

        # Check for specific rules
        for rule in rules:
            if rule["expense_type"] in (expense_type, "all"):
                allocations[rule["owner_id"]] = rule["allocation_pct"]

        # Fall back to equal split
        if not allocations:
            equal_pct = 100.0 / len(ownership)
            for own in ownership:
                allocations[own["owner_id"]] = equal_pct

        return allocations
