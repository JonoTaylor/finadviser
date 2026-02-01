"""Repository classes for database operations."""

from __future__ import annotations

import sqlite3
from datetime import date
from decimal import Decimal

from finadviser.db.models import (
    Account,
    AccountBalance,
    AccountType,
    BookEntry,
    Category,
    CategorizationRule,
    ImportBatch,
    JournalEntry,
    OwnerEquity,
    TransactionFingerprint,
)


class AccountRepo:
    """Operations on the accounts table."""

    def __init__(self, conn: sqlite3.Connection) -> None:
        self.conn = conn

    def create(self, account: Account) -> int:
        cursor = self.conn.execute(
            "INSERT INTO accounts (name, account_type, parent_id, description, is_system) VALUES (?, ?, ?, ?, ?)",
            (account.name, account.account_type.value, account.parent_id, account.description, int(account.is_system)),
        )
        self.conn.commit()
        return cursor.lastrowid

    def get_by_id(self, account_id: int) -> Account | None:
        row = self.conn.execute("SELECT * FROM accounts WHERE id = ?", (account_id,)).fetchone()
        if row is None:
            return None
        return Account(**dict(row))

    def get_by_name(self, name: str) -> Account | None:
        row = self.conn.execute("SELECT * FROM accounts WHERE name = ?", (name,)).fetchone()
        if row is None:
            return None
        return Account(**dict(row))

    def get_or_create(self, name: str, account_type: AccountType, description: str | None = None) -> Account:
        existing = self.get_by_name(name)
        if existing:
            return existing
        account = Account(name=name, account_type=account_type, description=description)
        account.id = self.create(account)
        return account

    def list_all(self) -> list[Account]:
        rows = self.conn.execute("SELECT * FROM accounts ORDER BY account_type, name").fetchall()
        return [Account(**dict(r)) for r in rows]

    def list_by_type(self, account_type: AccountType) -> list[Account]:
        rows = self.conn.execute(
            "SELECT * FROM accounts WHERE account_type = ? ORDER BY name", (account_type.value,)
        ).fetchall()
        return [Account(**dict(r)) for r in rows]

    def get_balances(self) -> list[AccountBalance]:
        rows = self.conn.execute("SELECT * FROM v_account_balances").fetchall()
        return [AccountBalance(**dict(r)) for r in rows]

    def get_balance(self, account_id: int) -> Decimal:
        row = self.conn.execute(
            "SELECT COALESCE(SUM(amount), 0) AS balance FROM book_entries WHERE account_id = ?",
            (account_id,),
        ).fetchone()
        return Decimal(str(row["balance"]))


