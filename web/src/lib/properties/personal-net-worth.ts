import Decimal from 'decimal.js';
import { sql } from 'drizzle-orm';
import { getDb } from '@/lib/db';
import { propertyRepo } from '@/lib/repos';
import { calculateEquity } from './equity-calculator';

/**
 * "Your share" net worth — owner-scoped instead of household-aggregate.
 *
 * Three buckets per owner:
 *  - Property equity: their slice of (market value − mortgage debt)
 *    across every property they own a share of, via the existing
 *    calculateEquity() (already mortgage-netted).
 *  - Investments: ASSET accounts flagged is_investment=true and tagged
 *    owner_id = $owner. Pensions, ISAs, etc.
 *  - Personal cash: ASSET accounts NOT flagged is_investment, tagged
 *    owner_id = $owner. Untagged shared cash is shown separately so
 *    the user can decide whether to attribute it.
 *
 * Liabilities are picked up via the property-equity calc (the only
 * tracked liability today is mortgages, and they're netted there).
 * Standalone owner-tagged liability accounts would need separate
 * handling — out of scope for this first cut, no such accounts exist.
 */

export interface PersonalNetWorth {
  ownerId: number;
  ownerName: string;
  propertyEquity: string;       // total across properties for this owner
  investments: string;          // total of is_investment accounts owned by this owner
  personalCash: string;         // total of NON-investment ASSET accounts owned by this owner
  total: string;                // sum of the above
  // For context — shows the user what's NOT included in `total`:
  sharedCashUnattributed: string; // ASSET accounts with owner_id IS NULL and is_investment = false
  perProperty: Array<{
    propertyId: number;
    propertyName: string;
    equityPct: number;
    equityAmount: string;
  }>;
  perInvestment: Array<{
    accountId: number;
    name: string;
    investmentKind: string | null;
    balance: string;
  }>;
}

export async function calculatePersonalNetWorth(ownerId: number): Promise<PersonalNetWorth | null> {
  const owner = await propertyRepo.getOwner(ownerId);
  if (!owner) return null;

  const db = getDb();

  // Property equity. Fetch the property list ONCE and run
  // calculateEquity per property in parallel — calculateAllEquity
  // would re-fetch listProperties internally, doubling the
  // round-trip on every dashboard load.
  const properties = await propertyRepo.listProperties();
  const equitySlices = await Promise.all(properties.map(p => calculateEquity(p.id)));

  let propertyEquity = new Decimal(0);
  const perProperty: PersonalNetWorth['perProperty'] = [];
  for (let i = 0; i < properties.length; i++) {
    const property = properties[i];
    const ownersForProperty = equitySlices[i];
    const slice = ownersForProperty.find(o => o.ownerId === ownerId);
    if (!slice) continue;
    propertyEquity = propertyEquity.plus(slice.equityAmount);
    perProperty.push({
      propertyId: property.id,
      propertyName: property.name,
      equityPct: slice.equityPct,
      equityAmount: slice.equityAmount.toFixed(2),
    });
  }

  // Investments + personal cash + shared unattributed cash. Single
  // round-trip via v_account_balances (single source of truth for
  // balance arithmetic — don't re-implement SUM(book_entries) here).
  // Filtered to ASSET type and to rows the user could care about for
  // a personal-net-worth calc: their own accounts plus any shared
  // (owner_id IS NULL) accounts so we can report the sharedCashUnattributed
  // diagnostic.
  const accountRows = await db.execute(sql`
    SELECT a.id, a.name, a.is_investment, a.investment_kind, a.owner_id,
           COALESCE(v.balance, 0) AS balance
    FROM accounts a
    LEFT JOIN v_account_balances v ON v.account_id = a.id
    WHERE a.account_type = 'ASSET'
      AND (a.owner_id = ${ownerId} OR a.owner_id IS NULL)
  `);

  let investments = new Decimal(0);
  let personalCash = new Decimal(0);
  let sharedCashUnattributed = new Decimal(0);
  const perInvestment: PersonalNetWorth['perInvestment'] = [];

  for (const r of accountRows.rows) {
    const balance = new Decimal((r.balance as string) ?? '0');
    const accOwner = r.owner_id as number | null;
    const isInvestment = Boolean(r.is_investment);
    if (isInvestment && accOwner === ownerId) {
      investments = investments.plus(balance);
      perInvestment.push({
        accountId: r.id as number,
        name: r.name as string,
        investmentKind: (r.investment_kind as string | null) ?? null,
        balance: balance.toFixed(2),
      });
      continue;
    }
    if (!isInvestment && accOwner === ownerId) {
      personalCash = personalCash.plus(balance);
      continue;
    }
    if (!isInvestment && accOwner === null) {
      sharedCashUnattributed = sharedCashUnattributed.plus(balance);
      continue;
    }
  }

  const total = propertyEquity.plus(investments).plus(personalCash);

  return {
    ownerId,
    ownerName: owner.name,
    propertyEquity: propertyEquity.toFixed(2),
    investments: investments.toFixed(2),
    personalCash: personalCash.toFixed(2),
    total: total.toFixed(2),
    sharedCashUnattributed: sharedCashUnattributed.toFixed(2),
    perProperty,
    perInvestment: perInvestment.sort((a, b) => Number(b.balance) - Number(a.balance)),
  };
}

