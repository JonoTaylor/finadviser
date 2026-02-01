"""Main Textual application."""

from __future__ import annotations

from textual.app import App, ComposeResult
from textual.binding import Binding
from textual.widgets import Footer, Header

from finadviser.config import AppConfig
from finadviser.db.connection import get_connection, initialize_database


class FinAdviserApp(App):
    """Personal financial adviser TUI application."""

    TITLE = "finadviser"
    SUB_TITLE = "Personal Financial Adviser"

    CSS_PATH = "styles/app.tcss"

    BINDINGS = [
        Binding("d", "switch_screen('dashboard')", "Dashboard", show=True),
        Binding("t", "switch_screen('transactions')", "Transactions", show=True),
        Binding("i", "switch_screen('import_wizard')", "Import", show=True),
        Binding("p", "switch_screen('properties')", "Properties", show=True),
        Binding("a", "switch_screen('chat')", "AI Chat", show=True),
        Binding("s", "switch_screen('settings')", "Settings", show=True),
        Binding("q", "quit", "Quit", show=True),
    ]

    def __init__(self, config: AppConfig | None = None, **kwargs) -> None:
        super().__init__(**kwargs)
        self.config = config or AppConfig()
        self.config.ensure_dirs()
        self.conn = get_connection(self.config.db_path)
        initialize_database(self.conn)

    def on_mount(self) -> None:
        """Register screens and show dashboard."""
        from finadviser.ui.screens.chat import ChatScreen
        from finadviser.ui.screens.dashboard import DashboardScreen
        from finadviser.ui.screens.import_wizard import ImportWizardScreen
        from finadviser.ui.screens.properties import PropertiesScreen
        from finadviser.ui.screens.settings import SettingsScreen
        from finadviser.ui.screens.transactions import TransactionsScreen

        self.install_screen(DashboardScreen(self.conn, self.config), name="dashboard")
        self.install_screen(TransactionsScreen(self.conn, self.config), name="transactions")
        self.install_screen(ImportWizardScreen(self.conn, self.config), name="import_wizard")
        self.install_screen(PropertiesScreen(self.conn, self.config), name="properties")
        self.install_screen(ChatScreen(self.conn, self.config), name="chat")
        self.install_screen(SettingsScreen(self.conn, self.config), name="settings")
        self.push_screen("dashboard")

    def compose(self) -> ComposeResult:
        yield Header()
        yield Footer()

    def action_switch_screen(self, screen_name: str) -> None:
        """Switch to a named screen."""
        # Pop back to base then push the target
        while len(self.screen_stack) > 1:
            self.pop_screen()
        self.push_screen(screen_name)