class JournalRepo:
    """Operations on journal_entries and book_entries with balance enforcement."""

    def __init__(self, conn: sqlite3.Connection) -> None:
        self.conn = conn

    def create_entry(
        self,
        journal: JournalEntry,
        entries: list[BookEntry],
    ) -> int:
        """Create a journal entry with its book entries.

        The SQLite trigger enforces that book entries sum to zero.
        We insert all entries in one transaction.
        """
        if not entries or len(entries) < 2:
            raise ValueError("A journal entry requires at least 2 book entries")

        total = sum(e.amount for e in entries)
        if round(float(total), 2) != 0:
            raise ValueError(f"Book entries must sum to zero, got {total}")

        cursor = self.conn.execute(
            "INSERT INTO journal_entries (date, description, reference, category_id, import_batch_id) VALUES (?, ?, ?, ?, ?)",
            (journal.date.isoformat(), journal.description, journal.reference, journal.category_id, journal.import_batch_id),
        )
        journal_id = cursor.lastrowid

        for entry in entries:
            self.conn.execute(
                "INSERT INTO book_entries (journal_entry_id, account_id, amount) VALUES (?, ?, ?)",
                (journal_id, entry.account_id, float(entry.amount)),
            )

        self.conn.commit()
        return journal_id

    def get_entry(self, journal_id: int) -> JournalEntry | None:
        row = self.conn.execute("SELECT * FROM journal_entries WHERE id = ?", (journal_id,)).fetchone()
        if row is None:
            return None
        return JournalEntry(**dict(row))

    def get_book_entries(self, journal_id: int) -> list[BookEntry]:
        rows = self.conn.execute(
            "SELECT * FROM book_entries WHERE journal_entry_id = ?", (journal_id,)
        ).fetchall()
        return [BookEntry(**dict(r)) for r in rows]

    def list_entries(
        self,
        start_date: date | None = None,
        end_date: date | None = None,
        category_id: int | None = None,
        account_id: int | None = None,
        limit: int = 100,
        offset: int = 0,
    ) -> list[dict]:
        """List journal entries with their associated book entries, filtered."""
        query = """
            SELECT je.id, je.date, je.description, je.reference, je.category_id,
                   c.name AS category_name,
                   GROUP_CONCAT(a.name || ':' || be.amount, '|') AS entries_summary
            FROM journal_entries je
            LEFT JOIN categories c ON c.id = je.category_id
            LEFT JOIN book_entries be ON be.journal_entry_id = je.id
            LEFT JOIN accounts a ON a.id = be.account_id
            WHERE 1=1
        """
        params: list = []

        if start_date:
            query += " AND je.date >= ?"
            params.append(start_date.isoformat())
        if end_date:
            query += " AND je.date <= ?"
            params.append(end_date.isoformat())
        if category_id is not None:
            query += " AND je.category_id = ?"
            params.append(category_id)
        if account_id is not None:
            query += " AND je.id IN (SELECT journal_entry_id FROM book_entries WHERE account_id = ?)"
            params.append(account_id)

        query += " GROUP BY je.id ORDER BY je.date DESC, je.id DESC LIMIT ? OFFSET ?"
        params.extend([limit, offset])

        rows = self.conn.execute(query, params).fetchall()
        return [dict(r) for r in rows]

    def update_category(self, journal_id: int, category_id: int) -> None:
        self.conn.execute(
            "UPDATE journal_entries SET category_id = ? WHERE id = ?",
            (category_id, journal_id),
        )
        self.conn.commit()

    def get_monthly_spending(self) -> list[dict]:
        rows = self.conn.execute("SELECT * FROM v_monthly_spending").fetchall()
        return [dict(r) for r in rows]

    def search(self, query: str, limit: int = 50) -> list[dict]:
        rows = self.conn.execute(
            """SELECT je.id, je.date, je.description, je.category_id, c.name AS category_name,
                      GROUP_CONCAT(a.name || ':' || be.amount, '|') AS entries_summary
               FROM journal_entries je
               LEFT JOIN categories c ON c.id = je.category_id
               LEFT JOIN book_entries be ON be.journal_entry_id = je.id
               LEFT JOIN accounts a ON a.id = be.account_id
               WHERE je.description LIKE ?
               GROUP BY je.id
               ORDER BY je.date DESC
               LIMIT ?""",
            (f"%{query}%", limit),
        ).fetchall()
        return [dict(r) for r in rows]


class CategoryRepo:
    """Operations on categories and categorization rules."""

    def __init__(self, conn: sqlite3.Connection) -> None:
        self.conn = conn

    def create(self, category: Category) -> int:
        cursor = self.conn.execute(
            "INSERT INTO categories (name, parent_id, is_system) VALUES (?, ?, ?)",
            (category.name, category.parent_id, int(category.is_system)),
        )
        self.conn.commit()
        return cursor.lastrowid

    def get_by_id(self, category_id: int) -> Category | None:
        row = self.conn.execute("SELECT * FROM categories WHERE id = ?", (category_id,)).fetchone()
        if row is None:
            return None
        return Category(**dict(row))

    def get_by_name(self, name: str) -> Category | None:
        row = self.conn.execute("SELECT * FROM categories WHERE name = ?", (name,)).fetchone()
        if row is None:
            return None
        return Category(**dict(row))

    def list_all(self) -> list[Category]:
        rows = self.conn.execute("SELECT * FROM categories ORDER BY name").fetchall()
        return [Category(**dict(r)) for r in rows]

    def add_rule(self, rule: CategorizationRule) -> int:
        cursor = self.conn.execute(
            "INSERT INTO categorization_rules (pattern, category_id, match_type, priority, source) VALUES (?, ?, ?, ?, ?)",
            (rule.pattern, rule.category_id, rule.match_type.value, rule.priority, rule.source.value),
        )
        self.conn.commit()
        return cursor.lastrowid

    def get_rules(self) -> list[CategorizationRule]:
        rows = self.conn.execute(
            "SELECT * FROM categorization_rules ORDER BY priority DESC, id"
        ).fetchall()
        return [CategorizationRule(**dict(r)) for r in rows]


