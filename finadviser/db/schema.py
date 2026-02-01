"""SQLite schema definition for finadviser."""

SCHEMA_SQL = """
-- Chart of accounts
CREATE TABLE IF NOT EXISTS accounts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    account_type TEXT NOT NULL CHECK (account_type IN ('ASSET', 'LIABILITY', 'EQUITY', 'INCOME', 'EXPENSE')),
    parent_id INTEGER REFERENCES accounts(id),
    description TEXT,
    is_system INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Hierarchical categories for transaction classification
CREATE TABLE IF NOT EXISTS categories (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    parent_id INTEGER REFERENCES categories(id),
    is_system INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(name, parent_id)
);

-- Pattern-based auto-categorization rules
CREATE TABLE IF NOT EXISTS categorization_rules (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    pattern TEXT NOT NULL,
    category_id INTEGER NOT NULL REFERENCES categories(id),
    match_type TEXT NOT NULL DEFAULT 'contains' CHECK (match_type IN ('contains', 'startswith', 'exact', 'regex')),
    priority INTEGER NOT NULL DEFAULT 0,
    source TEXT NOT NULL DEFAULT 'user' CHECK (source IN ('user', 'ai', 'system')),
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Journal entries: the header for a group of balanced book entries
CREATE TABLE IF NOT EXISTS journal_entries (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    date TEXT NOT NULL,
    description TEXT NOT NULL,
    reference TEXT,
    category_id INTEGER REFERENCES categories(id),
    import_batch_id INTEGER REFERENCES import_batches(id),
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Book entries: individual debit/credit lines (double-entry)
CREATE TABLE IF NOT EXISTS book_entries (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    journal_entry_id INTEGER NOT NULL REFERENCES journal_entries(id) ON DELETE CASCADE,
    account_id INTEGER NOT NULL REFERENCES accounts(id),
    amount REAL NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Import tracking
CREATE TABLE IF NOT EXISTS import_batches (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    filename TEXT NOT NULL,
    bank_config TEXT NOT NULL,
    account_id INTEGER NOT NULL REFERENCES accounts(id),
    row_count INTEGER NOT NULL DEFAULT 0,
    imported_count INTEGER NOT NULL DEFAULT 0,
    duplicate_count INTEGER NOT NULL DEFAULT 0,
    imported_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Transaction fingerprints for dedup
CREATE TABLE IF NOT EXISTS transaction_fingerprints (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    fingerprint TEXT NOT NULL,
    account_id INTEGER NOT NULL REFERENCES accounts(id),
    journal_entry_id INTEGER NOT NULL REFERENCES journal_entries(id),
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(fingerprint, account_id)
);

-- Properties (real estate)
CREATE TABLE IF NOT EXISTS properties (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    address TEXT,
    purchase_date TEXT,
    purchase_price REAL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Property owners
CREATE TABLE IF NOT EXISTS owners (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Property ownership: links owners to properties with capital accounts
CREATE TABLE IF NOT EXISTS property_ownership (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    property_id INTEGER NOT NULL REFERENCES properties(id),
    owner_id INTEGER NOT NULL REFERENCES owners(id),
    capital_account_id INTEGER NOT NULL REFERENCES accounts(id),
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(property_id, owner_id)
);

-- Mortgages
CREATE TABLE IF NOT EXISTS mortgages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    property_id INTEGER NOT NULL REFERENCES properties(id),
    lender TEXT NOT NULL,
    original_amount REAL NOT NULL,
    start_date TEXT NOT NULL,
    term_months INTEGER NOT NULL,
    liability_account_id INTEGER NOT NULL REFERENCES accounts(id),
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Mortgage rate history
CREATE TABLE IF NOT EXISTS mortgage_rate_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    mortgage_id INTEGER NOT NULL REFERENCES mortgages(id),
    rate REAL NOT NULL,
    effective_date TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Property valuations
CREATE TABLE IF NOT EXISTS property_valuations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    property_id INTEGER NOT NULL REFERENCES properties(id),
    valuation REAL NOT NULL,
    valuation_date TEXT NOT NULL,
    source TEXT DEFAULT 'manual',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Equity snapshots (optional performance cache)
CREATE TABLE IF NOT EXISTS equity_snapshots (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    property_id INTEGER NOT NULL REFERENCES properties(id),
    owner_id INTEGER NOT NULL REFERENCES owners(id),
    snapshot_date TEXT NOT NULL,
    equity_amount REAL NOT NULL,
    equity_percentage REAL NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Property transfers (cross-property equity movements)
CREATE TABLE IF NOT EXISTS property_transfers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    from_property_id INTEGER NOT NULL REFERENCES properties(id),
    to_property_id INTEGER NOT NULL REFERENCES properties(id),
    owner_id INTEGER NOT NULL REFERENCES owners(id),
    amount REAL NOT NULL,
    journal_entry_id INTEGER NOT NULL REFERENCES journal_entries(id),
    transfer_date TEXT NOT NULL,
    description TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Expense allocation rules (how property costs split between owners)
CREATE TABLE IF NOT EXISTS expense_allocation_rules (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    property_id INTEGER NOT NULL REFERENCES properties(id),
    owner_id INTEGER NOT NULL REFERENCES owners(id),
    allocation_pct REAL NOT NULL CHECK (allocation_pct >= 0 AND allocation_pct <= 100),
    expense_type TEXT NOT NULL DEFAULT 'all',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(property_id, owner_id, expense_type)
);

-- AI conversation history
CREATE TABLE IF NOT EXISTS ai_conversations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- AI messages
CREATE TABLE IF NOT EXISTS ai_messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    conversation_id INTEGER NOT NULL REFERENCES ai_conversations(id) ON DELETE CASCADE,
    role TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'system')),
    content TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Views

CREATE VIEW IF NOT EXISTS v_account_balances AS
SELECT
    a.id AS account_id,
    a.name AS account_name,
    a.account_type,
    COALESCE(SUM(be.amount), 0) AS balance
FROM accounts a
LEFT JOIN book_entries be ON be.account_id = a.id
GROUP BY a.id, a.name, a.account_type;

CREATE VIEW IF NOT EXISTS v_property_equity AS
SELECT
    p.id AS property_id,
    p.name AS property_name,
    o.id AS owner_id,
    o.name AS owner_name,
    po.capital_account_id,
    COALESCE(SUM(be.amount), 0) AS capital_balance
FROM properties p
JOIN property_ownership po ON po.property_id = p.id
JOIN owners o ON o.id = po.owner_id
LEFT JOIN book_entries be ON be.account_id = po.capital_account_id
GROUP BY p.id, p.name, o.id, o.name, po.capital_account_id;

CREATE VIEW IF NOT EXISTS v_monthly_spending AS
SELECT
    strftime('%Y-%m', je.date) AS month,
    c.name AS category_name,
    a.account_type,
    SUM(be.amount) AS total
FROM book_entries be
JOIN journal_entries je ON je.id = be.journal_entry_id
JOIN accounts a ON a.id = be.account_id
LEFT JOIN categories c ON c.id = je.category_id
WHERE a.account_type = 'EXPENSE'
GROUP BY month, c.name, a.account_type
ORDER BY month DESC;

-- Trigger: enforce balanced journal entries
CREATE TRIGGER IF NOT EXISTS check_journal_balance
AFTER INSERT ON book_entries
BEGIN
    SELECT CASE
        WHEN (
            SELECT ROUND(SUM(amount), 2)
            FROM book_entries
            WHERE journal_entry_id = NEW.journal_entry_id
        ) != 0
        AND (
            SELECT COUNT(*)
            FROM book_entries
            WHERE journal_entry_id = NEW.journal_entry_id
        ) >= 2
        THEN RAISE(ABORT, 'Journal entry book entries must sum to zero')
    END;
END;

-- Default system accounts
INSERT OR IGNORE INTO accounts (name, account_type, is_system, description) VALUES
    ('Bank', 'ASSET', 1, 'Default bank account'),
    ('Cash', 'ASSET', 1, 'Cash on hand'),
    ('Uncategorized Income', 'INCOME', 1, 'Default income account'),
    ('Uncategorized Expense', 'EXPENSE', 1, 'Default expense account');

-- Default categories
INSERT OR IGNORE INTO categories (name, is_system) VALUES
    ('Groceries', 1),
    ('Dining', 1),
    ('Transport', 1),
    ('Utilities', 1),
    ('Rent/Mortgage', 1),
    ('Entertainment', 1),
    ('Healthcare', 1),
    ('Shopping', 1),
    ('Income', 1),
    ('Transfer', 1),
    ('Uncategorized', 1);
"""
