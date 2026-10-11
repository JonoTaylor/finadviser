import Decimal from 'decimal.js';
import { sql } from 'drizzle-orm';
import { getDb } from '@/lib/db';
import { accountBalanceAsOf } from '@/lib/db/account-balance-as-of';
import { londonTodayIso } from '@/lib/dates/today';
import { propertyRepo } from '@/lib/repos/property.repo';
import { contextSchema, type ContextAccount, type ContextLookup, type FinancialContext } from './schema';

interface AccountRow {
  id: number;
  name: string;
  account_type: string;
  is_investment: boolean;
  investment_kind: string | null;
  owner_id: number | null;
  balance: string;
  is_property_asset: boolean;
  latest_journal_date: string | null;
  posting_count: string | number;
  future_posting_count: string | number;
}

/** Dates describe recorded journal postings, not bank statement verification. */
export async function loadContextLookup(now = new Date()): Promise<ContextLookup> {
  const asOf = londonTodayIso(now);
  const db = getDb();
  const [owners, result] = await Promise.all([
    propertyRepo.listOwners(),
    db.execute(sql`
      SELECT a.id, a.name, a.account_type, a.is_investment, a.investment_kind, a.owner_id,
             ${accountBalanceAsOf(asOf)}::text AS balance,
             (SELECT MAX(j.date) FROM book_entries b JOIN journal_entries j ON j.id = b.journal_entry_id
               WHERE b.account_id = a.id AND j.date <= ${asOf}) AS latest_journal_date,
             (SELECT COUNT(*) FROM book_entries b JOIN journal_entries j ON j.id = b.journal_entry_id
               WHERE b.account_id = a.id AND j.date <= ${asOf}) AS posting_count,
             (SELECT COUNT(*) FROM book_entries b JOIN journal_entries j ON j.id = b.journal_entry_id
               WHERE b.account_id = a.id AND j.date > ${asOf}) AS future_posting_count,
             EXISTS (SELECT 1 FROM properties p WHERE a.account_type = 'ASSET' AND (
               lower(a.name) = lower(p.name) OR lower(a.name) = lower('Property: ' || p.name)
               OR lower(a.name) = lower('Property - ' || p.name)
             )) AS is_property_asset
      FROM accounts a LEFT JOIN v_account_balances v ON v.account_id = a.id
      WHERE a.account_type IN ('ASSET', 'LIABILITY')
      ORDER BY a.account_type, a.name
    `),
  ]);
  const accounts = (result.rows as unknown as AccountRow[]).map((row): ContextAccount => {
    const balance = new Decimal(row.balance);
    if (!balance.isFinite()) throw new Error('A recorded account balance is invalid');
    return {
    id: row.id,
    name: row.name,
    accountType: row.account_type,
    isInvestment: row.is_investment,
    investmentKind: row.investment_kind,
    ownerId: row.owner_id,
    balance: balance.toFixed(2),
    isPropertyAsset: row.is_property_asset,
    latestJournalDate: row.latest_journal_date,
    postingCount: Number(row.posting_count),
    futurePostingCount: Number(row.future_posting_count),
    };
  });
  return { asOf, owners: owners.map(owner => ({ id: owner.id, name: owner.name })), accounts };
}

/** Reject stale or invented foreign IDs before writing the workspace. */
export function validateContextReferences(context: FinancialContext, lookup: ContextLookup): void {
  const issues: { code: 'custom'; path: (string | number)[]; message: string }[] = [];
  if (context.ownerId !== null && !lookup.owners.some(owner => owner.id === context.ownerId)) {
    issues.push({ code: 'custom', path: ['ownerId'], message: 'Choose an owner recorded in your ledger' });
  }
  for (const [index, override] of context.accountAccessibility.entries()) {
    if (!lookup.accounts.some(account => account.id === override.accountId)) {
      issues.push({ code: 'custom', path: ['accountAccessibility', index, 'accountId'], message: 'Choose an asset or liability account recorded in your ledger' });
    }
  }
  if (issues.length) {
    // Use the same validation error type as the shared API boundary.
    const check = contextSchema.superRefine((_, ctx) => issues.forEach(issue => ctx.addIssue(issue)));
    check.parse(context);
  }
}
