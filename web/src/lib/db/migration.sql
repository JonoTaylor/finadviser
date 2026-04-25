-- Schema additions (idempotent)
ALTER TABLE journal_entries
    ADD COLUMN IF NOT EXISTS property_id INTEGER REFERENCES properties(id);

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
WHERE a.account_type = 'EXPENSE'
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
