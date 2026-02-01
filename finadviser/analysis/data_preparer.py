"""Prepares financial data context for Claude API calls."""

from __future__ import annotations

import sqlite3
from decimal import Decimal

from finadviser.config import AppConfig
from finadviser.db.models import AccountType
from finadviser.db.repositories import AccountRepo, JournalRepo, PropertyRepo
from finadviser.properties.equity_calculator import EquityCalculator
from finadviser.utils.formatting import format_currency


class DataPreparer:
    """Queries DB and formats financial context for Claude.

    RAG-style: only includes data relevant to the question.
    """

    def __init__(self, conn: sqlite3.Connection, config: AppConfig) -> None:
        self.conn = conn
        self.config = config
        self.account_repo = AccountRepo(conn)
        self.journal_repo = JournalRepo(conn)
        self.prop_repo = PropertyRepo(conn)
        self.equity_calc = EquityCalculator(conn)

    def prepare_context(self, query: str) -> str:
        """Prepare relevant financial context based on the user's query."""
        sections = []
        query_lower = query.lower()

        # Always include account balances summary
        sections.append(self._account_summary())

        # Include spending data for spending/budget queries
        if any(kw in query_lower for kw in ("spend", "budget", "expense", "category", "saving", "income", "money")):
            sections.append(self._spending_summary())
            sections.append(self._recent_transactions())

        # Include property data for property/equity queries
        if any(kw in query_lower for kw in ("property", "properties", "equity", "mortgage", "house", "home", "real estate", "owner")):
            sections.append(self._property_summary())

        # Include net worth for financial health queries
        if any(kw in query_lower for kw in ("net worth", "financial", "health", "wealth", "overview", "summary", "total")):
            sections.append(self._net_worth_summary())

        # For generic queries, include a broad overview
        if not sections or len(sections) <= 1:
            sections.append(self._spending_summary())
            sections.append(self._recent_transactions())

        return "\n\n".join(filter(None, sections))

    def _account_summary(self) -> str:
        balances = self.account_repo.get_balances()
        if not balances:
            return "ACCOUNT BALANCES: No accounts set up yet."

        currency = self.config.currency_symbol
        lines = ["ACCOUNT BALANCES:"]
        for b in balances:
            lines.append(f"  {b.account_name} ({b.account_type.value}): {format_currency(b.balance, currency)}")
        return "\n".join(lines)

    def _spending_summary(self) -> str:
        spending = self.journal_repo.get_monthly_spending()
        if not spending:
            return "MONTHLY SPENDING: No spending data available."

        currency = self.config.currency_symbol
        lines = ["MONTHLY SPENDING BY CATEGORY:"]

        # Group by month
        by_month: dict[str, list] = {}
        for row in spending:
            month = row.get("month", "unknown")
            by_month.setdefault(month, []).append(row)

        for month in sorted(by_month.keys(), reverse=True)[:3]:
            lines.append(f"\n  {month}:")
            for row in by_month[month]:
                cat = row.get("category_name") or "Uncategorized"
                total = abs(row.get("total", 0))
                lines.append(f"    {cat}: {format_currency(total, currency)}")

        return "\n".join(lines)

    def _recent_transactions(self, limit: int = 20) -> str:
        entries = self.journal_repo.list_entries(limit=limit)
        if not entries:
            return "RECENT TRANSACTIONS: None recorded."

        currency = self.config.currency_symbol
        lines = [f"RECENT TRANSACTIONS (last {limit}):"]

        for entry in entries:
            cat = entry.get("category_name") or "Uncategorized"
            lines.append(
                f"  {entry.get('date', '')} | {entry.get('description', '')[:40]} | "
                f"{cat} | {entry.get('entries_summary', '')}"
            )

        return "\n".join(lines)

    def _property_summary(self) -> str:
        properties = self.prop_repo.list_properties()
        if not properties:
            return "PROPERTIES: No properties recorded."

        currency = self.config.currency_symbol
        lines = ["PROPERTY EQUITY SUMMARY:"]

        for prop in properties:
            pid = prop["id"]
            lines.append(f"\n  {prop['name']}:")
            lines.append(f"    Address: {prop.get('address', 'N/A')}")
            lines.append(f"    Purchase Price: {format_currency(prop.get('purchase_price', 0), currency)}")

            valuation = self.prop_repo.get_latest_valuation(pid)
            if valuation:
                lines.append(f"    Current Valuation: {format_currency(valuation['valuation'], currency)} ({valuation['valuation_date']})")

            mortgages = self.prop_repo.get_mortgages(pid)
            for m in mortgages:
                balance = self.prop_repo.get_mortgage_balance(m["id"])
                lines.append(f"    Mortgage ({m['lender']}): Balance {format_currency(abs(balance), currency)}")

            equity_data = self.equity_calc.calculate(pid)
            if equity_data:
                lines.append("    Owner Equity:")
                for e in equity_data:
                    lines.append(
                        f"      {e['name']}: {format_currency(e['equity_amount'], currency)} "
                        f"({e['equity_pct']:.1f}%)"
                    )

        return "\n".join(lines)

    def _net_worth_summary(self) -> str:
        balances = self.account_repo.get_balances()
        currency = self.config.currency_symbol

        assets = sum(
            (b.balance for b in balances if b.account_type == AccountType.ASSET),
            Decimal("0"),
        )
        liabilities = sum(
            (abs(b.balance) for b in balances if b.account_type == AccountType.LIABILITY),
            Decimal("0"),
        )
        net_worth = assets - liabilities

        return (
            f"NET WORTH SUMMARY:\n"
            f"  Total Assets: {format_currency(assets, currency)}\n"
            f"  Total Liabilities: {format_currency(liabilities, currency)}\n"
            f"  Net Worth: {format_currency(net_worth, currency)}"
        )