class FingerprintRepo:
    """Operations on transaction fingerprints for dedup."""

    def __init__(self, conn: sqlite3.Connection) -> None:
        self.conn = conn

    def exists(self, fingerprint: str, account_id: int) -> bool:
        row = self.conn.execute(
            "SELECT 1 FROM transaction_fingerprints WHERE fingerprint = ? AND account_id = ?",
            (fingerprint, account_id),
        ).fetchone()
        return row is not None

    def create(self, fp: TransactionFingerprint) -> int:
        cursor = self.conn.execute(
            "INSERT INTO transaction_fingerprints (fingerprint, account_id, journal_entry_id) VALUES (?, ?, ?)",
            (fp.fingerprint, fp.account_id, fp.journal_entry_id),
        )
        return cursor.lastrowid


class ImportBatchRepo:
    """Operations on import batches."""

    def __init__(self, conn: sqlite3.Connection) -> None:
        self.conn = conn

    def create(self, batch: ImportBatch) -> int:
        cursor = self.conn.execute(
            "INSERT INTO import_batches (filename, bank_config, account_id, row_count, imported_count, duplicate_count) VALUES (?, ?, ?, ?, ?, ?)",
            (batch.filename, batch.bank_config, batch.account_id, batch.row_count, batch.imported_count, batch.duplicate_count),
        )
        self.conn.commit()
        return cursor.lastrowid

    def update_counts(self, batch_id: int, imported: int, duplicates: int) -> None:
        self.conn.execute(
            "UPDATE import_batches SET imported_count = ?, duplicate_count = ? WHERE id = ?",
            (imported, duplicates, batch_id),
        )
        self.conn.commit()

    def list_all(self) -> list[ImportBatch]:
        rows = self.conn.execute("SELECT * FROM import_batches ORDER BY imported_at DESC").fetchall()
        return [ImportBatch(**dict(r)) for r in rows]


