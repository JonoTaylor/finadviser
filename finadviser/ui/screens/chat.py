"""AI Chat screen with quick analysis buttons."""

from __future__ import annotations

import sqlite3

from textual.app import ComposeResult
from textual.containers import Horizontal, Vertical, VerticalScroll
from textual.screen import Screen
from textual.widgets import Button, Input, ListItem, ListView, Static

from finadviser.config import AppConfig
from finadviser.db.repositories import ConversationRepo
from finadviser.ui.widgets.chat_message import ChatMessage


class ChatScreen(Screen):
    """AI chat with quick analysis buttons and conversation history."""

    def __init__(self, conn: sqlite3.Connection, config: AppConfig, **kwargs) -> None:
        super().__init__(**kwargs)
        self.conn = conn
        self.config = config
        self.conv_repo = ConversationRepo(conn)
        self._current_conversation_id: int | None = None

    def compose(self) -> ComposeResult:
        yield Horizontal(
            Vertical(
                Static("[bold]Quick Analysis[/bold]", classes="section-title"),
                Button("Spending Summary", id="btn-spending", variant="primary"),
                Button("Budget Check", id="btn-budget", variant="primary"),
                Button("Property Report", id="btn-property", variant="primary"),
                Button("Net Worth Trend", id="btn-networth", variant="primary"),
                Static("\n[bold]History[/bold]", classes="section-title"),
                ListView(id="conversation-list"),
                Button("New Chat", id="btn-new-chat", variant="default"),
                id="chat-sidebar",
            ),
            Vertical(
                VerticalScroll(id="chat-messages"),
                Horizontal(
                    Input(placeholder="Ask your financial adviser...", id="chat-input"),
                    Button("Send", id="btn-send", variant="success"),
                    id="chat-input-area",
                ),
                id="chat-main",
            ),
            id="chat-container",
        )

    async def on_mount(self) -> None:
        await self._refresh_conversations()
        self._show_welcome()

    async def on_screen_resume(self) -> None:
        await self._refresh_conversations()

    def _show_welcome(self) -> None:
        messages = self.query_one("#chat-messages", VerticalScroll)
        messages.mount(ChatMessage(
            "assistant",
            "Welcome! I'm your AI financial adviser. I can help you with:\n\n"
            "- **Spending analysis** - Understand where your money goes\n"
            "- **Budget recommendations** - Suggestions for saving more\n"
            "- **Property reports** - Equity breakdown and analysis\n"
            "- **Net worth trends** - Track your financial progress\n\n"
            "Use the quick buttons or type a question below. "
            "Make sure your ANTHROPIC_API_KEY is set.",
        ))

    async def _refresh_conversations(self) -> None:
        listview = self.query_one("#conversation-list", ListView)
        await listview.clear()
        for conv in self.conv_repo.list_conversations():
            title = conv.get("title") or f"Chat {conv['id']}"
            listview.append(ListItem(Static(title), id=f"conv-{conv['id']}"))

    async def on_button_pressed(self, event: Button.Pressed) -> None:
        quick_prompts = {
            "btn-spending": "Give me a spending summary for the most recent month. Break down by category and highlight any unusual spending.",
            "btn-budget": "Analyze my spending patterns and suggest a budget. What areas could I save more?",
            "btn-property": "Generate a comprehensive property equity report for all my properties, showing each owner's equity position.",
            "btn-networth": "Analyze my net worth trend. What are my total assets and liabilities, and how is my financial health?",
        }

        if event.button.id in quick_prompts:
            await self._send_message(quick_prompts[event.button.id])
        elif event.button.id == "btn-send":
            await self._send_from_input()
        elif event.button.id == "btn-new-chat":
            self._current_conversation_id = None
            messages = self.query_one("#chat-messages", VerticalScroll)
            # Remove all chat messages
            for child in list(messages.children):
                child.remove()
            self._show_welcome()

    async def on_input_submitted(self, event: Input.Submitted) -> None:
        if event.input.id == "chat-input":
            await self._send_from_input()

    async def _send_from_input(self) -> None:
        input_widget = self.query_one("#chat-input", Input)
        text = input_widget.value.strip()
        if text:
            input_widget.value = ""
            await self._send_message(text)

    async def _send_message(self, text: str) -> None:
        messages = self.query_one("#chat-messages", VerticalScroll)

        # Create conversation if needed
        if self._current_conversation_id is None:
            title = text[:50] + "..." if len(text) > 50 else text
            self._current_conversation_id = self.conv_repo.create_conversation(title)
            await self._refresh_conversations()

        # Add user message
        self.conv_repo.add_message(self._current_conversation_id, "user", text)
        messages.mount(ChatMessage("user", text))

        # Generate AI response
        self._generate_response(text)

    def _generate_response(self, user_message: str) -> None:
        messages = self.query_one("#chat-messages", VerticalScroll)

        if not self.config.anthropic_api_key:
            messages.mount(ChatMessage(
                "assistant",
                "API key not configured. Set ANTHROPIC_API_KEY environment variable to enable AI analysis.",
            ))
            return

        try:
            from finadviser.analysis.claude_client import ClaudeClient
            from finadviser.analysis.data_preparer import DataPreparer

            preparer = DataPreparer(self.conn, self.config)
            context = preparer.prepare_context(user_message)

            client = ClaudeClient(self.config.anthropic_api_key)

            # Get conversation history
            history = []
            if self._current_conversation_id:
                for msg in self.conv_repo.get_messages(self._current_conversation_id):
                    if msg["role"] in ("user", "assistant"):
                        history.append({"role": msg["role"], "content": msg["content"]})

            response = client.chat(user_message, context, history[:-1])  # exclude current msg

            if self._current_conversation_id:
                self.conv_repo.add_message(self._current_conversation_id, "assistant", response)
            messages.mount(ChatMessage("assistant", response))

        except Exception as e:
            messages.mount(ChatMessage("assistant", f"Error: {e}"))
