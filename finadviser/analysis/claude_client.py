"""Anthropic Claude API client wrapper."""

from __future__ import annotations

import anthropic

from finadviser.analysis.prompts import SYSTEM_PROMPT
from finadviser.analysis.schemas import ChatResponse


class ClaudeClient:
    """Wrapper around the Anthropic SDK for financial analysis."""

    MODEL = "claude-sonnet-4-20250514"

    def __init__(self, api_key: str) -> None:
        self.client = anthropic.Anthropic(api_key=api_key)

    def chat(
        self,
        user_message: str,
        financial_context: str,
        history: list[dict] | None = None,
    ) -> str:
        """Send a message with financial context and get a response."""
        messages = []

        # Add conversation history
        if history:
            messages.extend(history)

        # Add current message with context
        content = user_message
        if financial_context:
            content = (
                f"{user_message}\n\n"
                f"--- Financial Data Context ---\n{financial_context}"
            )

        messages.append({"role": "user", "content": content})

        response = self.client.messages.create(
            model=self.MODEL,
            max_tokens=4096,
            system=SYSTEM_PROMPT,
            messages=messages,
        )

        return response.content[0].text

    def categorize_batch(
        self,
        descriptions: list[str],
        available_categories: list[str],
    ) -> dict[str, str]:
        """Ask Claude to categorize a batch of transaction descriptions.

        Returns a mapping of description -> suggested category name.
        """
        from finadviser.analysis.prompts import CATEGORIZATION_PROMPT

        prompt = CATEGORIZATION_PROMPT.format(
            categories="\n".join(f"- {c}" for c in available_categories),
            transactions="\n".join(f"- {d}" for d in descriptions),
        )

        response = self.client.messages.create(
            model=self.MODEL,
            max_tokens=2048,
            system="You are a financial transaction categorizer. Respond only with valid JSON.",
            messages=[{"role": "user", "content": prompt}],
        )

        import json
        try:
            result = json.loads(response.content[0].text)
            return result if isinstance(result, dict) else {}
        except (json.JSONDecodeError, IndexError):
            return {}

    def generate_structured(
        self,
        prompt: str,
        context: str,
        response_schema: type,
    ) -> dict:
        """Generate a structured response matching a Pydantic schema."""
        from finadviser.analysis.prompts import STRUCTURED_PROMPT

        schema_json = response_schema.model_json_schema()
        full_prompt = STRUCTURED_PROMPT.format(
            prompt=prompt,
            context=context,
            schema=schema_json,
        )

        response = self.client.messages.create(
            model=self.MODEL,
            max_tokens=4096,
            system="You are a financial analyst. Respond only with valid JSON matching the provided schema.",
            messages=[{"role": "user", "content": full_prompt}],
        )

        import json
        try:
            return json.loads(response.content[0].text)
        except (json.JSONDecodeError, IndexError):
            return {}
