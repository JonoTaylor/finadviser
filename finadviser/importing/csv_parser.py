"""Parse CSV files using bank configurations."""

from __future__ import annotations

from datetime import datetime
from decimal import Decimal, InvalidOperation
from pathlib import Path

import pandas as pd

from finadviser.db.models import RawTransaction
from finadviser.importing.bank_config import BankConfig
from finadviser.utils.hashing import transaction_fingerprint


def parse_csv(file_path: Path, config: BankConfig) -> list[RawTransaction]:
    """Parse a bank CSV file into a list of RawTransaction objects."""
    df = pd.read_csv(
        file_path,
        skiprows=config.skip_rows,
        encoding=config.encoding,
        delimiter=config.delimiter,
        dtype=str,
    )

    # Strip whitespace from column names
    df.columns = df.columns.str.strip()

    transactions: list[RawTransaction] = []

    for _, row in df.iterrows():
        try:
            txn = _parse_row(row, config)
            if txn is not None:
                transactions.append(txn)
        except (ValueError, KeyError, InvalidOperation):
            continue

    return transactions


def _parse_row(row: pd.Series, config: BankConfig) -> RawTransaction | None:
    """Parse a single CSV row into a RawTransaction."""
    cols = config.columns

    # Parse date
    date_str = str(row[cols.date]).strip()
    parsed_date = datetime.strptime(date_str, config.date_format).date()

    # Parse description
    description = str(row[cols.description]).strip()
    if not description or description == "nan":
        return None

    # Parse amount
    if cols.amount:
        amount_str = str(row[cols.amount]).strip().replace(",", "").replace("$", "")
        if not amount_str or amount_str == "nan":
            return None
        amount = Decimal(amount_str) * Decimal(str(config.amount_multiplier))
    elif cols.debit and cols.credit:
        debit_str = str(row.get(cols.debit, "")).strip().replace(",", "").replace("$", "")
        credit_str = str(row.get(cols.credit, "")).strip().replace(",", "").replace("$", "")
        debit = Decimal(debit_str) if debit_str and debit_str != "nan" else Decimal("0")
        credit = Decimal(credit_str) if credit_str and credit_str != "nan" else Decimal("0")
        amount = credit - debit
    else:
        return None

    if config.sign_convention == "inverted":
        amount = -amount

    # Parse optional reference
    reference = None
    if cols.reference:
        ref_val = str(row.get(cols.reference, "")).strip()
        if ref_val and ref_val != "nan":
            reference = ref_val

    # Generate fingerprint
    fp = transaction_fingerprint(
        parsed_date.isoformat(),
        str(amount),
        description,
    )

    return RawTransaction(
        date=parsed_date,
        description=description,
        amount=amount,
        reference=reference,
        fingerprint=fp,
    )
