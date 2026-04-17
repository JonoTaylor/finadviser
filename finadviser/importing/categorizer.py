"""Rule-based transaction categorization."""

from __future__ import annotations

import re
import sqlite3

from finadviser.db.models import CategorizationRule, MatchType, RawTransaction
from finadviser.db.repositories import CategoryRepo

# ReDoS mitigations mirroring the TypeScript implementation
# (web/src/lib/utils/regex-safety.ts). Runtime input is capped; patterns with
# nested quantifiers are refused. Follow-up (H5): route regex through the
# `google-re2` package or a subprocess with a hard timeout.
PATTERN_MAX_LENGTH = 500
MATCH_INPUT_CAP = 1000
_NESTED_QUANTIFIER = re.compile(r"\((?:[^()]*[+*]|[^()]*\{\d+,?\d*\})[^()]*\)[+*]")


def is_safe_regex(pattern: str) -> tuple[bool, str]:
    if not pattern:
        return False, "Pattern is empty"
    if len(pattern) > PATTERN_MAX_LENGTH:
        return False, f"Pattern exceeds {PATTERN_MAX_LENGTH} characters"
    try:
        re.compile(pattern)
    except re.error:
        return False, "Invalid regex syntax"
    if _NESTED_QUANTIFIER.search(pattern):
        return False, (
            "Pattern contains a nested quantifier (e.g. (a+)+) which is vulnerable "
            "to catastrophic backtracking"
        )
    return True, ""


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
                ok, _ = is_safe_regex(rule.pattern)
                if not ok:
                    continue
                try:
                    capped = description[:MATCH_INPUT_CAP]
                    if re.search(rule.pattern, capped, re.IGNORECASE):
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
