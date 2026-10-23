import { sql, type SQL } from 'drizzle-orm';
import { getDb } from '@/lib/db';
import { ClientError, NotFoundError } from '@/lib/errors';
import { taxYearForDate } from '@/lib/tax/ukTaxYear';

export class MortgageDateCorrectionConflictError extends Error {
  readonly status = 409;
  constructor(message = 'The payment changed or needs a different review. No date correction was saved.') {
    super(message);
    this.name = 'MortgageDateCorrectionConflictError';
  }
}

export interface MortgageDateCorrectionInput {
  mortgageId: number;
  journalId: number;
  correctDate: string;
  propertyId?: number;
}

export interface MortgageDateCorrectionReview {
  journalId: number;
  mortgageId: number;
  propertyId: number;
  date: string;
  amount: string | null;
  reference: string | null;
  correctDate: string;
  expectedSnapshot: string;
  canCorrect: boolean;
  alreadyCorrected: boolean;
  reason: string;
  affectedTaxYears: string[];
  taxYearChanged: boolean;
}

/** Real Gregorian dates only; dates are never interpreted in the host timezone. */
export function isMortgagePaymentIsoDate(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number);
  if (year < 1900 || year > 9999 || month < 1 || month > 12 || day < 1 || day > 31) return false;
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() + 1 === month && date.getUTCDate() === day;
}

export function isPossibleTruncatedPaymentDate(oldDate: string, correctDate: string): boolean {
  if (!isMortgagePaymentIsoDate(oldDate) || !isMortgagePaymentIsoDate(correctDate)) return false;
  const before = Number(oldDate.slice(8));
  const after = Number(correctDate.slice(8));
  return oldDate.slice(0, 7) === correctDate.slice(0, 7)
    && before >= 1 && before <= 9 && after >= 10 && after % 10 === before;
}

function validate(input: MortgageDateCorrectionInput) {
  for (const id of [input.mortgageId, input.journalId, ...(input.propertyId === undefined ? [] : [input.propertyId])]) {
    if (!Number.isSafeInteger(id) || id < 1 || id > 2147483647) throw new ClientError('Use valid mortgage, property and payment IDs.');
  }
  if (!isMortgagePaymentIsoDate(input.correctDate)) throw new ClientError('Use a real payment date in YYYY-MM-DD format.');
}

/** Shared evidence query: snapshots bind both posting legs and the proposed date. */
function evidence(input: MortgageDateCorrectionInput): SQL {
  return sql`
    SELECT je.id AS journal_id, m.id AS mortgage_id, m.property_id,
      je.date, je.reference, je.description, je.category_id, je.is_transfer,
      legs.amount::text AS amount,
      (je.property_id = m.property_id AND m.interest_only = TRUE AND NOT COALESCE(je.is_transfer, FALSE)
        AND legs.leg_count = 2 AND legs.asset_count = 1 AND legs.interest_count = 1
        AND legs.total = 0 AND legs.amount > 0
        AND je.reference = 'mortgage_payment:' || m.id || ':' || je.date || ':' || legs.amount::text
        AND (SELECT COUNT(*) FROM journal_entries same_ref WHERE same_ref.reference = je.reference) = 1
      ) AS supported,
      EXISTS (SELECT 1 FROM journal_entries target
        WHERE target.id <> je.id
          AND target.reference = 'mortgage_payment:' || m.id || ':' || ${input.correctDate} || ':' || legs.amount::text
      ) AS target_exists,
      md5(jsonb_build_object(
        'journalId', je.id, 'mortgageId', m.id, 'mortgagePropertyId', m.property_id, 'interestOnly', m.interest_only,
        'propertyId', je.property_id, 'date', je.date, 'reference', je.reference,
        'description', je.description, 'categoryId', je.category_id,
        'isTransfer', je.is_transfer, 'correctDate', ${input.correctDate}::text, 'legs', legs.details
      )::text) AS snapshot
    FROM mortgages m
    JOIN journal_entries je ON je.id = ${input.journalId}
    CROSS JOIN LATERAL (
      SELECT COUNT(*) AS leg_count,
        COUNT(*) FILTER (WHERE a.account_type = 'ASSET' AND be.amount < 0) AS asset_count,
        COUNT(*) FILTER (WHERE a.account_type = 'EXPENSE' AND a.name = 'Mortgage Interest' AND be.amount > 0) AS interest_count,
        SUM(be.amount)::numeric(14,2) AS total,
        MAX(be.amount) FILTER (WHERE a.account_type = 'EXPENSE' AND a.name = 'Mortgage Interest' AND be.amount > 0)::numeric(14,2) AS amount,
        jsonb_agg(jsonb_build_object('id', be.id, 'accountId', be.account_id,
          'amount', be.amount::text, 'type', a.account_type, 'name', a.name) ORDER BY be.id) AS details
      FROM book_entries be JOIN accounts a ON a.id = be.account_id
      WHERE be.journal_entry_id = je.id
    ) legs
    WHERE m.id = ${input.mortgageId}
  `;
}

