import { sql } from 'drizzle-orm';
import Decimal from 'decimal.js';
import { getDb } from '@/lib/db';
import { accountBalanceAsOf } from '@/lib/db/account-balance-as-of';
import { londonTodayIso } from '@/lib/dates/today';
import { readWorkspace } from '@/lib/finance-workspace/store';
import { analyzePortfolio } from './analyze';
import { INITIAL_PORTFOLIO, PORTFOLIO_KEY, portfolioDataSchema, type PortfolioAccount, type PortfolioData } from './schema';

/** Only real ASSET accounts explicitly marked as investments can contain holdings. */
export async function loadPortfolioAccounts(asOf = londonTodayIso()): Promise<PortfolioAccount[]> {
  const rows = await getDb().execute(sql`
    SELECT a.id, a.name, a.investment_kind, o.name AS owner_name,
           ${accountBalanceAsOf(asOf)} AS balance
    FROM accounts a
    LEFT JOIN owners o ON o.id = a.owner_id
    LEFT JOIN v_account_balances v ON v.account_id = a.id
    WHERE a.is_investment = true AND a.account_type = 'ASSET'
    ORDER BY a.name
  `);
  return rows.rows.map(row => {
    const id = Number(row.id);
    if (!Number.isInteger(id) || id <= 0 || typeof row.name !== 'string') throw new Error('Invalid investment account record');
    const balance = new Decimal(String(row.balance));
    if (!balance.isFinite()) throw new Error('Invalid investment account balance');
    return {
      id, name: row.name,
      investmentKind: typeof row.investment_kind === 'string' ? row.investment_kind : null,
      ownerName: typeof row.owner_name === 'string' ? row.owner_name : null,
      balance: balance.toFixed(2), balanceAsOf: asOf,
    };
  });
}

export async function loadPortfolioWorkspace() {
  const asOf = londonTodayIso();
  const [workspace, accounts] = await Promise.all([
    readWorkspace(PORTFOLIO_KEY, portfolioDataSchema, INITIAL_PORTFOLIO),
    loadPortfolioAccounts(asOf),
  ]);
  return { workspace, accounts, analysis: analyzePortfolio(workspace.data, accounts, asOf) };
}

/** Prevent a submitted change from inventing assets or future statement values. */
export function validatePortfolioAgainstAccounts(data: PortfolioData, accounts: PortfolioAccount[], asOf: string, previous?: PortfolioData): string | null {
  const ids = new Set(accounts.map(account => account.id));
  for (const holding of data.holdings) {
    if (!ids.has(holding.accountId)) return 'Every holding must belong to an existing investment ASSET account.';
    if (holding.valuationDate > asOf) return 'A holding valuation cannot be dated in the future.';
  }
  if (data.platforms.some(platform => !ids.has(platform.accountId))) return 'Every platform fee must belong to an existing investment ASSET account.';
  const analysis = analyzePortfolio(data, accounts, asOf);
  const prior = previous ? analyzePortfolio(previous, accounts, asOf) : null;
  for (const account of analysis.accounts) {
    if (new Decimal(account.overallocated).lte(0)) continue;
    const priorAccount = prior?.accounts.find(item => item.id === account.id);
    // Permit corrections of a previously inconsistent snapshot in steps. A
    // fresh over-allocation, an increase, or an unchanged over-allocation is
    // rejected. Read-time inconsistencies never alter the stored holdings.
    if (priorAccount && new Decimal(account.overallocated).lt(priorAccount.overallocated)) continue;
    return `Holdings in ${account.name} exceed its current ledger balance by £${account.overallocated}. Reduce the recorded holdings or update the account's statement balance first.`;
  }
  return null;
}
export type PortfolioWorkspaceResponse = Awaited<ReturnType<typeof loadPortfolioWorkspace>>;
