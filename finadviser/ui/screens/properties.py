"""Properties screen with equity tracking."""

from __future__ import annotations

import sqlite3
from decimal import Decimal

from textual.app import ComposeResult
from textual.containers import Horizontal, Vertical
from textual.screen import Screen
from textual.widgets import Button, DataTable, Input, ListItem, ListView, Static

from finadviser.config import AppConfig
from finadviser.db.repositories import AccountRepo, PropertyRepo
from finadviser.properties.equity_calculator import EquityCalculator
from finadviser.ui.widgets.equity_bar import EquityBar
from finadviser.utils.formatting import format_currency


class PropertiesScreen(Screen):
    """Property management with equity tracking."""

    def __init__(self, conn: sqlite3.Connection, config: AppConfig, **kwargs) -> None:
        super().__init__(**kwargs)
        self.conn = conn
        self.config = config
        self.prop_repo = PropertyRepo(conn)
        self.equity_calc = EquityCalculator(conn)
        self._selected_property_id: int | None = None

    def compose(self) -> ComposeResult:
        yield Horizontal(
            Vertical(
                Static("[bold]Properties[/bold]", classes="section-title"),
                ListView(id="property-listview"),
                Button("Add Property", id="add-property-btn", variant="primary"),
                id="property-list",
            ),
            Vertical(
                Static("[bold]Property Details[/bold]", classes="section-title"),
                Static("Select a property to view details", id="property-info"),
                Static("", id="equity-section"),
                DataTable(id="ownership-table"),
                Static("", id="mortgage-info"),
                DataTable(id="valuation-table"),
                Horizontal(
                    Button("Record Payment", id="record-payment-btn", variant="default"),
                    Button("Update Valuation", id="update-valuation-btn", variant="default"),
                    Button("Transfer Equity", id="transfer-equity-btn", variant="default"),
                    Button("AI Equity Report", id="ai-equity-btn", variant="primary"),
                ),
                id="property-detail",
            ),
            id="properties-container",
        )

    async def on_mount(self) -> None:
        await self._refresh_property_list()

    async def on_screen_resume(self) -> None:
        await self._refresh_property_list()

    async def _refresh_property_list(self) -> None:
        listview = self.query_one("#property-listview", ListView)
        await listview.clear()
        for prop in self.prop_repo.list_properties():
            listview.append(ListItem(Static(prop["name"]), id=f"prop-{prop['id']}"))

    def on_list_view_selected(self, event: ListView.Selected) -> None:
        item_id = event.item.id
        if item_id and item_id.startswith("prop-"):
            prop_id = int(item_id.split("-")[1])
            self._selected_property_id = prop_id
            self._show_property_detail(prop_id)

    def _show_property_detail(self, property_id: int) -> None:
        prop = self.prop_repo.get_property(property_id)
        if not prop:
            return

        currency = self.config.currency_symbol

        # Property info
        info = self.query_one("#property-info", Static)
        purchase_price = format_currency(prop["purchase_price"], currency) if prop["purchase_price"] else "N/A"
        info.update(
            f"[bold]{prop['name']}[/bold]\n"
            f"Address: {prop.get('address') or 'N/A'}\n"
            f"Purchase Date: {prop.get('purchase_date') or 'N/A'}\n"
            f"Purchase Price: {purchase_price}"
        )

        # Equity calculation
        equity_data = self.equity_calc.calculate(property_id)
        equity_section = self.query_one("#equity-section", Static)

        if equity_data:
            total_equity = sum(e["equity_amount"] for e in equity_data)
            equity_section.update(
                f"[bold]Total Equity: {format_currency(total_equity, currency)}[/bold]"
            )

            # Ownership table
            table = self.query_one("#ownership-table", DataTable)
            table.clear(columns=True)
            table.add_columns("Owner", "Capital", "Share %", "Market Equity")
            for e in equity_data:
                table.add_row(
                    e["name"],
                    format_currency(e["capital_balance"], currency),
                    f"{e['equity_pct']:.1f}%",
                    format_currency(e["equity_amount"], currency),
                )
        else:
            equity_section.update("[dim]No ownership data. Add owners to track equity.[/dim]")

        # Mortgage info
        mortgages = self.prop_repo.get_mortgages(property_id)
        mortgage_info = self.query_one("#mortgage-info", Static)
        if mortgages:
            lines = []
            for m in mortgages:
                balance = self.prop_repo.get_mortgage_balance(m["id"])
                lines.append(
                    f"[bold]{m['lender']}[/bold]: "
                    f"Balance {format_currency(abs(balance), currency)} "
                    f"(Original: {format_currency(m['original_amount'], currency)})"
                )
            mortgage_info.update("\n".join(lines))
        else:
            mortgage_info.update("[dim]No mortgages recorded[/dim]")

        # Valuations
        val_table = self.query_one("#valuation-table", DataTable)
        val_table.clear(columns=True)
        val_table.add_columns("Date", "Valuation", "Source")
        for v in self.prop_repo.get_valuations(property_id):
            val_table.add_row(
                v["valuation_date"],
                format_currency(v["valuation"], currency),
                v.get("source", "manual"),
            )

    def on_button_pressed(self, event: Button.Pressed) -> None:
        if event.button.id == "add-property-btn":
            self.app.push_screen(AddPropertyModal(self.conn, self.config, self._refresh_property_list))
        elif event.button.id == "update-valuation-btn" and self._selected_property_id:
            self.app.push_screen(
                AddValuationModal(self.conn, self.config, self._selected_property_id, lambda: self._show_property_detail(self._selected_property_id))
            )
        elif event.button.id == "ai-equity-btn" and self._selected_property_id:
            self._run_ai_equity_report()

    def _run_ai_equity_report(self) -> None:
        """Generate AI equity report for the selected property."""
        from finadviser.analysis.data_preparer import DataPreparer

        if not self._selected_property_id or not self.config.anthropic_api_key:
            info = self.query_one("#property-info", Static)
            info.update("[red]API key required for AI reports. Set ANTHROPIC_API_KEY.[/red]")
            return

        # Delegate to the chat screen with a pre-filled prompt
        self.app.action_switch_screen("chat")


