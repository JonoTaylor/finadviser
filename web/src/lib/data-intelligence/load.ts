import { sql } from 'drizzle-orm';
import { getDb } from '@/lib/db';
import { londonTodayIso } from '@/lib/dates/today';
import { loadFinancialContext } from '@/lib/finance-context';
import { loadContextLookup } from '@/lib/finance-context/lookup';
import { loadPlanningProfile } from '@/lib/planning/load';
import { readWorkspace } from '@/lib/finance-workspace/store';
import { DEBT_WORKSPACE_KEY } from '@/lib/debts/load';
import { debtWorkspaceSchema } from '@/lib/debts/types';
import { INITIAL_PORTFOLIO, PORTFOLIO_KEY, portfolioDataSchema } from '@/lib/portfolio/schema';
import { PENSION_RECORDS_KEY, pensionRecordsDataSchema } from '@/lib/pension-records/schema';
import { PROPERTY_OPERATIONS_KEY, initialPropertyOperations, propertyOperationsSchema } from '@/lib/property-operations/types';
import { categorizationRepo } from '@/lib/categorization/repository';
import { buildDataIntelligence, completedRecentMonths } from './engine';
import type { DataAvailability, DataIntelligenceReport, LedgerCoverage, PropertyCoverageRecord } from './types';

async function available<T>(load: () => Promise<T>): Promise<DataAvailability<T>> {
  try { return { status: 'ready', data: await load() }; }
  catch { return { status: 'unavailable' }; }
}
function count(value: unknown): number {
  const result = typeof value === 'number' || typeof value === 'string' ? Number(value) : NaN;
  if (!Number.isSafeInteger(result) || result < 0) throw new Error('Invalid recorded coverage count');
  return result;
}
function date(value: unknown): string | null {
  if (value === null) return null;
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error('Invalid recorded coverage date');
  const parsed = new Date(`${value}T00:00:00Z`);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) throw new Error('Invalid recorded coverage date');
  return value;
}

/** One aggregate row; no statement descriptions, raw metadata or ledger row array. */
export async function loadLedgerCoverage(asOf: string): Promise<LedgerCoverage> {
  const firstRecentMonth = `${completedRecentMonths(asOf)[0]}-01`;
  const firstCurrentMonth = `${asOf.slice(0, 7)}-01`;
  const [result, decisions] = await Promise.all([
    getDb().execute(sql`
      WITH recorded AS (
        SELECT je.id, je.date, je.category_id, je.is_transfer, je.transfer_group_id,
               je.transfer_review_dismissed_at,
               EXISTS (
                 SELECT 1 FROM book_entries be JOIN accounts a ON a.id = be.account_id
                 WHERE be.journal_entry_id = je.id AND a.account_type IN ('INCOME', 'EXPENSE')
                   AND be.amount::numeric <> 0
               ) AS has_cashflow,
               EXISTS (
                 SELECT 1 FROM book_entries be JOIN accounts a ON a.id = be.account_id
                 WHERE be.journal_entry_id = je.id AND a.account_type IN ('ASSET', 'LIABILITY')
                   AND a.name NOT IN ('Uncategorized Income', 'Uncategorized Expense')
               ) AS has_transfer_account
        FROM journal_entries je WHERE je.date <= ${asOf}
      )
      SELECT COUNT(*)::text AS total_count,
             COUNT(*) FILTER (WHERE category_id IS NULL AND COALESCE(is_transfer, FALSE) = FALSE)::text AS uncategorised_count,
             MAX(date) AS latest_date,
             COALESCE(ARRAY_AGG(DISTINCT SUBSTRING(date, 1, 7)) FILTER (
               WHERE date >= ${firstRecentMonth} AND date < ${firstCurrentMonth}
                 AND COALESCE(is_transfer, FALSE) = FALSE AND has_cashflow
             ), ARRAY[]::text[]) AS recent_months,
             (SELECT COUNT(*)::text FROM (
               SELECT transfer_group_id FROM recorded
               WHERE transfer_group_id IS NOT NULL AND COALESCE(is_transfer, FALSE) = FALSE
                 AND transfer_review_dismissed_at IS NULL AND has_transfer_account
               GROUP BY transfer_group_id HAVING COUNT(DISTINCT id) >= 2
             ) pending_groups) AS transfer_review_count
      FROM recorded
    `),
    // Its own current-snapshot eligibility logic excludes stale review decisions.
    available(async () => {
      const result = await categorizationRepo.counts({ asOf });
      return { needsReview: count(result.needsReview), remaining: count(result.remaining), available: count(result.available) };
    }),
  ]);
  if (result.rows.length !== 1) throw new Error('Recorded coverage is unavailable');
  const row = result.rows[0];
  if (!Array.isArray(row.recent_months) || row.recent_months.some(month => typeof month !== 'string' || !completedRecentMonths(asOf).includes(month))) throw new Error('Invalid recorded month coverage');
  return {
    totalCount: count(row.total_count), uncategorisedCount: count(row.uncategorised_count),
    latestDate: date(row.latest_date), recentMonths: [...new Set(row.recent_months as string[])].sort(),
    transferReviewCount: count(row.transfer_review_count),
    reviewNeededCount: decisions.status === 'ready' ? count(decisions.data.needsReview) : null,
    eligibleCount: decisions.status === 'ready' ? count(decisions.data.remaining) : null,
    unprocessedCount: decisions.status === 'ready' ? count(decisions.data.available) : null,
  };
}

