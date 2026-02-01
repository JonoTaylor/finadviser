"""Multi-turn conversation state management."""

from __future__ import annotations

import sqlite3

from finadviser.db.repositories import ConversationRepo


class ConversationManager:
    """Manages multi-turn chat state and context window."""

    MAX_HISTORY_MESSAGES = 20

    def __init__(self, conn: sqlite3.Connection) -> None:
        self.conn = conn
        self.repo = ConversationRepo(conn)
        self._current_id: int | None = None

    @property
    def current_id(self) -> int | None:
        return self._current_id

    def start_new(self, title: str | None = None) -> int:
        """Start a new conversation."""
        self._current_id = self.repo.create_conversation(title)
        return self._current_id

    def load(self, conversation_id: int) -> list[dict]:
        """Load an existing conversation's messages."""
        self._current_id = conversation_id
        return self.repo.get_messages(conversation_id)

    def add_user_message(self, content: str) -> int:
        """Add a user message to the current conversation."""
        if self._current_id is None:
            self.start_new(content[:50])
        return self.repo.add_message(self._current_id, "user", content)

    def add_assistant_message(self, content: str) -> int:
        """Add an assistant message to the current conversation."""
        if self._current_id is None:
            raise ValueError("No active conversation")
        return self.repo.add_message(self._current_id, "assistant", content)

    def get_history(self) -> list[dict]:
        """Get recent message history for the current conversation.

        Truncates to MAX_HISTORY_MESSAGES to manage context window.
        """
        if self._current_id is None:
            return []

        messages = self.repo.get_messages(self._current_id)

        # Truncate from the beginning if too long
        if len(messages) > self.MAX_HISTORY_MESSAGES:
            messages = messages[-self.MAX_HISTORY_MESSAGES:]

        return [
            {"role": m["role"], "content": m["content"]}
            for m in messages
            if m["role"] in ("user", "assistant")
        ]

    def list_conversations(self) -> list[dict]:
        """List all conversations."""
        return self.repo.list_conversations()
