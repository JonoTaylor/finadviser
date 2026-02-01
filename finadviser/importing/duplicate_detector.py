"""Duplicate transaction detection."""

from __future__ import annotations

import sqlite3

from finadviser.db.models import RawTransaction
from finadviser.db.repositories import FingerprintRepo


class DuplicateDetector:
    """Marks transactions as duplicates if their fingerprint already exists for the account."""

    def __init__(self, conn: sqlite3.Connection) -> None:
        self.fp_repo = FingerprintRepo(conn)

    def check(self, transactions: list[RawTransaction], account_id: int) -> list[RawTransaction]:
        """Check each transaction for duplicates and set is_duplicate flag.

        Also detects duplicates within the batch itself.
        """
        seen_in_batch: set[str] = set()

        for txn in transactions:
            if self.fp_repo.exists(txn.fingerprint, account_id):
                txn.is_duplicate = True
            elif txn.fingerprint in seen_in_batch:
                txn.is_duplicate = True
            else:
                seen_in_batch.add(txn.fingerprint)

        return transactions
