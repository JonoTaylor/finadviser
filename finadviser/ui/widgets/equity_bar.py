"""Horizontal stacked bar showing owner equity split."""

from __future__ import annotations

from textual.app import ComposeResult
from textual.widget import Widget
from textual.widgets import Static

from finadviser.utils.formatting import format_currency, format_percentage

# Colors for different owners
OWNER_COLORS = ["#4ecdc4", "#ff6b6b", "#45b7d1", "#96ceb4", "#feca57", "#a55eea"]


class EquityBar(Widget):
    """Horizontal stacked bar showing equity split between owners."""

    DEFAULT_CSS = """
    EquityBar {
        height: 5;
        padding: 0 1;
    }
    """

    def __init__(self, owners: list[dict], **kwargs) -> None:
        """owners: list of {name, equity_pct, equity_amount}"""
        super().__init__(**kwargs)
        self.owners = owners

    def compose(self) -> ComposeResult:
        if not self.owners:
            yield Static("[dim]No ownership data[/dim]")
            return

        # Build the bar representation
        bar_width = 50
        parts = []
        legend_parts = []

        for i, owner in enumerate(self.owners):
            color = OWNER_COLORS[i % len(OWNER_COLORS)]
            pct = owner.get("equity_pct", 0)
            chars = max(1, int(bar_width * pct / 100))
            parts.append(f"[on {color}]{' ' * chars}[/]")
            legend_parts.append(
                f"[{color}]\u2588[/] {owner['name']}: "
                f"{format_percentage(pct)} "
                f"({format_currency(owner.get('equity_amount', 0))})"
            )

        bar_text = "".join(parts)
        legend_text = "  ".join(legend_parts)

        yield Static(f"[bold]Equity Split[/bold]\n{bar_text}\n{legend_text}")

    def update_data(self, owners: list[dict]) -> None:
        self.owners = owners
        self.refresh(recompose=True)
