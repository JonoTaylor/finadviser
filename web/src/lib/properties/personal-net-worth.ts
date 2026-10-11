import Decimal from 'decimal.js';
import { sql } from 'drizzle-orm';
import { getDb } from '@/lib/db';
import { accountBalanceAsOf } from '@/lib/db/account-balance-as-of';
import { londonTodayIso } from '@/lib/dates/today';
import { ClientError } from '@/lib/errors';
import { investmentBalanceInputSchema } from '@/lib/validation/investment-balance';
import { financialPlanValidationError } from '@/lib/validation/financial-plans';
import { propertyRepo } from '@/lib/repos';
import { calculateEquity } from './equity-calculator';

/**
 * "Your share" net worth — owner-scoped instead of household-aggregate.
 *
 * Four buckets per owner:
 *  - Property equity: their slice of (market value − mortgage debt)
 *    across every property they own a share of, via the existing
 *    calculateEquity() (already mortgage-netted).
 *  - Investments: ASSET accounts flagged is_investment=true and tagged
 *    owner_id = $owner. Pensions, ISAs, etc.
 *  - Personal cash: ASSET accounts NOT flagged is_investment, tagged
 *    owner_id = $owner. Untagged shared cash is shown separately so
 *    the user can decide whether to attribute it.
 *
 *  - Personal liabilities: owner-tagged credit cards and other debts.
 *    Mortgage accounts already counted in this owner's property equity
 *    are excluded. Shared debts remain visible but unattributed.
 */

export interface PersonalNetWorth {
  ownerId: number;
  ownerName: string;
  balanceAsOf: string;
  propertyEquity: string;       // total across properties for this owner
  investments: string;          // total of is_investment accounts owned by this owner
  personalCash: string;         // total of NON-investment ASSET accounts owned by this owner
  personalLiabilities: string;  // amount owed; debit/credit balances preserve their sign
  total: string;                // assets + property equity - personal liabilities
  // For context — shows the user what's NOT included in `total`:
  sharedCashUnattributed: string; // ASSET accounts with owner_id IS NULL and is_investment = false
  sharedLiabilitiesUnattributed: string;
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
  perLiability: Array<{
    accountId: number;
    name: string;
    balance: string;            // positive means owed; negative means a credit balance
  }>;
}

