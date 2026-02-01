"""Transaction table widget."""

from __future__ import annotations

import sqlite3

from textual.widgets import DataTable

from finadviser.db.repositories import JournalRepo
from finadviser.utils.formatting import format_currency


class TransactionTable(DataTable):
    """Displays a table of journal entries with their amounts."""

    def __init__(self, conn: sqlite3.Connection, currency: str = "$", **kwargs) -> None:
        super().__init__(**kwargs)
        self.conn = conn
        self.currency = currency
        self.journal_repo = JournalRepo(conn)

    def on_mount(self) -> None:
        self.add_columns("Date", "Description", "Category", "Amount")
        self.refresh_data()

    def refresh_data(
        self,
        start_date=None,
        end_date=None,
        category_id=None,
        account_id=None,
        search_query: str | None = None,
        limit: int = 100,
    ) -> None:
        self.clear()

        if search_query:
            entries = self.journal_repo.search(search_query, limit=limit)
        else:
            entries = self.journal_repo.list_entries(
                start_date=start_date,
                end_date=end_date,
                category_id=category_id,
                account_id=account_id,
                limit=limit,
            )

        for entry in entries:
            amount = self._extract_amount(entry.get("entries_summary", ""))
            category = entry.get("category_name") or "Uncategorized"
            amount_str = format_currency(amount, self.currency) if amount else "-"

            self.add_row(
                entry.get("date", ""),
                entry.get("description", ""),
                category,
                amount_str,
                key=str(entry.get("id", "")),
            )

    def _extract_amount(self, entries_summary: str) -> float | None:
        """Extract the primary amount from the entries summary.

        The summary format is: "AccountName:amount|AccountName:amount"
        We look for the ASSET account's amount as the display value.
        """
        if not entries_summary:
            return None

        for part in entries_summary.split("|"):
            if ":" in part:
                _, amt = part.rsplit(":", 1)
                try:
                    return float(amt)
                except ValueError:
                    continue
        return None
