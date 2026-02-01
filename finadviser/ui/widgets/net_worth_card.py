"""Net worth summary card widget."""

from __future__ import annotations

import sqlite3
from decimal import Decimal

from textual.app import ComposeResult
from textual.widgets import Static

from finadviser.db.models import AccountType
from finadviser.db.repositories import AccountRepo
from finadviser.utils.formatting import format_currency


class NetWorthCard(Static):
    """Displays net worth: assets - liabilities."""

    def __init__(self, conn: sqlite3.Connection, currency: str = "$", **kwargs) -> None:
        super().__init__(**kwargs)
        self.conn = conn
        self.currency = currency

    def on_mount(self) -> None:
        self.refresh_data()

    def refresh_data(self) -> None:
        repo = AccountRepo(self.conn)
        balances = repo.get_balances()

        assets = sum(
            (b.balance for b in balances if b.account_type == AccountType.ASSET),
            Decimal("0"),
        )
        liabilities = sum(
            (abs(b.balance) for b in balances if b.account_type == AccountType.LIABILITY),
            Decimal("0"),
        )
        net_worth = assets - liabilities

        self.update(
            f"[bold]Net Worth[/bold]\n\n"
            f"[bold {'green' if net_worth >= 0 else 'red'}]{format_currency(net_worth, self.currency)}[/]\n\n"
            f"Assets: {format_currency(assets, self.currency)}  |  "
            f"Liabilities: {format_currency(liabilities, self.currency)}"
        )
