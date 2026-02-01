"""Chat message bubble widget."""

from __future__ import annotations

from textual.app import ComposeResult
from textual.containers import Vertical
from textual.widgets import Static


class ChatMessage(Vertical):
    """A single chat message bubble."""

    def __init__(self, role: str, content: str, **kwargs) -> None:
        super().__init__(**kwargs)
        self.role = role
        self.content = content
        self.add_class("chat-message")
        self.add_class(f"chat-message-{role}")

    def compose(self) -> ComposeResult:
        role_label = "You" if self.role == "user" else "AI Adviser"
        yield Static(f"[bold]{role_label}[/bold]")
        yield Static(self.content)
        if self.role == "assistant":
            yield Static("[dim italic]AI-generated analysis. Verify with a financial professional.[/dim italic]")
