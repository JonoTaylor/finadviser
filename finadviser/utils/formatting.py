"""Formatting utilities for display."""

from __future__ import annotations

from decimal import Decimal


def format_currency(amount: Decimal | float, symbol: str = "$") -> str:
    """Format a numeric amount as currency."""
    value = Decimal(str(amount))
    if value < 0:
        return f"-{symbol}{abs(value):,.2f}"
    return f"{symbol}{value:,.2f}"


def format_percentage(value: float, decimals: int = 1) -> str:
    """Format a float as a percentage string."""
    return f"{value:.{decimals}f}%"