class AddPropertyModal(Screen):
    """Modal for adding a new property."""

    def __init__(self, conn: sqlite3.Connection, config: AppConfig, on_complete=None, **kwargs) -> None:
        super().__init__(**kwargs)
        self.conn = conn
        self.config = config
        self.on_complete = on_complete

    def compose(self) -> ComposeResult:
        yield Vertical(
            Static("[bold]Add Property[/bold]", classes="section-title"),
            Input(placeholder="Property name", id="prop-name"),
            Input(placeholder="Address", id="prop-address"),
            Input(placeholder="Purchase date (YYYY-MM-DD)", id="prop-date"),
            Input(placeholder="Purchase price", id="prop-price"),
            Horizontal(
                Button("Save", id="save-btn", variant="success"),
                Button("Cancel", id="cancel-btn", variant="default"),
            ),
            Static("", id="modal-status"),
            classes="wizard-step",
        )

    def on_button_pressed(self, event: Button.Pressed) -> None:
        if event.button.id == "cancel-btn":
            self.app.pop_screen()
        elif event.button.id == "save-btn":
            self._save()

    def _save(self) -> None:
        name = self.query_one("#prop-name", Input).value.strip()
        if not name:
            self.query_one("#modal-status", Static).update("[red]Name is required[/red]")
            return

        price_str = self.query_one("#prop-price", Input).value.strip()
        price = float(price_str) if price_str else None

        prop_data = {
            "name": name,
            "address": self.query_one("#prop-address", Input).value.strip() or None,
            "purchase_date": self.query_one("#prop-date", Input).value.strip() or None,
            "purchase_price": price,
        }

        repo = PropertyRepo(self.conn)
        repo.create_property(prop_data)

        if self.on_complete:
            self.on_complete()
        self.app.pop_screen()


class AddValuationModal(Screen):
    """Modal for adding a property valuation."""

    def __init__(self, conn: sqlite3.Connection, config: AppConfig, property_id: int, on_complete=None, **kwargs) -> None:
        super().__init__(**kwargs)
        self.conn = conn
        self.config = config
        self.property_id = property_id
        self.on_complete = on_complete

    def compose(self) -> ComposeResult:
        yield Vertical(
            Static("[bold]Update Valuation[/bold]", classes="section-title"),
            Input(placeholder="Valuation amount", id="val-amount"),
            Input(placeholder="Date (YYYY-MM-DD)", id="val-date"),
            Input(placeholder="Source (e.g., manual, agent, council)", id="val-source", value="manual"),
            Horizontal(
                Button("Save", id="save-btn", variant="success"),
                Button("Cancel", id="cancel-btn", variant="default"),
            ),
            Static("", id="modal-status"),
            classes="wizard-step",
        )

    def on_button_pressed(self, event: Button.Pressed) -> None:
        if event.button.id == "cancel-btn":
            self.app.pop_screen()
        elif event.button.id == "save-btn":
            self._save()

    def _save(self) -> None:
        amount_str = self.query_one("#val-amount", Input).value.strip()
        if not amount_str:
            self.query_one("#modal-status", Static).update("[red]Amount is required[/red]")
            return

        repo = PropertyRepo(self.conn)
        repo.add_valuation(
            self.property_id,
            float(amount_str),
            self.query_one("#val-date", Input).value.strip(),
            self.query_one("#val-source", Input).value.strip() or "manual",
        )

        if self.on_complete:
            self.on_complete()
        self.app.pop_screen()
