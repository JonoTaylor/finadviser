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
    ('Uncategorized Expense', 'EXPENSE', true, 'Default expense account')
ON CONFLICT (name) DO NOTHING;

-- Default categories
INSERT INTO categories (name, is_system)
VALUES
    ('Groceries', true),
    ('Dining', true),
    ('Transport', true),
    ('Utilities', true),
    ('Rent/Mortgage', true),
    ('Entertainment', true),
    ('Healthcare', true),
    ('Shopping', true),
    ('Income', true),
    ('Transfer', true),
    ('Uncategorized', true)
ON CONFLICT (name, parent_id) DO NOTHING;
