"""Dashboard screen showing financial overview."""

from __future__ import annotations

import sqlite3
from decimal import Decimal

from textual.app import ComposeResult
from textual.containers import Container, Vertical
from textual.screen import Screen
from textual.widgets import Static

from finadviser.config import AppConfig
from finadviser.db.models import AccountType
from finadviser.db.repositories import AccountRepo, JournalRepo
from finadviser.ui.widgets.net_worth_card import NetWorthCard
from finadviser.ui.widgets.transaction_table import TransactionTable
from finadviser.utils.formatting import format_currency


class DashboardScreen(Screen):
    """Main dashboard with financial summary."""

    def __init__(self, conn: sqlite3.Connection, config: AppConfig, **kwargs) -> None:
        super().__init__(**kwargs)
        self.conn = conn
        self.config = config

    def compose(self) -> ComposeResult:
        yield Container(
            NetWorthCard(self.conn, self.config.currency_symbol, classes="summary-card net-worth-card"),
            Vertical(
                Static("[bold]Monthly Summary[/bold]", classes="card-title"),
                Static("", id="monthly-summary"),
                classes="summary-card",
            ),
            Vertical(
                Static("[bold]Savings Rate[/bold]", classes="card-title"),
                Static("", id="savings-rate"),
                classes="summary-card",
            ),
            Vertical(
                Static("[bold]Top Categories[/bold]", classes="card-title"),
                Static("", id="top-categories"),
                classes="summary-card",
            ),
            id="dashboard-grid",
        )
        yield Vertical(
            Static("[bold]Recent Transactions[/bold]", classes="section-title"),
            TransactionTable(self.conn, self.config.currency_symbol),
            id="recent-transactions",
        )

    def on_mount(self) -> None:
        self._refresh_summary()

    def on_screen_resume(self) -> None:
        self._refresh_summary()

    def _refresh_summary(self) -> None:
        repo = AccountRepo(self.conn)
        journal_repo = JournalRepo(self.conn)
        balances = repo.get_balances()
        currency = self.config.currency_symbol

        # Monthly summary
        income = sum(
            (abs(b.balance) for b in balances if b.account_type == AccountType.INCOME),
            Decimal("0"),
        )
        expenses = sum(
            (abs(b.balance) for b in balances if b.account_type == AccountType.EXPENSE),
            Decimal("0"),
        )
        monthly_widget = self.query_one("#monthly-summary", Static)
        monthly_widget.update(
            f"Income: [green]{format_currency(income, currency)}[/green]\n"
            f"Expenses: [red]{format_currency(expenses, currency)}[/red]\n"
            f"Net: {format_currency(income - expenses, currency)}"
        )

        # Savings rate
        savings_widget = self.query_one("#savings-rate", Static)
        if income > 0:
            rate = float((income - expenses) / income * 100)
            color = "green" if rate > 0 else "red"
            savings_widget.update(f"[{color}]{rate:.1f}%[/{color}]")
        else:
            savings_widget.update("[dim]No income recorded[/dim]")

        # Top categories from monthly spending
        spending = journal_repo.get_monthly_spending()
        categories: dict[str, float] = {}
        for row in spending:
            cat = row.get("category_name") or "Uncategorized"
            categories[cat] = categories.get(cat, 0) + abs(row.get("total", 0))

        sorted_cats = sorted(categories.items(), key=lambda x: x[1], reverse=True)[:5]
        cat_widget = self.query_one("#top-categories", Static)
        if sorted_cats:
            lines = [f"{name}: {format_currency(amt, currency)}" for name, amt in sorted_cats]
            cat_widget.update("\n".join(lines))
        else:
            cat_widget.update("[dim]No spending data yet[/dim]")