class PropertyRepo:
    """Operations on properties, owners, valuations, mortgages."""

    def __init__(self, conn: sqlite3.Connection) -> None:
        self.conn = conn

    def create_property(self, prop: dict) -> int:
        cursor = self.conn.execute(
            "INSERT INTO properties (name, address, purchase_date, purchase_price) VALUES (?, ?, ?, ?)",
            (prop["name"], prop.get("address"), prop.get("purchase_date"), prop.get("purchase_price")),
        )
        self.conn.commit()
        return cursor.lastrowid

    def get_property(self, property_id: int) -> dict | None:
        row = self.conn.execute("SELECT * FROM properties WHERE id = ?", (property_id,)).fetchone()
        return dict(row) if row else None

    def list_properties(self) -> list[dict]:
        rows = self.conn.execute("SELECT * FROM properties ORDER BY name").fetchall()
        return [dict(r) for r in rows]

    def create_owner(self, name: str) -> int:
        cursor = self.conn.execute("INSERT OR IGNORE INTO owners (name) VALUES (?)", (name,))
        self.conn.commit()
        if cursor.lastrowid:
            return cursor.lastrowid
        row = self.conn.execute("SELECT id FROM owners WHERE name = ?", (name,)).fetchone()
        return row["id"]

    def get_owner(self, owner_id: int) -> dict | None:
        row = self.conn.execute("SELECT * FROM owners WHERE id = ?", (owner_id,)).fetchone()
        return dict(row) if row else None

    def list_owners(self) -> list[dict]:
        rows = self.conn.execute("SELECT * FROM owners ORDER BY name").fetchall()
        return [dict(r) for r in rows]

    def add_ownership(self, property_id: int, owner_id: int, capital_account_id: int) -> int:
        cursor = self.conn.execute(
            "INSERT INTO property_ownership (property_id, owner_id, capital_account_id) VALUES (?, ?, ?)",
            (property_id, owner_id, capital_account_id),
        )
        self.conn.commit()
        return cursor.lastrowid

    def get_ownership(self, property_id: int) -> list[dict]:
        rows = self.conn.execute(
            """SELECT po.*, o.name AS owner_name, a.name AS account_name
               FROM property_ownership po
               JOIN owners o ON o.id = po.owner_id
               JOIN accounts a ON a.id = po.capital_account_id
               WHERE po.property_id = ?""",
            (property_id,),
        ).fetchall()
        return [dict(r) for r in rows]

    def add_valuation(self, property_id: int, valuation: float, valuation_date: str, source: str = "manual") -> int:
        cursor = self.conn.execute(
            "INSERT INTO property_valuations (property_id, valuation, valuation_date, source) VALUES (?, ?, ?, ?)",
            (property_id, valuation, valuation_date, source),
        )
        self.conn.commit()
        return cursor.lastrowid

    def get_latest_valuation(self, property_id: int) -> dict | None:
        row = self.conn.execute(
            "SELECT * FROM property_valuations WHERE property_id = ? ORDER BY valuation_date DESC LIMIT 1",
            (property_id,),
        ).fetchone()
        return dict(row) if row else None

    def get_valuations(self, property_id: int) -> list[dict]:
        rows = self.conn.execute(
            "SELECT * FROM property_valuations WHERE property_id = ? ORDER BY valuation_date DESC",
            (property_id,),
        ).fetchall()
        return [dict(r) for r in rows]

    def create_mortgage(self, mortgage: dict) -> int:
        cursor = self.conn.execute(
            """INSERT INTO mortgages (property_id, lender, original_amount, start_date, term_months, liability_account_id)
               VALUES (?, ?, ?, ?, ?, ?)""",
            (mortgage["property_id"], mortgage["lender"], mortgage["original_amount"],
             mortgage["start_date"], mortgage["term_months"], mortgage["liability_account_id"]),
        )
        self.conn.commit()
        return cursor.lastrowid

    def get_mortgages(self, property_id: int) -> list[dict]:
        rows = self.conn.execute(
            "SELECT * FROM mortgages WHERE property_id = ? ORDER BY start_date", (property_id,)
        ).fetchall()
        return [dict(r) for r in rows]

    def add_mortgage_rate(self, mortgage_id: int, rate: float, effective_date: str) -> int:
        cursor = self.conn.execute(
            "INSERT INTO mortgage_rate_history (mortgage_id, rate, effective_date) VALUES (?, ?, ?)",
            (mortgage_id, rate, effective_date),
        )
        self.conn.commit()
        return cursor.lastrowid

    def get_mortgage_balance(self, mortgage_id: int) -> Decimal:
        """Derive mortgage balance from the liability account's book entries."""
        row = self.conn.execute(
            """SELECT COALESCE(SUM(be.amount), 0) AS balance
               FROM book_entries be
               JOIN mortgages m ON m.liability_account_id = be.account_id
               WHERE m.id = ?""",
            (mortgage_id,),
        ).fetchone()
        return Decimal(str(row["balance"]))

    def get_equity_view(self, property_id: int) -> list[OwnerEquity]:
        rows = self.conn.execute(
            "SELECT * FROM v_property_equity WHERE property_id = ?", (property_id,)
        ).fetchall()
        return [OwnerEquity(**dict(r)) for r in rows]

    def get_allocation_rules(self, property_id: int) -> list[dict]:
        rows = self.conn.execute(
            "SELECT * FROM expense_allocation_rules WHERE property_id = ?", (property_id,)
        ).fetchall()
        return [dict(r) for r in rows]

    def set_allocation_rule(self, property_id: int, owner_id: int, pct: float, expense_type: str = "all") -> None:
        self.conn.execute(
            """INSERT INTO expense_allocation_rules (property_id, owner_id, allocation_pct, expense_type)
               VALUES (?, ?, ?, ?)
               ON CONFLICT(property_id, owner_id, expense_type) DO UPDATE SET allocation_pct = excluded.allocation_pct""",
            (property_id, owner_id, pct, expense_type),
        )
        self.conn.commit()


class ConversationRepo:
    """Operations on AI conversations and messages."""

    def __init__(self, conn: sqlite3.Connection) -> None:
        self.conn = conn

    def create_conversation(self, title: str | None = None) -> int:
        cursor = self.conn.execute(
            "INSERT INTO ai_conversations (title) VALUES (?)", (title,)
        )
        self.conn.commit()
        return cursor.lastrowid

    def add_message(self, conversation_id: int, role: str, content: str) -> int:
        cursor = self.conn.execute(
            "INSERT INTO ai_messages (conversation_id, role, content) VALUES (?, ?, ?)",
            (conversation_id, role, content),
        )
        self.conn.execute(
            "UPDATE ai_conversations SET updated_at = datetime('now') WHERE id = ?",
            (conversation_id,),
        )
        self.conn.commit()
        return cursor.lastrowid

    def get_messages(self, conversation_id: int) -> list[dict]:
        rows = self.conn.execute(
            "SELECT * FROM ai_messages WHERE conversation_id = ? ORDER BY id",
            (conversation_id,),
        ).fetchall()
        return [dict(r) for r in rows]

    def list_conversations(self) -> list[dict]:
        rows = self.conn.execute(
            "SELECT * FROM ai_conversations ORDER BY updated_at DESC"
        ).fetchall()
        return [dict(r) for r in rows]
