"""Hashing utilities for transaction fingerprinting."""

from __future__ import annotations

import hashlib


def transaction_fingerprint(date: str, amount: str, description: str) -> str:
    """Generate a SHA-256 fingerprint for a transaction.

    Used to detect duplicate imports. The fingerprint is based on
    the normalized date, amount, and description.
    """
    normalized = f"{date.strip()}|{amount.strip()}|{description.strip().lower()}"
    return hashlib.sha256(normalized.encode("utf-8")).hexdigest()