type EvidenceRow = Record<string, unknown>;
function reviewFromRow(input: MortgageDateCorrectionInput, row: EvidenceRow): MortgageDateCorrectionReview {
  const propertyId = Number(row.property_id);
  if (input.propertyId !== undefined && propertyId !== input.propertyId) throw new ClientError('The mortgage does not belong to this property.');
  const date = String(row.date);
  const supported = row.supported === true;
  const alreadyCorrected = supported && date === input.correctDate && row.target_exists !== true;
  const canCorrect = supported && !alreadyCorrected && row.target_exists !== true && isPossibleTruncatedPaymentDate(date, input.correctDate);
  const affectedTaxYears = isMortgagePaymentIsoDate(date)
    ? [...new Set([taxYearForDate(date).label, taxYearForDate(input.correctDate).label])] : [taxYearForDate(input.correctDate).label];
  const taxYearChanged = affectedTaxYears.length > 1;
  const reason = alreadyCorrected ? 'This recorded payment already has the confirmed date. No change is needed.'
    : !supported ? 'This is not a unique payment for a confirmed interest-only mortgage with matching property and balanced full-interest posting legs. Review it manually; no correction is supported.'
      : row.target_exists === true ? 'Another payment already uses the proposed date and amount. Review both records before changing either.'
        : !canCorrect ? 'The proposed date does not match the earlier day-truncation pattern in the same month. No correction is supported.'
          : 'Possible earlier parser date issue. Confirm this exact payment and its statement date before saving; this preview does not establish that the recorded date is wrong.';
  return {
    journalId: Number(row.journal_id), mortgageId: Number(row.mortgage_id), propertyId,
    date, amount: row.amount === null ? null : String(row.amount), reference: row.reference === null ? null : String(row.reference),
    correctDate: input.correctDate, expectedSnapshot: String(row.snapshot), canCorrect, alreadyCorrected,
    reason: reason + (taxYearChanged ? ' This correction crosses 6 April; recompute both affected tax years after saving.' : ''),
    affectedTaxYears, taxYearChanged,
  };
}

export async function previewMortgagePaymentDateCorrection(input: MortgageDateCorrectionInput): Promise<MortgageDateCorrectionReview> {
  validate(input);
  const result = await getDb().execute(evidence(input));
  if (result.rows.length !== 1) throw new NotFoundError('The mortgage or recorded payment was not found.');
  return reviewFromRow(input, result.rows[0]);
}

/** Only date and stable reference change; no money, account or ownership posting is replaced. */
export async function correctMortgagePaymentDate(input: MortgageDateCorrectionInput & { expectedSnapshot: string }) {
  validate(input);
  if (!/^[a-f0-9]{32}$/.test(input.expectedSnapshot)) throw new ClientError('Read the current payment review before saving a correction.');
  const current = await previewMortgagePaymentDateCorrection(input);
  if (current.alreadyCorrected) return { corrected: false, alreadyCorrected: true, record: current };
  if (!current.canCorrect || current.expectedSnapshot !== input.expectedSnapshot) throw new MortgageDateCorrectionConflictError(current.canCorrect ? undefined : current.reason);
  const result = await getDb().execute(sql`
    WITH reviewed AS (${evidence(input)})
    UPDATE journal_entries je
      SET date = ${input.correctDate},
        reference = 'mortgage_payment:' || reviewed.mortgage_id || ':' || ${input.correctDate} || ':' || reviewed.amount
    FROM reviewed
    WHERE je.id = reviewed.journal_id
      AND reviewed.supported AND NOT reviewed.target_exists
      AND reviewed.snapshot = ${input.expectedSnapshot}
      AND je.date = reviewed.date AND je.reference = reviewed.reference
      AND je.property_id = reviewed.property_id
      AND je.category_id IS NOT DISTINCT FROM reviewed.category_id
      AND je.description = reviewed.description
      AND je.is_transfer IS NOT DISTINCT FROM reviewed.is_transfer
      AND reviewed.date <> ${input.correctDate}
    RETURNING je.id
  `);
  if (result.rows.length !== 1) throw new MortgageDateCorrectionConflictError();
  const record = await previewMortgagePaymentDateCorrection(input);
  return { corrected: true, alreadyCorrected: false, record: {
    ...record, affectedTaxYears: current.affectedTaxYears, taxYearChanged: current.taxYearChanged,
    reason: record.reason + (current.taxYearChanged ? ' The saved correction crossed 6 April; recompute both affected tax years.' : ''),
  } };
}
