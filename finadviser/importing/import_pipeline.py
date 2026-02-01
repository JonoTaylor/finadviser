"""Orchestrates the full CSV import pipeline."""

from __future__ import annotations

import sqlite3
from decimal import Decimal
from pathlib import Path

from finadviser.config import AppConfig
from finadviser.db.models import (
    AccountType,
    BookEntry,
    ImportBatch,
    ImportResult,
    JournalEntry,
    RawTransaction,
    TransactionFingerprint,
)
from finadviser.db.repositories import (
    AccountRepo,
    FingerprintRepo,
    ImportBatchRepo,
    JournalRepo,
)
from finadviser.importing.bank_config import get_all_configs
from finadviser.importing.categorizer import RuleCategorizer
from finadviser.importing.csv_parser import parse_csv
from finadviser.importing.duplicate_detector import DuplicateDetector


class ImportPipeline:
    """Full import pipeline: parse -> dedupe -> categorize -> create journal entries."""

    def __init__(self, conn: sqlite3.Connection, config: AppConfig) -> None:
        self.conn = conn
        self.config = config
        self.account_repo = AccountRepo(conn)
        self.journal_repo = JournalRepo(conn)
        self.fp_repo = FingerprintRepo(conn)
        self.batch_repo = ImportBatchRepo(conn)
        self.dedup = DuplicateDetector(conn)
        self.categorizer = RuleCategorizer(conn)

    def run(
        self,
        csv_path: Path,
        bank_config_name: str,
        account_name: str,
    ) -> ImportResult:
        """Run the full import pipeline."""
        # Resolve bank config
        configs = get_all_configs(self.config.bank_configs_dir)
        if bank_config_name not in configs:
            raise ValueError(f"Unknown bank config: {bank_config_name}. Available: {list(configs.keys())}")
        bank_config = configs[bank_config_name]

        # Resolve or create account
        account = self.account_repo.get_or_create(account_name, AccountType.ASSET)

        # Step 1: Parse CSV
        transactions = parse_csv(csv_path, bank_config)

        # Step 2: Deduplicate
        transactions = self.dedup.check(transactions, account.id)

        # Step 3: Categorize
        transactions = self.categorizer.categorize(transactions)

        # Step 4: Create import batch
        batch = ImportBatch(
            filename=csv_path.name,
            bank_config=bank_config_name,
            account_id=account.id,
            row_count=len(transactions),
        )
        batch_id = self.batch_repo.create(batch)

        # Step 5: Create journal entries (all in one DB transaction)
        imported = 0
        duplicates = 0

        for txn in transactions:
            if txn.is_duplicate:
                duplicates += 1
                continue

            journal_id = self._create_journal_entry(txn, account.id, batch_id)

            # Record fingerprint for future dedup
            self.fp_repo.create(TransactionFingerprint(
                fingerprint=txn.fingerprint,
                account_id=account.id,
                journal_entry_id=journal_id,
            ))
            imported += 1

        # Update batch counts
        self.batch_repo.update_counts(batch_id, imported, duplicates)
        self.conn.commit()

        return ImportResult(
            batch_id=batch_id,
            imported_count=imported,
            duplicate_count=duplicates,
            total_count=len(transactions),
        )

    def preview(
        self,
        csv_path: Path,
        bank_config_name: str,
        account_name: str,
    ) -> list[RawTransaction]:
        """Preview import without writing to DB. Returns transactions with dupe flags."""
        configs = get_all_configs(self.config.bank_configs_dir)
        if bank_config_name not in configs:
            raise ValueError(f"Unknown bank config: {bank_config_name}")
        bank_config = configs[bank_config_name]

        account = self.account_repo.get_by_name(account_name)
        account_id = account.id if account else 0

        transactions = parse_csv(csv_path, bank_config)
        if account_id:
            transactions = self.dedup.check(transactions, account_id)
        transactions = self.categorizer.categorize(transactions)

        return transactions

    def _create_journal_entry(self, txn: RawTransaction, account_id: int, batch_id: int) -> int:
        """Create a balanced journal entry for a transaction.

        For income (positive amount): debit asset, credit income
        For expense (negative amount): debit expense, credit asset
        """
        journal = JournalEntry(
            date=txn.date,
            description=txn.description,
            reference=txn.reference,
            category_id=txn.suggested_category_id,
            import_batch_id=batch_id,
        )

        if txn.amount >= 0:
            # Income: money coming in
            income_account = self.account_repo.get_or_create("Uncategorized Income", AccountType.INCOME)
            entries = [
                BookEntry(journal_entry_id=0, account_id=account_id, amount=txn.amount),
                BookEntry(journal_entry_id=0, account_id=income_account.id, amount=-txn.amount),
            ]
        else:
            # Expense: money going out
            expense_account = self.account_repo.get_or_create("Uncategorized Expense", AccountType.EXPENSE)
            entries = [
                BookEntry(journal_entry_id=0, account_id=account_id, amount=txn.amount),
                BookEntry(journal_entry_id=0, account_id=expense_account.id, amount=-txn.amount),
            ]

        return self.journal_repo.create_entry(journal, entries)
