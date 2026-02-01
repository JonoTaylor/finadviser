"""Equity calculation engine using capital account method."""

from __future__ import annotations

import sqlite3
from decimal import Decimal

from finadviser.db.repositories import AccountRepo, PropertyRepo


class EquityCalculator:
    """Derives each owner's equity from capital account book entries.

    Core formula:
        owner_equity_pct = owner_capital_balance / total_capital
        market_equity = pct * (valuation - mortgage_balance)
    """

    def __init__(self, conn: sqlite3.Connection) -> None:
        self.conn = conn
        self.prop_repo = PropertyRepo(conn)
        self.account_repo = AccountRepo(conn)

    def calculate(self, property_id: int) -> list[dict]:
        """Calculate equity breakdown for all owners of a property.

        Returns list of dicts with: name, capital_balance, equity_pct, equity_amount
        """
        ownership = self.prop_repo.get_ownership(property_id)
        if not ownership:
            return []

        # Get latest valuation
        valuation = self.prop_repo.get_latest_valuation(property_id)
        market_value = Decimal(str(valuation["valuation"])) if valuation else Decimal("0")

        # Get mortgage balance (deduplicate shared liability accounts)
        mortgages = self.prop_repo.get_mortgages(property_id)
        total_mortgage_balance = Decimal("0")
        seen_accounts: set[int] = set()
        for m in mortgages:
            acc_id = m["liability_account_id"]
            if acc_id in seen_accounts:
                continue
            seen_accounts.add(acc_id)
            balance = self.account_repo.get_balance(acc_id)
            total_mortgage_balance += abs(balance)

        # Net equity in the property
        net_equity = market_value - total_mortgage_balance

        # Calculate each owner's capital balance
        owner_data = []
        total_capital = Decimal("0")

        for own in ownership:
            capital_balance = self.account_repo.get_balance(own["capital_account_id"])
            total_capital += capital_balance
            owner_data.append({
                "owner_id": own["owner_id"],
                "name": own["owner_name"],
                "capital_account_id": own["capital_account_id"],
                "capital_balance": capital_balance,
            })

        # Calculate percentages and market equity
        for owner in owner_data:
            if total_capital > 0:
                pct = float(owner["capital_balance"] / total_capital * 100)
            else:
                # Equal split if no capital recorded
                pct = 100.0 / len(owner_data)

            owner["equity_pct"] = pct
            owner["equity_amount"] = net_equity * Decimal(str(pct)) / Decimal("100")

        return owner_data

    def calculate_all(self) -> dict[int, list[dict]]:
        """Calculate equity for all properties. Returns {property_id: [owner_equity]}."""
        result = {}
        for prop in self.prop_repo.list_properties():
            result[prop["id"]] = self.calculate(prop["id"])
        return result

    def get_owner_total_equity(self, owner_id: int) -> Decimal:
        """Total equity across all properties for one owner."""
        total = Decimal("0")
        for prop in self.prop_repo.list_properties():
            equity_data = self.calculate(prop["id"])
            for e in equity_data:
                if e["owner_id"] == owner_id:
                    total += e["equity_amount"]
        return total