/** Bounded to the number of properties: tenancies/valuations stay aggregated. */
export async function loadPropertyCoverage(asOf: string): Promise<PropertyCoverageRecord[]> {
  const result = await getDb().execute(sql`
    SELECT p.id, p.name,
           (SELECT MAX(pv.valuation_date) FROM property_valuations pv
             WHERE pv.property_id = p.id AND pv.valuation_date <= ${asOf}) AS valuation_date,
           (SELECT COUNT(*) FROM tenancies t WHERE t.property_id = p.id
             AND t.start_date <= ${asOf} AND (t.end_date IS NULL OR t.end_date >= ${asOf}))::text AS active_tenancy_count,
           (SELECT COUNT(*) FROM property_ownership po WHERE po.property_id = p.id)::text AS ownership_count
    FROM properties p ORDER BY p.id
  `);
  return result.rows.map(row => {
    const id = count(row.id);
    if (id === 0 || typeof row.name !== 'string') throw new Error('Invalid property coverage record');
    return { id, name: row.name, valuationDate: date(row.valuation_date), activeTenancyCount: count(row.active_tenancy_count), ownershipCount: count(row.ownership_count) };
  });
}

/** Every read is isolated so unavailable sources are never replaced with defaults. */
export async function loadDataIntelligence(now = new Date()): Promise<DataIntelligenceReport> {
  const asOf = londonTodayIso(now);
  // Shared lookup only reads aggregated account information, not transaction rows.
  const lookup = loadContextLookup(now);
  const [ledger, context, planning, debts, portfolio, pensions, properties] = await Promise.all([
    available(() => loadLedgerCoverage(asOf)),
    available(async () => {
      const [workspace, references] = await Promise.all([loadFinancialContext(), lookup]);
      return { data: workspace.data, saved: workspace.revision > 0, lookup: references };
    }),
    available(() => loadPlanningProfile()),
    available(async () => {
      const [workspace, references] = await Promise.all([readWorkspace(DEBT_WORKSPACE_KEY, debtWorkspaceSchema, { debts: [] }), lookup]);
      return { records: workspace.data.debts, lookup: references };
    }),
    available(async () => {
      const [workspace, references] = await Promise.all([readWorkspace(PORTFOLIO_KEY, portfolioDataSchema, INITIAL_PORTFOLIO), lookup]);
      return { data: workspace.data, lookup: references };
    }),
    available(async () => {
      const [workspace, references] = await Promise.all([readWorkspace(PENSION_RECORDS_KEY, pensionRecordsDataSchema, []), lookup]);
      return { records: workspace.data, lookup: references };
    }),
    available(async () => {
      const [workspace, records] = await Promise.all([readWorkspace(PROPERTY_OPERATIONS_KEY, propertyOperationsSchema, initialPropertyOperations), loadPropertyCoverage(asOf)]);
      return { records, data: workspace.data };
    }),
  ]);
  return buildDataIntelligence({ asOf, ledger, context, planning, debts, portfolio, pensions, properties }, Boolean(process.env.AI_GATEWAY_API_KEY?.trim()));
}