export async function calculatePersonalNetWorth(ownerId: number, now = new Date()): Promise<PersonalNetWorth | null> {
  const owner = await propertyRepo.getOwner(ownerId);
  if (!owner) return null;

  const db = getDb();
  const asOf = londonTodayIso(now);

  // Property equity. Fetch the property list ONCE and run
  // calculateEquity per property in parallel — calculateAllEquity
  // would re-fetch listProperties internally, doubling the
  // round-trip on every dashboard load.
  const properties = await propertyRepo.listProperties();
  const equitySlices = await Promise.all(properties.map(p => calculateEquity(p.id, asOf)));

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

  // Investments, cash and standalone debt. Single
  // round-trip via v_account_balances (single source of truth for
  // balance arithmetic — don't re-implement SUM(book_entries) here).
  // Filtered to assets and non-mortgage liabilities relevant to
  // a personal-net-worth calc: their own accounts plus any shared
  // (owner_id IS NULL) accounts so we can report the sharedCashUnattributed
  // diagnostic.
  const mortgageAlreadyNetted = perProperty.length > 0
    ? sql`m.property_id IN (${sql.join(perProperty.map(property => sql`${property.propertyId}`), sql`, `)})`
    : sql`FALSE`;
  const accountRows = await db.execute(sql`
    SELECT a.id, a.name, a.account_type, a.is_investment, a.investment_kind, a.owner_id,
           ${accountBalanceAsOf(asOf)} AS balance
    FROM accounts a
    LEFT JOIN v_account_balances v ON v.account_id = a.id
    WHERE a.account_type IN ('ASSET', 'LIABILITY')
      AND (a.owner_id = ${ownerId} OR a.owner_id IS NULL)
      AND NOT EXISTS (
        SELECT 1 FROM mortgages m WHERE m.liability_account_id = a.id
          AND ${mortgageAlreadyNetted}
      )
  `);

  let investments = new Decimal(0);
  let personalCash = new Decimal(0);
  let sharedCashUnattributed = new Decimal(0);
  let personalLiabilities = new Decimal(0);
  let sharedLiabilitiesUnattributed = new Decimal(0);
  const perInvestment: PersonalNetWorth['perInvestment'] = [];
  const perLiability: PersonalNetWorth['perLiability'] = [];

  for (const r of accountRows.rows) {
    const balance = new Decimal((r.balance as string) ?? '0');
    const accOwner = r.owner_id as number | null;
    if (r.account_type === 'LIABILITY') {
      // Liability credits are negative in the ledger; report the amount
      // owed as positive. A debit credit-card balance reduces debt.
      const owed = balance.negated();
      if (accOwner === ownerId) {
        personalLiabilities = personalLiabilities.plus(owed);
        perLiability.push({
          accountId: r.id as number,
          name: r.name as string,
          balance: owed.toFixed(2),
        });
      } else if (accOwner === null) {
        sharedLiabilitiesUnattributed = sharedLiabilitiesUnattributed.plus(owed);
      }
      continue;
    }
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

  const total = propertyEquity.plus(investments).plus(personalCash).minus(personalLiabilities);

  return {
    ownerId,
    ownerName: owner.name,
    balanceAsOf: asOf,
    propertyEquity: propertyEquity.toFixed(2),
    investments: investments.toFixed(2),
    personalCash: personalCash.toFixed(2),
    personalLiabilities: personalLiabilities.toFixed(2),
    total: total.toFixed(2),
    sharedCashUnattributed: sharedCashUnattributed.toFixed(2),
    sharedLiabilitiesUnattributed: sharedLiabilitiesUnattributed.toFixed(2),
    perProperty,
    perInvestment: perInvestment.sort((a, b) => Number(b.balance) - Number(a.balance)),
    perLiability: perLiability.sort((a, b) => new Decimal(b.balance).comparedTo(a.balance)),
  };
}

/**
 * Adjust an investment account's balance to a new target value via a
 * journal entry: DR/CR the investment account and CR/DR the system
 * "Investment Adjustments" equity account by the delta. Effects:
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
 * Implementation: a Postgres function `set_investment_balance` does
 * the read-balance + insert-journal + insert-book-entries flow
 * imperatively. The TS layer just validates and calls the function
 * with one SELECT. This sidesteps an earlier multi-data-modifying-CTE
 * shape that the neon-http transport rejected with HTTP 400. The
 * read-then-write race window (between the live balance read and the
 * delta insert) is closed by locking the account row inside the
 * function (FOR UPDATE), which serializes concurrent invocations on
 * the same account. The validation read above is purely a safety
 * check.
 */
export async function setInvestmentBalance(params: {
  accountId: number;
  newBalance: string;
  asOfDate: string; // YYYY-MM-DD
  description?: string;
}): Promise<{ journalId: number; delta: string; previousBalance: string }> {
  const parsed = investmentBalanceInputSchema.safeParse(params);
  if (!parsed.success) throw new ClientError(financialPlanValidationError(parsed.error));
  const input = parsed.data;
  const db = getDb();

  // Validate target account + look up the seeded adjustment account
  // in a single query.
  const validation = await db.execute(sql`
    SELECT
      a.id, a.name, a.account_type, a.is_investment,
      (SELECT id FROM accounts WHERE name = 'Investment Adjustments' AND is_system = true LIMIT 1) AS adj_account_id
    FROM accounts a
    WHERE a.id = ${input.accountId}
    LIMIT 1
  `);
  if (validation.rows.length === 0) throw new Error(`Account ${input.accountId} not found`);
  const acct = validation.rows[0];
  if (!acct.is_investment) {
    throw new Error(`Account ${input.accountId} (${acct.name}) is not flagged as an investment.`);
  }
  if (acct.account_type !== 'ASSET') {
    throw new Error(`Investment accounts must be ASSET type; ${acct.name} is ${acct.account_type}.`);
  }
  const adjAccountId = acct.adj_account_id as number | null;
  if (adjAccountId === null) {
    throw new Error('System "Investment Adjustments" equity account is missing — re-run the database migration.');
  }

  const description = input.description || `Investment balance update - ${acct.name}`;
  const targetBalance = input.newBalance;

  // Calls the set_investment_balance Postgres function (defined in
  // migration.sql) as a single SELECT. The function reads the live
  // balance through the requested date, inserts a journal entry and the two balanced book
  // entries, and returns (journal_id, delta, previous_balance) in
  // one row. Earlier versions of this code used a multi-data-
  // modifying CTE inline, but the neon-http transport rejected that
  // shape with HTTP 400 (cf. /api/investments/[id]/balance failures);
  // wrapping the same logic in a server-side function sidesteps the
  // CTE handling entirely.
  const result = await db.execute(sql`
    SELECT journal_id, delta, previous_balance
      FROM set_investment_balance(
        ${input.accountId}::integer,
        ${targetBalance}::numeric,
        ${input.asOfDate}::text,
        ${description}::text,
        ${adjAccountId}::integer
      )
  `);

  if (result.rows.length === 0) {
    throw new Error('Balance update produced no rows (unexpected; the set_investment_balance function should always return one row).');
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
