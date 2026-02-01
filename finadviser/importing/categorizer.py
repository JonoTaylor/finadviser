"""Rule-based transaction categorization."""

from __future__ import annotations

import re
import sqlite3

from finadviser.db.models import CategorizationRule, MatchType, RawTransaction
from finadviser.db.repositories import CategoryRepo


class RuleCategorizer:
    """Categorize transactions using pattern-based rules."""

    def __init__(self, conn: sqlite3.Connection) -> None:
        self.category_repo = CategoryRepo(conn)
        self._rules: list[CategorizationRule] | None = None

    @property
    def rules(self) -> list[CategorizationRule]:
        if self._rules is None:
            self._rules = self.category_repo.get_rules()
        return self._rules

    def categorize(self, transactions: list[RawTransaction]) -> list[RawTransaction]:
        """Apply categorization rules to a list of transactions."""
        for txn in transactions:
            if txn.is_duplicate:
                continue
            txn.suggested_category_id = self._match(txn.description)
        return transactions

    def _match(self, description: str) -> int | None:
        """Find the best matching rule for a description."""
        desc_lower = description.lower()

        for rule in self.rules:
            pattern = rule.pattern.lower()

            if rule.match_type == MatchType.EXACT and desc_lower == pattern:
                return rule.category_id
            elif rule.match_type == MatchType.STARTSWITH and desc_lower.startswith(pattern):
                return rule.category_id
            elif rule.match_type == MatchType.CONTAINS and pattern in desc_lower:
                return rule.category_id
            elif rule.match_type == MatchType.REGEX:
                try:
                    if re.search(rule.pattern, description, re.IGNORECASE):
                        return rule.category_id
                except re.error:
                    continue

        return None

    def learn_from_correction(self, description: str, category_id: int) -> None:
        """Create a new rule from a user correction."""
        rule = CategorizationRule(
            pattern=description.lower(),
            category_id=category_id,
            match_type=MatchType.CONTAINS,
            priority=10,
            source="user",
        )
        self.category_repo.add_rule(rule)
        self._rules = None  # Invalidate cache
