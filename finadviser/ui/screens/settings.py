"""Settings screen."""

from __future__ import annotations

import sqlite3

from textual.app import ComposeResult
from textual.containers import Vertical
from textual.screen import Screen
from textual.widgets import Button, Input, Static

from finadviser.config import AppConfig


class SettingsScreen(Screen):
    """Application settings management."""

    def __init__(self, conn: sqlite3.Connection, config: AppConfig, **kwargs) -> None:
        super().__init__(**kwargs)
        self.conn = conn
        self.config = config

    def compose(self) -> ComposeResult:
        yield Vertical(
            Static("[bold]Settings[/bold]", classes="section-title"),

            Vertical(
                Static("[bold]API Configuration[/bold]", classes="settings-group-title"),
                Static("Anthropic API Key:"),
                Input(
                    value="••••••••" if self.config.anthropic_api_key else "",
                    placeholder="Set via ANTHROPIC_API_KEY env var",
                    id="api-key-input",
                    password=True,
                ),
                Static("[dim]Set ANTHROPIC_API_KEY in your environment for persistence[/dim]"),
                classes="settings-group",
            ),

            Vertical(
                Static("[bold]Display[/bold]", classes="settings-group-title"),
                Static("Currency Symbol:"),
                Input(value=self.config.currency_symbol, id="currency-input"),
                classes="settings-group",
            ),

            Vertical(
                Static("[bold]Data[/bold]", classes="settings-group-title"),
                Static(f"Database: {self.config.db_path}"),
                Static(f"Bank Configs: {self.config.bank_configs_dir}"),
                Static(f"Data Directory: {self.config.data_dir}"),
                Button("Export Data (CSV)", id="export-csv-btn", variant="default"),
                Button("Export Data (JSON)", id="export-json-btn", variant="default"),
                classes="settings-group",
            ),

            Vertical(
                Static("[bold]About[/bold]", classes="settings-group-title"),
                Static("finadviser v0.1.0"),
                Static("Personal financial adviser TUI application"),
                classes="settings-group",
            ),

            id="settings-container",
        )

    def on_button_pressed(self, event: Button.Pressed) -> None:
        if event.button.id == "export-csv-btn":
            self._export_csv()
        elif event.button.id == "export-json-btn":
            self._export_json()

    def _export_csv(self) -> None:
        import csv
        from pathlib import Path

        from finadviser.db.repositories import JournalRepo

        repo = JournalRepo(self.conn)
        entries = repo.list_entries(limit=10000)

        export_path = self.config.data_dir / "export.csv"
        with open(export_path, "w", newline="") as f:
            writer = csv.DictWriter(f, fieldnames=["id", "date", "description", "category_name", "entries_summary"])
            writer.writeheader()
            for entry in entries:
                writer.writerow({
                    "id": entry.get("id"),
                    "date": entry.get("date"),
                    "description": entry.get("description"),
                    "category_name": entry.get("category_name", ""),
                    "entries_summary": entry.get("entries_summary", ""),
                })

        self.notify(f"Exported to {export_path}")

    def _export_json(self) -> None:
        import json
        from pathlib import Path

        from finadviser.db.repositories import JournalRepo

        repo = JournalRepo(self.conn)
        entries = repo.list_entries(limit=10000)

        export_path = self.config.data_dir / "export.json"
        with open(export_path, "w") as f:
            json.dump(entries, f, indent=2, default=str)

        self.notify(f"Exported to {export_path}")
