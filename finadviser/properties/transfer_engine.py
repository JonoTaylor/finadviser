"""Cross-property equity transfer engine."""

from __future__ import annotations

import sqlite3
from datetime import date
from decimal import Decimal

from finadviser.db.models import AccountType, BookEntry, JournalEntry
from finadviser.db.repositories import AccountRepo, JournalRepo, PropertyRepo


class TransferEngine:
    """Handles equity transfers between properties.

    For example, equity from Property A can be used as a deposit for Property B.
    Creates balanced journal entries across capital accounts.
    """

    def __init__(self, conn: sqlite3.Connection) -> None:
        self.conn = conn
        self.prop_repo = PropertyRepo(conn)
        self.journal_repo = JournalRepo(conn)
        self.account_repo = AccountRepo(conn)

    def transfer_equity(
        self,
        from_property_id: int,
        to_property_id: int,
        owner_id: int,
        amount: Decimal,
        transfer_date: date,
        description: str | None = None,
    ) -> int:
        """Transfer equity from one property to another for a specific owner.

        This reduces the owner's capital account in the source property
        and increases it in the destination property.

        Returns the journal_entry_id.
        """
        # Get ownership records
        from_ownership = self.prop_repo.get_ownership(from_property_id)
        to_ownership = self.prop_repo.get_ownership(to_property_id)

        from_capital_id = None
        to_capital_id = None

        for own in from_ownership:
            if own["owner_id"] == owner_id:
                from_capital_id = own["capital_account_id"]
                break

        for own in to_ownership:
            if own["owner_id"] == owner_id:
                to_capital_id = own["capital_account_id"]
                break

        if from_capital_id is None:
            raise ValueError(f"Owner {owner_id} does not own property {from_property_id}")
        if to_capital_id is None:
            raise ValueError(f"Owner {owner_id} does not own property {to_property_id}")

        # Check sufficient equity
        from_balance = self.account_repo.get_balance(from_capital_id)
        if from_balance < amount:
            raise ValueError(
                f"Insufficient equity: {from_balance} available, {amount} requested"
            )

        # Create balanced journal entry
        from_prop = self.prop_repo.get_property(from_property_id)
        to_prop = self.prop_repo.get_property(to_property_id)

        desc = description or (
            f"Equity transfer: {from_prop['name']} -> {to_prop['name']}"
        )

        journal = JournalEntry(date=transfer_date, description=desc)
        entries = [
            BookEntry(journal_entry_id=0, account_id=from_capital_id, amount=-amount),
            BookEntry(journal_entry_id=0, account_id=to_capital_id, amount=amount),
        ]
        journal_id = self.journal_repo.create_entry(journal, entries)

        # Record the transfer
        self.conn.execute(
            """INSERT INTO property_transfers
               (from_property_id, to_property_id, owner_id, amount, journal_entry_id, transfer_date, description)
               VALUES (?, ?, ?, ?, ?, ?, ?)""",
            (from_property_id, to_property_id, owner_id, float(amount), journal_id, transfer_date.isoformat(), desc),
        )
        self.conn.commit()

        return journal_id

    def get_transfers(self, property_id: int | None = None, owner_id: int | None = None) -> list[dict]:
        """Get transfer history, optionally filtered."""
        query = """
            SELECT pt.*, fp.name AS from_property, tp.name AS to_property, o.name AS owner_name
            FROM property_transfers pt
            JOIN properties fp ON fp.id = pt.from_property_id
            JOIN properties tp ON tp.id = pt.to_property_id
            JOIN owners o ON o.id = pt.owner_id
            WHERE 1=1
        """
        params: list = []

        if property_id is not None:
            query += " AND (pt.from_property_id = ? OR pt.to_property_id = ?)"
            params.extend([property_id, property_id])

        if owner_id is not None:
            query += " AND pt.owner_id = ?"
            params.append(owner_id)

        query += " ORDER BY pt.transfer_date DESC"
        rows = self.conn.execute(query, params).fetchall()
        return [dict(r) for r in rows]
