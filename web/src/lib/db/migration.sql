-- Schema additions (idempotent)
ALTER TABLE journal_entries
    ADD COLUMN IF NOT EXISTS property_id INTEGER REFERENCES properties(id);

-- Interest-only flag on mortgages. When true, principal is treated as
-- constant at original_amount for interest calculations (no
-- amortisation). Defaults false so existing rows keep their current
-- behaviour (manual principal/interest split on every payment).
ALTER TABLE mortgages
    ADD COLUMN IF NOT EXISTS interest_only BOOLEAN NOT NULL DEFAULT FALSE;

-- Investment tagging on accounts. is_investment splits market-value
-- assets (pension / S&S ISA / LISA / savings / crypto) from cash and
-- operational asset accounts. owner_id attributes an account to a
-- specific person; null means shared. investment_kind is a short
-- bucket label so the dashboard can group similar things together.
ALTER TABLE accounts
    ADD COLUMN IF NOT EXISTS is_investment BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE accounts
    ADD COLUMN IF NOT EXISTS investment_kind TEXT;
ALTER TABLE accounts
    ADD COLUMN IF NOT EXISTS owner_id INTEGER REFERENCES owners(id);

CREATE INDEX IF NOT EXISTS idx_accounts_owner_investment
    ON accounts(owner_id, is_investment) WHERE owner_id IS NOT NULL;

-- A protected EQUITY account that the "update investment balance"
-- flow uses as the contra side of each adjustment journal. Keeps
-- double-entry intact even though investment growth isn't realised
-- income — it flows through equity. is_system = true so the user
-- can't accidentally delete it from the chart of accounts.
--
-- ON CONFLICT updates ALL critical fields (account_type, is_system,
-- description) from EXCLUDED rather than just is_system — defends
-- against an existing row with the same name but a different type
-- (e.g. a user-created ASSET account they happened to call this)
-- silently being "system-locked" with the wrong type underneath.
INSERT INTO accounts (name, account_type, is_system, description)
VALUES ('Investment Adjustments', 'EQUITY', true, 'Contra account for investment-balance updates. Captures unrealised gain/loss on pension / ISA / etc as the value of those accounts is marked-to-market each month.')
ON CONFLICT (name) DO UPDATE SET
    account_type = EXCLUDED.account_type,
    is_system = EXCLUDED.is_system,
    description = EXCLUDED.description;

CREATE INDEX IF NOT EXISTS idx_journal_entries_property_date
    ON journal_entries(property_id, date)
    WHERE property_id IS NOT NULL;

-- book_entries is joined by account_id and journal_entry_id in every report
-- query (tax-year report, v_account_balances, v_property_equity) and in the
-- mortgage backfill below. Postgres doesn't create indexes for foreign keys
-- automatically, so add them explicitly.
CREATE INDEX IF NOT EXISTS idx_book_entries_account_id
    ON book_entries(account_id);
CREATE INDEX IF NOT EXISTS idx_book_entries_journal_entry_id
    ON book_entries(journal_entry_id);

-- Backfill property_id on any historical journal that touches a mortgage
-- liability account — this covers monthly payments, the initial loan
-- set-up entry, and any future balance adjustments, all of which belong
-- to the same property. The mortgage liability account is the only thing
-- that ties these legacy journals to a specific property. Self-limiting
-- and idempotent: candidates are journals that already join to a mortgage
-- AND still have NULL property_id, so subsequent deploys do effectively
-- nothing once backfilled.
UPDATE journal_entries je
   SET property_id = m.property_id
  FROM mortgages m
  JOIN book_entries be ON be.account_id = m.liability_account_id
 WHERE be.journal_entry_id = je.id
   AND je.property_id IS NULL;

DO $$ BEGIN
    CREATE TYPE rent_frequency AS ENUM ('monthly', 'weekly', 'four_weekly', 'quarterly', 'annual');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

