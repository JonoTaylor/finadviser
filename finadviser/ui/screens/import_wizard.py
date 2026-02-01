"""Multi-step CSV import wizard."""

from __future__ import annotations

import sqlite3
from pathlib import Path

from textual.app import ComposeResult
from textual.containers import Vertical
from textual.screen import Screen
from textual.widgets import Button, DataTable, Input, Select, Static

from finadviser.config import AppConfig
from finadviser.db.models import RawTransaction
from finadviser.db.repositories import AccountRepo
from finadviser.importing.bank_config import get_all_configs
from finadviser.importing.import_pipeline import ImportPipeline
from finadviser.utils.formatting import format_currency


class ImportWizardScreen(Screen):
    """Multi-step import: select file -> choose bank -> select account -> preview -> confirm."""

    def __init__(self, conn: sqlite3.Connection, config: AppConfig, **kwargs) -> None:
        super().__init__(**kwargs)
        self.conn = conn
        self.config = config
        self.pipeline = ImportPipeline(conn, config)
        self.preview_data: list[RawTransaction] = []

    def compose(self) -> ComposeResult:
        configs = get_all_configs(self.config.bank_configs_dir)
        accounts = AccountRepo(self.conn).list_all()

        yield Vertical(
            Static("[bold]CSV Import Wizard[/bold]", classes="section-title"),

            # Step 1: File path
            Vertical(
                Static("[bold]Step 1:[/bold] CSV File Path", classes="wizard-step-title"),
                Input(placeholder="Enter path to CSV file...", id="csv-path-input"),
                classes="wizard-step",
            ),

            # Step 2: Bank config
            Vertical(
                Static("[bold]Step 2:[/bold] Bank Format", classes="wizard-step-title"),
                Select(
                    [(f"{name} - {cfg.description}" if cfg.description else name, name) for name, cfg in configs.items()],
                    prompt="Select bank format...",
                    id="bank-config-select",
                    allow_blank=True,
                ),
                Static("[dim]Add YAML configs to ~/.finadviser/bank_configs/[/dim]"),
                classes="wizard-step",
            ),

            # Step 3: Account
            Vertical(
                Static("[bold]Step 3:[/bold] Target Account", classes="wizard-step-title"),
                Select(
                    [(acc.name, acc.name) for acc in accounts],
                    prompt="Select account...",
                    id="account-select",
                    allow_blank=True,
                ),
                Input(placeholder="Or type new account name...", id="new-account-input"),
                classes="wizard-step",
            ),

            # Actions
            Button("Preview Import", id="preview-btn", variant="default"),
            Button("Confirm Import", id="confirm-btn", variant="success", disabled=True),

            # Preview area
            Static("", id="preview-status"),
            DataTable(id="preview-table"),

            id="import-wizard",
        )

    def _get_inputs(self) -> tuple[str, str, str] | None:
        csv_path = self.query_one("#csv-path-input", Input).value.strip()
        bank_select = self.query_one("#bank-config-select", Select)
        account_select = self.query_one("#account-select", Select)
        new_account = self.query_one("#new-account-input", Input).value.strip()

        bank_config = bank_select.value if bank_select.value != Select.BLANK else None
        account = account_select.value if account_select.value != Select.BLANK else None

        if not account and new_account:
            account = new_account

        if not csv_path or not bank_config or not account:
            self.query_one("#preview-status", Static).update(
                "[red]Please fill in all fields (CSV path, bank format, and account)[/red]"
            )
            return None

        if not Path(csv_path).expanduser().exists():
            self.query_one("#preview-status", Static).update(
                f"[red]File not found: {csv_path}[/red]"
            )
            return None

        return csv_path, bank_config, account

    def on_button_pressed(self, event: Button.Pressed) -> None:
        if event.button.id == "preview-btn":
            self._do_preview()
        elif event.button.id == "confirm-btn":
            self._do_import()

    def _do_preview(self) -> None:
        inputs = self._get_inputs()
        if not inputs:
            return

        csv_path, bank_config, account = inputs
        status = self.query_one("#preview-status", Static)
        table = self.query_one("#preview-table", DataTable)

        try:
            self.preview_data = self.pipeline.preview(
                Path(csv_path).expanduser(), bank_config, account
            )
        except Exception as e:
            status.update(f"[red]Error: {e}[/red]")
            return

        # Populate preview table
        table.clear(columns=True)
        table.add_columns("", "Date", "Description", "Amount", "Category")

        dupes = sum(1 for t in self.preview_data if t.is_duplicate)
        new = len(self.preview_data) - dupes

        for txn in self.preview_data:
            marker = "[dim]DUP[/dim]" if txn.is_duplicate else "[green]NEW[/green]"
            table.add_row(
                marker,
                str(txn.date),
                txn.description[:50],
                format_currency(txn.amount, self.config.currency_symbol),
                str(txn.suggested_category_id or "—"),
            )

        status.update(
            f"Found {len(self.preview_data)} transactions: "
            f"[green]{new} new[/green], [dim]{dupes} duplicates[/dim]"
        )
        self.query_one("#confirm-btn", Button).disabled = new == 0

    def _do_import(self) -> None:
        inputs = self._get_inputs()
        if not inputs:
            return

        csv_path, bank_config, account = inputs
        status = self.query_one("#preview-status", Static)

        try:
            result = self.pipeline.run(
                Path(csv_path).expanduser(), bank_config, account
            )
            status.update(
                f"[green]Import complete![/green] "
                f"{result.imported_count} imported, {result.duplicate_count} duplicates skipped"
            )
            self.query_one("#confirm-btn", Button).disabled = True
        except Exception as e:
            status.update(f"[red]Import failed: {e}[/red]")
