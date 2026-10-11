import { sql } from 'drizzle-orm';
import { getDb } from '@/lib/db';
import { londonTodayIso } from '@/lib/dates/today';
import { propertyRepo } from '@/lib/repos/property.repo';
import { readWorkspace, type WorkspaceEnvelope } from '@/lib/finance-workspace/store';
import { analyzePropertyOperations, operationsDateRanges, type OperationsProperty, type OperationsTenancy, type PropertyOperationsSummary, type PropertyReceipt, type PropertyJournalCoverage } from './engine';
import { PROPERTY_OPERATIONS_KEY, propertyOperationsSchema, initialPropertyOperations, type PropertyOperationsData } from './types';

export type PropertyOperationsWorkspace = WorkspaceEnvelope<PropertyOperationsData> & { summary: PropertyOperationsSummary };

export async function loadPropertyOperationsWorkspace(now = new Date()): Promise<PropertyOperationsWorkspace> {
  const asOf = londonTodayIso(now);
  const { comparison } = operationsDateRanges(asOf);
  const db = getDb();
  const [envelope, properties, tenancyResult, receiptResult, coverageResult, valuationResult] = await Promise.all([
    readWorkspace(PROPERTY_OPERATIONS_KEY, propertyOperationsSchema, initialPropertyOperations),
    propertyRepo.listProperties(),
    db.execute(sql`
      SELECT id, property_id AS "propertyId", tenant_name AS "tenantName", start_date AS "startDate",
             end_date AS "endDate", rent_amount AS "rentAmount", rent_frequency AS "rentFrequency"
      FROM tenancies ORDER BY start_date, id
    `),
    db.execute(sql`
      SELECT je.property_id AS "propertyId", je.date, (-be.amount::numeric)::text AS amount
      FROM journal_entries je
      JOIN book_entries be ON be.journal_entry_id = je.id
      JOIN accounts a ON a.id = be.account_id
      WHERE je.property_id IS NOT NULL AND je.date >= ${comparison.startDate} AND je.date <= ${comparison.endDate}
        AND a.account_type = 'INCOME' AND COALESCE(je.is_transfer, FALSE) = FALSE
      ORDER BY je.date, je.id, be.id
    `),
    db.execute(sql`
      SELECT property_id AS "propertyId", date FROM journal_entries
      WHERE property_id IS NOT NULL AND date >= ${comparison.startDate} AND date <= ${comparison.endDate}
        AND COALESCE(is_transfer, FALSE) = FALSE ORDER BY date, id
    `),
    db.execute(sql`
      SELECT p.id,
             (SELECT pv.valuation FROM property_valuations pv WHERE pv.property_id = p.id AND pv.valuation_date <= ${asOf} ORDER BY pv.valuation_date DESC, pv.id DESC LIMIT 1) AS valuation,
             (SELECT pv.valuation_date FROM property_valuations pv WHERE pv.property_id = p.id AND pv.valuation_date <= ${asOf} ORDER BY pv.valuation_date DESC, pv.id DESC LIMIT 1) AS "valuationDate",
             CASE WHEN EXISTS (
               SELECT 1 FROM mortgages m JOIN mortgages other ON other.liability_account_id = m.liability_account_id AND other.property_id <> m.property_id
               WHERE m.property_id = p.id AND m.start_date <= ${asOf} AND other.start_date <= ${asOf}
             ) OR EXISTS (
               SELECT 1 FROM mortgages m WHERE m.property_id = p.id AND m.start_date <= ${asOf}
               AND NOT EXISTS (SELECT 1 FROM book_entries be JOIN journal_entries je ON je.id = be.journal_entry_id WHERE be.account_id = m.liability_account_id AND je.date <= ${asOf})
             ) THEN NULL ELSE COALESCE((
               SELECT SUM(GREATEST(0, -(v.balance - COALESCE((
                 SELECT SUM(be.amount::numeric) FROM book_entries be JOIN journal_entries je ON je.id = be.journal_entry_id
                 WHERE be.account_id = m.liability_account_id AND je.date > ${asOf}
               ), 0)))) FROM (SELECT DISTINCT liability_account_id FROM mortgages WHERE property_id = p.id AND start_date <= ${asOf}) m
               JOIN v_account_balances v ON v.account_id = m.liability_account_id
             ), 0)::text END AS "mortgageDebt"
      FROM properties p
    `),
  ]);
  const values = new Map((valuationResult.rows as Array<Omit<OperationsProperty, 'name'>>).map(row => [row.id, row]));
  const summary = analyzePropertyOperations({
    asOf,
    properties: properties.map(property => ({ id: property.id, name: property.name, valuation: values.get(property.id)?.valuation ?? null, valuationDate: values.get(property.id)?.valuationDate ?? null, mortgageDebt: values.get(property.id)?.mortgageDebt ?? null })),
    tenancies: tenancyResult.rows as unknown as OperationsTenancy[],
    receipts: receiptResult.rows as unknown as PropertyReceipt[],
    journalCoverage: coverageResult.rows as unknown as PropertyJournalCoverage[],
    data: envelope.data,
  });
  return { ...envelope, summary };
}
