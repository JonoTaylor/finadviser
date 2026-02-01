"""Transactions screen with filtering and search."""

from __future__ import annotations

import sqlite3

from textual.app import ComposeResult
from textual.containers import Horizontal, Vertical
from textual.screen import Screen
from textual.widgets import Input, Select, Static

from finadviser.config import AppConfig
from finadviser.db.repositories import AccountRepo, CategoryRepo
from finadviser.ui.widgets.transaction_table import TransactionTable


class TransactionsScreen(Screen):
    """Filterable/searchable transaction list with category editing."""

    def __init__(self, conn: sqlite3.Connection, config: AppConfig, **kwargs) -> None:
        super().__init__(**kwargs)
        self.conn = conn
        self.config = config

    def compose(self) -> ComposeResult:
        yield Vertical(
            Input(placeholder="Search transactions...", id="search-bar"),
            Horizontal(
                Select(
                    [(cat.name, cat.id) for cat in CategoryRepo(self.conn).list_all()],
                    prompt="All Categories",
                    id="category-filter",
                    allow_blank=True,
                ),
                Select(
                    [(acc.name, acc.id) for acc in AccountRepo(self.conn).list_all()],
                    prompt="All Accounts",
                    id="account-filter",
                    allow_blank=True,
                ),
                id="filter-bar",
            ),
            TransactionTable(self.conn, self.config.currency_symbol, id="main-txn-table"),
            id="transactions-container",
        )

    def on_screen_resume(self) -> None:
        table = self.query_one("#main-txn-table", TransactionTable)
        table.refresh_data()

    def on_input_submitted(self, event: Input.Submitted) -> None:
        if event.input.id == "search-bar":
            table = self.query_one("#main-txn-table", TransactionTable)
            query = event.value.strip()
            if query:
                table.refresh_data(search_query=query)
            else:
                table.refresh_data()

    def on_select_changed(self, event: Select.Changed) -> None:
        table = self.query_one("#main-txn-table", TransactionTable)
        cat_select = self.query_one("#category-filter", Select)
        acc_select = self.query_one("#account-filter", Select)

        cat_id = cat_select.value if cat_select.value != Select.BLANK else None
        acc_id = acc_select.value if acc_select.value != Select.BLANK else None

        table.refresh_data(category_id=cat_id, account_id=acc_id)