/**
 * Adjust an investment account's balance to a new target value via a
 * journal entry — DR/CR the investment account and CR/DR the system
 * "Investment Adjustments" equity account by the delta — so:
 *   - the existing v_account_balances view picks the new balance up
 *     immediately,
 *   - the historical record of value changes is preserved as journals
 *     (so we can derive month-over-month deltas later without a
 *     separate snapshot table),
 *   - double-entry stays balanced (the journal-balance trigger
 *     enforces this).
 *
 * The "Investment Adjustments" EQUITY account is seeded by
 * migration.sql so this never has to create it on the fly.
 *
 * Concurrency: the read-balance-then-write-delta is split across two
 * statements (the Neon HTTP driver doesn't expose multi-statement
 * transactions). The validation read is just a safety check; the
 * actual delta is computed INSIDE the second SQL statement using a
 * CTE that re-reads the live balance, so two concurrent updates
 * don't both compute against the same stale snapshot. Worst case
 * concurrent updates from the same user race for "last write wins"
 * on the latest delta — acceptable for a single-household app, and
 * the trigger keeps each entry self-consistent.
 */
export async function setInvestmentBalance(params: {
  accountId: number;
  newBalance: string;
  asOfDate: string; // YYYY-MM-DD
  description?: string;
}): Promise<{ journalId: number; delta: string; previousBalance: string }> {
  const db = getDb();

  // Validate target account + look up the seeded adjustment account
  // in a single query.
  const validation = await db.execute(sql`
    SELECT
      a.id, a.name, a.account_type, a.is_investment,
      (SELECT id FROM accounts WHERE name = 'Investment Adjustments' AND is_system = true LIMIT 1) AS adj_account_id
    FROM accounts a
    WHERE a.id = ${params.accountId}
    LIMIT 1
  `);
  if (validation.rows.length === 0) throw new Error(`Account ${params.accountId} not found`);
  const acct = validation.rows[0];
  if (!acct.is_investment) {
    throw new Error(`Account ${params.accountId} (${acct.name}) is not flagged as an investment.`);
  }
  if (acct.account_type !== 'ASSET') {
    throw new Error(`Investment accounts must be ASSET type; ${acct.name} is ${acct.account_type}.`);
  }
  const adjAccountId = acct.adj_account_id as number | null;
  if (adjAccountId === null) {
    throw new Error('System "Investment Adjustments" equity account is missing — re-run the database migration.');
  }

  const description = params.description ?? `Investment balance update — ${acct.name}`;
  const targetBalance = new Decimal(params.newBalance).toFixed(2);

  // Single statement: insert the journal AND the two balanced book
  // entries, computing the delta from the live balance via a CTE.
  // Re-reading the balance inside the same statement (rather than
  // passing in a value computed in JS) means the delta reflects the
  // latest state at write time — closes the read-then-write race
  // window for the common case. Returns the previous balance and
  // delta so the caller can report what changed.
  const result = await db.execute(sql`
    WITH current_balance AS (
      SELECT COALESCE(SUM(amount::numeric), 0) AS bal
      FROM book_entries
      WHERE account_id = ${params.accountId}
    ),
    new_journal AS (
      INSERT INTO journal_entries (date, description)
      VALUES (${params.asOfDate}, ${description})
      RETURNING id
    ),
    delta AS (
      SELECT
        (${targetBalance}::numeric - cb.bal) AS amount,
        cb.bal AS previous_balance
      FROM current_balance cb
    ),
    inserted AS (
      INSERT INTO book_entries (journal_entry_id, account_id, amount)
      SELECT new_journal.id, ${params.accountId}, delta.amount
        FROM new_journal, delta
      UNION ALL
      SELECT new_journal.id, ${adjAccountId}, -delta.amount
        FROM new_journal, delta
      RETURNING journal_entry_id
    )
    SELECT
      new_journal.id AS journal_id,
      delta.amount AS delta,
      delta.previous_balance AS previous_balance
    FROM new_journal, delta
    WHERE EXISTS (SELECT 1 FROM inserted)
    LIMIT 1
  `);

  if (result.rows.length === 0) {
    throw new Error('Balance update statement produced no rows — unexpected.');
  }
  const row = result.rows[0];
  const journalId = row.journal_id as number;
  const delta = new Decimal((row.delta as string) ?? '0');
  const previousBalance = new Decimal((row.previous_balance as string) ?? '0');

  return {
    journalId,
    delta: delta.toFixed(2),
    previousBalance: previousBalance.toFixed(2),
  };
}