CREATE TABLE IF NOT EXISTS tenancies (
    id SERIAL PRIMARY KEY,
    property_id INTEGER NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
    tenant_name TEXT NOT NULL,
    start_date TEXT NOT NULL,
    end_date TEXT,
    rent_amount NUMERIC(14,2) NOT NULL,
    rent_frequency rent_frequency NOT NULL DEFAULT 'monthly',
    deposit_amount NUMERIC(14,2),
    notes TEXT,
    created_at TIMESTAMP NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_tenancies_property_dates
    ON tenancies(property_id, start_date, end_date);

-- Generic key/value table for app-level settings the user can change at
-- runtime (currently: AI model selection on the Settings page). Keep
-- columns simple — TEXT values are enough for the small number of
-- settings we actually need.
CREATE TABLE IF NOT EXISTS app_settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at TIMESTAMP NOT NULL DEFAULT now()
);

-- Persistent facts injected into the assistant's system prompt so it
-- learns about the user across conversations. Source distinguishes
-- user-added entries from AI-saved ones (the `remember` tool).
DO $$ BEGIN
    CREATE TYPE ai_memory_source AS ENUM ('user', 'ai');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

CREATE TABLE IF NOT EXISTS ai_memories (
    id SERIAL PRIMARY KEY,
    content TEXT NOT NULL,
    source ai_memory_source NOT NULL DEFAULT 'ai',
    created_at TIMESTAMP NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ai_memories_created_at ON ai_memories(created_at DESC);

-- Per-transaction extras pulled from rich exports (Monzo's full CSV
-- being the motivating case). Optional 1:1 with journal_entries —
-- kept in a sidecar table rather than bloating the journal so legacy
-- importers stay simple. `raw` (jsonb) carries any column we didn't
-- promote to a typed field, so future banks don't require a schema
-- change to capture additional data.
CREATE TABLE IF NOT EXISTS transaction_metadata (
    id SERIAL PRIMARY KEY,
    journal_entry_id INTEGER NOT NULL UNIQUE REFERENCES journal_entries(id) ON DELETE CASCADE,
    external_id TEXT,
    transaction_time TEXT,
    transaction_type TEXT,
    merchant_name TEXT,
    merchant_emoji TEXT,
    bank_category TEXT,
    currency TEXT,
    local_amount TEXT,
    local_currency TEXT,
    notes TEXT,
    address TEXT,
    receipt_url TEXT,
    raw JSONB,
    created_at TIMESTAMP NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_transaction_metadata_external_id
    ON transaction_metadata(external_id) WHERE external_id IS NOT NULL;

-- Document storage. Holds the original binary (BYTEA) plus metadata for
-- AI-extracted source documents (currently tenancy agreements; the enum
-- leaves room for more). property_id / tenancy_id are nullable + ON
-- DELETE SET NULL so the document survives when its links go away.
DO $$ BEGIN
    CREATE TYPE document_kind AS ENUM ('tenancy_agreement', 'other');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

CREATE TABLE IF NOT EXISTS documents (
    id SERIAL PRIMARY KEY,
    kind document_kind NOT NULL,
    filename TEXT NOT NULL,
    mime_type TEXT NOT NULL,
    size_bytes INTEGER NOT NULL,
    sha256 TEXT NOT NULL UNIQUE,
    content BYTEA NOT NULL,
    property_id INTEGER REFERENCES properties(id) ON DELETE SET NULL,
    tenancy_id INTEGER REFERENCES tenancies(id) ON DELETE SET NULL,
    notes TEXT,
    uploaded_at TIMESTAMP NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_documents_property ON documents(property_id) WHERE property_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_documents_tenancy ON documents(tenancy_id) WHERE tenancy_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_documents_kind ON documents(kind);

-- Views
CREATE OR REPLACE VIEW v_account_balances AS
SELECT
    a.id AS account_id,
    a.name AS account_name,
    a.account_type,
    COALESCE(SUM(be.amount::numeric), 0) AS balance
FROM accounts a
LEFT JOIN book_entries be ON be.account_id = a.id
GROUP BY a.id, a.name, a.account_type;

CREATE OR REPLACE VIEW v_property_equity AS
SELECT
    p.id AS property_id,
    p.name AS property_name,
    o.id AS owner_id,
    o.name AS owner_name,
    po.capital_account_id,
    COALESCE(SUM(be.amount::numeric), 0) AS capital_balance
FROM properties p
JOIN property_ownership po ON po.property_id = p.id
JOIN owners o ON o.id = po.owner_id
LEFT JOIN book_entries be ON be.account_id = po.capital_account_id
GROUP BY p.id, p.name, o.id, o.name, po.capital_account_id;

CREATE OR REPLACE VIEW v_monthly_spending AS
SELECT
    to_char(je.date::date, 'YYYY-MM') AS month,
    c.name AS category_name,
    a.account_type,
    SUM(be.amount::numeric) AS total
FROM book_entries be
JOIN journal_entries je ON je.id = be.journal_entry_id
JOIN accounts a ON a.id = be.account_id
LEFT JOIN categories c ON c.id = je.category_id
WHERE a.account_type IN ('EXPENSE', 'INCOME')
GROUP BY to_char(je.date::date, 'YYYY-MM'), c.name, a.account_type
ORDER BY month DESC;

-- Balance enforcement trigger
CREATE OR REPLACE FUNCTION check_journal_balance() RETURNS TRIGGER AS $$
BEGIN
    IF (
        SELECT ROUND(SUM(amount::numeric), 2)
        FROM book_entries
        WHERE journal_entry_id = NEW.journal_entry_id
    ) != 0
    AND (
        SELECT COUNT(*)
        FROM book_entries
        WHERE journal_entry_id = NEW.journal_entry_id
    ) >= 2
    THEN
        RAISE EXCEPTION 'Journal entry book entries must sum to zero';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS check_journal_balance ON book_entries;
CREATE TRIGGER check_journal_balance
AFTER INSERT ON book_entries
FOR EACH ROW
EXECUTE FUNCTION check_journal_balance();

-- Default system accounts
INSERT INTO accounts (name, account_type, is_system, description)
VALUES
    ('Bank', 'ASSET', true, 'Default bank account'),
    ('Cash', 'ASSET', true, 'Cash on hand'),
    ('Uncategorized Income', 'INCOME', true, 'Default income account'),
    ('Uncategorized Expense', 'EXPENSE', true, 'Default expense account'),
    ('Mortgage Interest', 'EXPENSE', true, 'Mortgage interest paid (S.24 — basic-rate relief only, reported separately on tax-year report)'),
    ('Property Expenses', 'EXPENSE', true, 'Itemised property/BTL expenses (category provides the breakdown on the tax-year report)')
ON CONFLICT (name) DO UPDATE SET is_system = true;

-- ai_tips, budgets, savings_goals: tables that were declared in
-- schema.ts but never had a corresponding CREATE TABLE in this
-- migration file. Without them the AI's add_tip / set_budget /
-- set_savings_goal tools all 500 with `relation … does not exist`.
-- Idempotent — safe to run repeatedly even on databases that
-- already happen to have them.
--
-- Created BEFORE the category-dedup DO block below because that
-- block references `budgets` (re-pointing FKs from duplicate
-- categories). On a fresh database without `budgets`, the dedup
-- block would fail before reaching a CREATE TABLE placed at the
-- bottom of the file — so the tables have to come first.

DO $$ BEGIN
    CREATE TYPE tip_type AS ENUM ('tip', 'warning', 'insight');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

CREATE TABLE IF NOT EXISTS ai_tips (
    id SERIAL PRIMARY KEY,
    content TEXT NOT NULL,
    tip_type tip_type NOT NULL DEFAULT 'tip',
    priority INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMP NOT NULL DEFAULT now(),
    dismissed_at TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_ai_tips_active
    ON ai_tips(priority DESC, created_at DESC)
    WHERE dismissed_at IS NULL;

CREATE TABLE IF NOT EXISTS budgets (
    id SERIAL PRIMARY KEY,
    category_id INTEGER NOT NULL UNIQUE REFERENCES categories(id),
    monthly_limit TEXT NOT NULL,
    effective_from TEXT NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT now(),
    updated_at TIMESTAMP NOT NULL DEFAULT now()
);

DO $$ BEGIN
    CREATE TYPE savings_goal_status AS ENUM ('active', 'completed', 'cancelled');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

CREATE TABLE IF NOT EXISTS savings_goals (
    id SERIAL PRIMARY KEY,
    name TEXT NOT NULL,
    target_amount TEXT NOT NULL,
    current_amount TEXT NOT NULL DEFAULT '0',
    target_date TEXT,
    account_id INTEGER REFERENCES accounts(id),
    status savings_goal_status NOT NULL DEFAULT 'active',
    created_at TIMESTAMP NOT NULL DEFAULT now(),
    updated_at TIMESTAMP NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_savings_goals_status
    ON savings_goals(status);

-- One-shot cleanup of duplicate root categories accumulated by the
-- pre-PR-6 non-idempotent seed (Postgres ON CONFLICT didn't dedupe rows
-- where parent_id IS NULL). For each set of same-named root duplicates:
--   1. Pick the lowest id as the keeper.
--   2. For each duplicate-root's children, either re-parent to the keeper
--      (if no name-match exists yet) or re-point FK refs to the keeper's
--      same-named child and delete the duplicate-child.
--   3. Re-point any direct journal_entries / categorization_rules FKs
--      from the duplicate roots to the keeper.
--   4. Delete the duplicate roots.
-- Idempotent: once deduplicated, the outer SELECT returns no rows and the
-- DO block is a no-op.
DO $$
DECLARE
    dup_root RECORD;
    dup_child RECORD;
    keeper_root_id INTEGER;
    keeper_child_id INTEGER;
BEGIN
    FOR dup_root IN
        SELECT name,
               MIN(id) AS keeper_id,
               ARRAY_REMOVE(ARRAY_AGG(id ORDER BY id), MIN(id)) AS dup_ids
          FROM categories
         WHERE parent_id IS NULL
         GROUP BY name
        HAVING COUNT(*) > 1
    LOOP
        keeper_root_id := dup_root.keeper_id;

        FOR dup_child IN
            SELECT id, name
              FROM categories
             WHERE parent_id = ANY(dup_root.dup_ids)
        LOOP
            SELECT id INTO keeper_child_id
              FROM categories
             WHERE parent_id = keeper_root_id AND name = dup_child.name
             LIMIT 1;

            IF keeper_child_id IS NULL THEN
                -- Re-parent this child onto the keeper root; safe because
                -- (name, keeper_root_id) doesn't currently exist.
                UPDATE categories SET parent_id = keeper_root_id WHERE id = dup_child.id;
            ELSE
                -- Re-point all FK references from dup_child to keeper_child.
                UPDATE journal_entries SET category_id = keeper_child_id WHERE category_id = dup_child.id;
                UPDATE categorization_rules SET category_id = keeper_child_id WHERE category_id = dup_child.id;
                -- budgets.category_id is UNIQUE, so we can't just re-point if
                -- keeper_child already has a budget. Re-point if it's free,
                -- otherwise drop the duplicate's budget (keeper's wins —
                -- it's the budget the user set on the kept category).
                UPDATE budgets SET category_id = keeper_child_id
                 WHERE category_id = dup_child.id
                   AND NOT EXISTS (SELECT 1 FROM budgets WHERE category_id = keeper_child_id);
                DELETE FROM budgets WHERE category_id = dup_child.id;
                -- Re-parent any grandchildren onto keeper_child. The
                -- (name, parent_id) unique constraint will reject a
                -- collision and roll the migration back rather than create
                -- silent duplicates — that's the safe failure mode.
                UPDATE categories SET parent_id = keeper_child_id WHERE parent_id = dup_child.id;
                DELETE FROM categories WHERE id = dup_child.id;
            END IF;
        END LOOP;

        -- Re-point any root-level FK references from the duplicates to the
        -- keeper. budgets needs the same UNIQUE-aware treatment.
        UPDATE journal_entries
           SET category_id = keeper_root_id
         WHERE category_id = ANY(dup_root.dup_ids);
        UPDATE categorization_rules
           SET category_id = keeper_root_id
         WHERE category_id = ANY(dup_root.dup_ids);
        UPDATE budgets
           SET category_id = keeper_root_id
         WHERE category_id = ANY(dup_root.dup_ids)
           AND NOT EXISTS (SELECT 1 FROM budgets WHERE category_id = keeper_root_id);
        DELETE FROM budgets WHERE category_id = ANY(dup_root.dup_ids);
        DELETE FROM categories WHERE id = ANY(dup_root.dup_ids);
    END LOOP;
END $$;

-- Belt-and-braces: a partial unique index that prevents new duplicate
-- roots from being created even if some future code path bypasses the
-- NOT EXISTS seed. Safe to add only after the cleanup above runs.
CREATE UNIQUE INDEX IF NOT EXISTS unique_root_category_name
    ON categories(name)
    WHERE parent_id IS NULL;

-- Default top-level categories.
-- Note: the (name, parent_id) UNIQUE constraint on `categories` treats NULLs
-- as distinct (Postgres default), so ON CONFLICT (name, parent_id) doesn't
-- dedupe rows where parent_id IS NULL. We use INSERT ... SELECT ... WHERE
-- NOT EXISTS to make this seed truly idempotent across builds.
INSERT INTO categories (name, is_system)
SELECT v.name, true
  FROM (VALUES
    ('Groceries'),
    ('Dining'),
    ('Transport'),
    ('Utilities'),
    ('Rent/Mortgage'),
    ('Entertainment'),
    ('Healthcare'),
    ('Shopping'),
    ('Income'),
    ('Transfer'),
    ('Uncategorized'),
    ('Property expenses')
  ) AS v(name)
 WHERE NOT EXISTS (
   SELECT 1 FROM categories c
    WHERE c.name = v.name AND c.parent_id IS NULL
 );

-- Investment balance update primitive. Replaces a multi-CTE pattern
-- in TypeScript that the neon-http transport rejected with HTTP 400
-- when multiple data-modifying CTEs were combined with FK
-- relationships. The function does the same work imperatively in a
-- single procedural body, called from TS as a single SELECT, so the
-- transport sees one statement and Postgres handles the writes
-- sequentially without any CTE snapshot interplay.
--
-- Reads current balance, computes delta, inserts a journal entry and
-- two offsetting book_entries (subject + adjustment account), then
-- returns a single row of (journal_id, delta, previous_balance).
-- Atomic at the function level: either all three rows land or none
-- do. The journal-balance trigger still fires per book_entries
-- insert and validates double-entry as before.
CREATE OR REPLACE FUNCTION set_investment_balance(
    p_account_id     INTEGER,
    p_target_balance NUMERIC,
    p_as_of_date     TEXT,
    p_description    TEXT,
    p_adj_account_id INTEGER
) RETURNS TABLE (
    journal_id       INTEGER,
    delta            NUMERIC,
    previous_balance NUMERIC
) AS $$
DECLARE
    v_bal        NUMERIC;
    v_delta      NUMERIC;
    v_journal_id INTEGER;
BEGIN
    -- Serialize concurrent invocations on the same account. Without
    -- this lock, two concurrent set_investment_balance calls under
    -- READ COMMITTED would each read the same balance, compute the
    -- same delta, and write twice. The lock makes the read + write
    -- below logically atomic against other invocations of this
    -- function. Other unrelated write paths (CSV import, manual
    -- journals) don't take this lock, but they don't race with the
    -- balance read here in any way that matters: this function
    -- recomputes the live balance immediately after acquiring the
    -- lock, so anything those other paths landed will be picked up.
    PERFORM 1 FROM accounts WHERE id = p_account_id FOR UPDATE;

    SELECT COALESCE(SUM(amount::numeric), 0) INTO v_bal
      FROM book_entries
     WHERE account_id = p_account_id;

    v_delta := p_target_balance - v_bal;

    INSERT INTO journal_entries (date, description)
         VALUES (p_as_of_date, p_description)
      RETURNING id INTO v_journal_id;

    INSERT INTO book_entries (journal_entry_id, account_id, amount)
    VALUES
        (v_journal_id, p_account_id,     v_delta),
        (v_journal_id, p_adj_account_id, -v_delta);

    RETURN QUERY SELECT v_journal_id, v_delta, v_bal;
END;
$$ LANGUAGE plpgsql;

-- Bank-feed transaction ingest. Used by the daily-sync engine to
-- write one aggregator transaction into the journal model
-- atomically: a journal entry, two balanced book entries (subject
-- account + contra), and a transaction_metadata row. Wrapping it in
-- a Postgres function avoids the Drizzle/neon-http multi-statement
-- gap that bit set_investment_balance, and gives us atomicity that
-- the previous TS-side sequence couldn't (a partial failure between
-- INSERT INTO journal_entries and INSERT INTO book_entries would
-- have left an orphan journal with a provider_txn_id but no double
-- entry).
--
-- Idempotent: if the provider_txn_id is already on file, returns
-- the existing journal_id with was_inserted = false and skips the
-- side-effect inserts. The unique violation on insert is caught
-- inside the function rather than via ON CONFLICT, because the
-- partial UNIQUE INDEX (... WHERE provider_txn_id IS NOT NULL)
-- requires the same WHERE on ON CONFLICT and the matching syntax
-- is fiddly across Postgres versions.
CREATE OR REPLACE FUNCTION ingest_bank_transaction(
    p_provider_txn_id   TEXT,
    p_account_id        INTEGER,
    p_contra_account_id INTEGER,
    p_date              TEXT,
    p_description       TEXT,
    p_amount            NUMERIC,
    p_sync_run_id       INTEGER,
    p_external_id       TEXT,
    p_transaction_type  TEXT,
    p_merchant_name     TEXT,
    p_bank_category     TEXT,
    p_currency          TEXT,
    p_original_amount   NUMERIC,
    p_original_currency TEXT,
    p_fx_rate           NUMERIC,
    p_raw               JSONB
) RETURNS TABLE (
    journal_id   INTEGER,
    was_inserted BOOLEAN
) AS $$
DECLARE
    v_journal_id INTEGER;
BEGIN
    BEGIN
        INSERT INTO journal_entries (date, description, provider_txn_id, sync_run_id)
             VALUES (p_date, p_description, p_provider_txn_id, p_sync_run_id)
          RETURNING id INTO v_journal_id;
    EXCEPTION WHEN unique_violation THEN
        SELECT je.id INTO v_journal_id
          FROM journal_entries je
         WHERE je.provider_txn_id = p_provider_txn_id
         LIMIT 1;
        RETURN QUERY SELECT v_journal_id, false;
        RETURN;
    END;

    INSERT INTO book_entries (journal_entry_id, account_id, amount)
    VALUES
        (v_journal_id, p_account_id,        p_amount),
        (v_journal_id, p_contra_account_id, -p_amount);

    INSERT INTO transaction_metadata (
        journal_entry_id, external_id, transaction_type, merchant_name,
        bank_category, currency, original_amount, original_currency,
        fx_rate, raw
    )
    VALUES (
        v_journal_id, p_external_id, p_transaction_type, p_merchant_name,
        p_bank_category, p_currency, p_original_amount, p_original_currency,
        p_fx_rate, p_raw
    );

    RETURN QUERY SELECT v_journal_id, true;
END;
$$ LANGUAGE plpgsql;

-- Itemised UK BTL deductible expense categories (children of 'Property
-- expenses'). Mortgage interest is intentionally NOT seeded here: under
-- S.24 it's not an ordinary deductible expense and it's already isolated
-- as its own EXPENSE account ('Mortgage Interest') with is_system = true.
--
-- Pin to the lowest-id 'Property expenses' root so any historical NULL-
-- parent duplicates don't multiply the children. ON CONFLICT works for
-- children because their parent_id is non-null.
INSERT INTO categories (name, parent_id, is_system)
SELECT child.child_name, p.id, true
  FROM (VALUES
    ('Repairs & maintenance'),
    ('Letting agent fees'),
    ('Property insurance'),
    ('Ground rent / service charges'),
    ('Council tax (void periods)'),
    ('Utilities (void periods)'),
    ('Legal & professional fees'),
    ('Accountancy'),
    ('Advertising for tenants'),
    ('Travel for property management'),
    ('Other property expenses')
  ) AS child(child_name)
 CROSS JOIN (
   SELECT id FROM categories
    WHERE name = 'Property expenses' AND parent_id IS NULL
    ORDER BY id ASC LIMIT 1
 ) AS p
ON CONFLICT (name, parent_id) DO NOTHING;

-- Banking integration (Phase 1, PR A)
-- ------------------------------------
-- Provider catalogue. Seeded with the four banks the user wants
-- aggregated. `aggregator` records which third-party data provider
-- handles this bank (today only gocardless_bad; truelayer reserved as
-- a fallback). `slug` is what code references; `display_name` is what
-- the UI shows.
DO $$ BEGIN
    CREATE TYPE banking_aggregator AS ENUM ('gocardless_bad', 'truelayer');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

CREATE TABLE IF NOT EXISTS providers (
    id SERIAL PRIMARY KEY,
    slug TEXT NOT NULL UNIQUE,
    display_name TEXT NOT NULL,
    aggregator banking_aggregator NOT NULL DEFAULT 'gocardless_bad',
    created_at TIMESTAMP NOT NULL DEFAULT now()
);

INSERT INTO providers (slug, display_name)
VALUES
    ('monzo',     'Monzo'),
    ('barclays',  'Barclays'),
    ('amex_uk',   'American Express UK'),
    ('yonder',    'Yonder')
ON CONFLICT (slug) DO NOTHING;

-- Per-bank link state. One row per requisition / consent created with
-- the aggregator. consent_expires_at tracks the PSD2 90-day clock so
-- the daily cron in PR C can flip the status to `expiring` ahead of
-- the deadline.
--
-- aggregator_ref is the requisition ID (GoCardless BAD) or its
-- equivalent in another aggregator. Not a credential, just a handle.
--
-- encrypted_secret is reserved for future aggregator types that
-- require per-user OAuth refresh tokens (TrueLayer). NULL for
-- GoCardless BAD because that aggregator brokers the OAuth dance and
-- we authenticate with our own app-wide secret_id/secret_key instead.
DO $$ BEGIN
    CREATE TYPE connection_status AS ENUM ('pending', 'active', 'expiring', 'expired', 'revoked', 'error');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

CREATE TABLE IF NOT EXISTS connections (
    id SERIAL PRIMARY KEY,
    provider_id INTEGER NOT NULL REFERENCES providers(id),
    owner_id INTEGER REFERENCES owners(id),
    aggregator_ref TEXT NOT NULL UNIQUE,
    status connection_status NOT NULL DEFAULT 'pending',
    consent_expires_at TIMESTAMP,
    last_synced_at TIMESTAMP,
    last_error TEXT,
    encrypted_secret BYTEA,
    institution_id TEXT NOT NULL,
    institution_name TEXT NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT now(),
    updated_at TIMESTAMP NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_connections_status_expiry
    ON connections(status, consent_expires_at)
    WHERE status IN ('active', 'expiring');

-- Maps an aggregator-side account (Monzo joint vs. sole, etc.) to
-- one of our internal `accounts` rows. Set up on first-connect via
-- the account-mapping wizard. UNIQUE on aggregator_account_ref so a
-- given aggregator account binds to exactly one internal account.
CREATE TABLE IF NOT EXISTS provider_accounts (
    id SERIAL PRIMARY KEY,
    connection_id INTEGER NOT NULL REFERENCES connections(id) ON DELETE CASCADE,
    account_id INTEGER NOT NULL REFERENCES accounts(id),
    aggregator_account_ref TEXT NOT NULL UNIQUE,
    iban TEXT,
    currency TEXT NOT NULL DEFAULT 'GBP',
    product TEXT,
    cutover_date TEXT,
    created_at TIMESTAMP NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_provider_accounts_connection
    ON provider_accounts(connection_id);

-- Audit / observability for each cron tick. One row per
-- (connection, run) so a per-connection sync history can show what
-- happened, when, and why something failed.
DO $$ BEGIN
    CREATE TYPE sync_run_status AS ENUM ('running', 'success', 'partial', 'error');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

CREATE TABLE IF NOT EXISTS sync_runs (
    id SERIAL PRIMARY KEY,
    connection_id INTEGER NOT NULL REFERENCES connections(id) ON DELETE CASCADE,
    started_at TIMESTAMP NOT NULL DEFAULT now(),
    finished_at TIMESTAMP,
    status sync_run_status NOT NULL DEFAULT 'running',
    txns_added INTEGER NOT NULL DEFAULT 0,
    txns_updated INTEGER NOT NULL DEFAULT 0,
    error_message TEXT
);

CREATE INDEX IF NOT EXISTS idx_sync_runs_connection_started
    ON sync_runs(connection_id, started_at DESC);

-- journal_entries dedup primitive. Aggregator transaction IDs are
-- stable per provider, so a re-sync becomes naturally idempotent:
-- INSERT ... ON CONFLICT (provider_txn_id) DO UPDATE matches by ID
-- and updates only the fields that can legitimately change (status,
-- amount on pending->settled). Partial unique index so manual
-- entries (which have NULL provider_txn_id) are exempt.
ALTER TABLE journal_entries
    ADD COLUMN IF NOT EXISTS provider_txn_id TEXT;
ALTER TABLE journal_entries
    ADD COLUMN IF NOT EXISTS sync_run_id INTEGER REFERENCES sync_runs(id) ON DELETE SET NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_journal_entries_provider_txn_id
    ON journal_entries(provider_txn_id) WHERE provider_txn_id IS NOT NULL;

-- FX columns on transaction_metadata, for foreign-charged
-- transactions where the booking currency (typically GBP) differs
-- from what the user actually spent. `original_amount` and
-- `original_currency` preserve the foreign side; `fx_rate` is the
-- bank-applied rate at booking time. UI surfaces this inline (see
-- PR D).
ALTER TABLE transaction_metadata
    ADD COLUMN IF NOT EXISTS original_amount NUMERIC(14,2);
ALTER TABLE transaction_metadata
    ADD COLUMN IF NOT EXISTS original_currency TEXT;
ALTER TABLE transaction_metadata
    ADD COLUMN IF NOT EXISTS fx_rate NUMERIC(18,8);

-- The original spec for `original_currency` was CHAR(3); align it to
-- TEXT to match `transaction_metadata.currency` and the rest of the
-- codebase's currency columns. ALTER TYPE TEXT is a metadata-only
-- change and a no-op if already TEXT, so safe on every redeploy.
ALTER TABLE transaction_metadata
    ALTER COLUMN original_currency TYPE TEXT;

