import Decimal from 'decimal.js';
import { sql } from 'drizzle-orm';
import { getDb } from '@/lib/db';
import { propertyRepo } from '@/lib/repos';
import { calculateAllEquity } from './equity-calculator';

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

  // Property equity. calculateAllEquity returns Record<propertyId, OwnerEquityData[]>.
  const equityByProperty = await calculateAllEquity();
  const properties = await propertyRepo.listProperties();
  const propertyIndex = new Map<number, string>(properties.map(p => [p.id, p.name]));

  let propertyEquity = new Decimal(0);
  const perProperty: PersonalNetWorth['perProperty'] = [];
  for (const [propertyIdStr, owners] of Object.entries(equityByProperty)) {
    const slice = owners.find(o => o.ownerId === ownerId);
    if (!slice) continue;
    propertyEquity = propertyEquity.plus(slice.equityAmount);
    perProperty.push({
      propertyId: Number(propertyIdStr),
      propertyName: propertyIndex.get(Number(propertyIdStr)) ?? `Property ${propertyIdStr}`,
      equityPct: slice.equityPct,
      equityAmount: slice.equityAmount.toFixed(2),
    });
  }

  // Investments + personal cash + shared unattributed cash. Single
  // round-trip; we partition in memory based on the new flags.
  const accountRows = await db.execute(sql`
    SELECT a.id, a.name, a.account_type, a.is_investment, a.investment_kind, a.owner_id,
           COALESCE(SUM(be.amount::numeric), 0) AS balance
    FROM accounts a
    LEFT JOIN book_entries be ON be.account_id = a.id
    WHERE a.account_type = 'ASSET'
    GROUP BY a.id, a.name, a.account_type, a.is_investment, a.investment_kind, a.owner_id
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
 * Adjust an investment account's balance to a new target value. We
 * implement this as a journal entry — DR/CR the investment account
 * and CR/DR the system "Investment Adjustments" equity account by
 * the delta — so:
 *   - the existing v_account_balances view picks the new balance up
 *     immediately,
 *   - the historical record of value changes is preserved as journals
 *     (so we can derive month-over-month deltas later without a
 *     separate snapshot table),
 *   - double-entry stays balanced (the trigger enforces this).
 *
 * The "Investment Adjustments" equity account is seeded by
 * migration.sql so this never has to create it on the fly.
 */
export async function setInvestmentBalance(params: {
  accountId: number;
  newBalance: string;
  asOfDate: string; // YYYY-MM-DD
  description?: string;
}): Promise<{ journalId: number; delta: string; previousBalance: string }> {
  const db = getDb();

  // Validate target account is an investment account.
  const acctRows = await db.execute(sql`
    SELECT id, name, account_type, is_investment
    FROM accounts
    WHERE id = ${params.accountId}
    LIMIT 1
  `);
  if (acctRows.rows.length === 0) throw new Error(`Account ${params.accountId} not found`);
  const acct = acctRows.rows[0];
  if (!acct.is_investment) {
    throw new Error(`Account ${params.accountId} (${acct.name}) is not flagged as an investment.`);
  }
  if (acct.account_type !== 'ASSET') {
    throw new Error(`Investment accounts must be ASSET type; ${acct.name} is ${acct.account_type}.`);
  }

  // Current balance and the seeded equity account in one round-trip.
  const balanceRows = await db.execute(sql`
    SELECT
      (SELECT COALESCE(SUM(amount::numeric), 0) FROM book_entries WHERE account_id = ${params.accountId}) AS current_balance,
      (SELECT id FROM accounts WHERE name = 'Investment Adjustments' AND is_system = true LIMIT 1) AS adj_account_id
  `);
  const previousBalance = new Decimal((balanceRows.rows[0].current_balance as string) ?? '0');
  const adjAccountId = balanceRows.rows[0].adj_account_id as number | null;
  if (adjAccountId === null) {
    throw new Error('System "Investment Adjustments" equity account is missing — re-run the database migration.');
  }

  const target = new Decimal(params.newBalance);
  const delta = target.minus(previousBalance);

  if (delta.abs().lt('0.01')) {
    return { journalId: 0, delta: '0.00', previousBalance: previousBalance.toFixed(2) };
  }

  // Double-entry: DR investment +delta, CR adjustments -delta.
  const journalRows = await db.execute(sql`
    INSERT INTO journal_entries (date, description)
    VALUES (${params.asOfDate}, ${params.description ?? `Investment balance update — ${acct.name}`})
    RETURNING id
  `);
  const journalId = journalRows.rows[0].id as number;

  await db.execute(sql`
    INSERT INTO book_entries (journal_entry_id, account_id, amount)
    VALUES
      (${journalId}, ${params.accountId}, ${delta.toFixed(2)}),
      (${journalId}, ${adjAccountId}, ${delta.neg().toFixed(2)})
  `);

  return {
    journalId,
    delta: delta.toFixed(2),
    previousBalance: previousBalance.toFixed(2),
  };
}
