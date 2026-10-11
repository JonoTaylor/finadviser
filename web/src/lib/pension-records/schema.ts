import Decimal from 'decimal.js';
import { z } from 'zod';
import { londonTodayIso } from '@/lib/dates/today';

export const PENSION_RECORDS_KEY = 'finance.pension-records.v1';

const money = z.string().trim().regex(/^\d{1,12}(?:\.\d{1,2})?$/, 'Enter a non-negative amount with at most two decimal places').transform(value => new Decimal(value).toFixed(2)).nullable();
const percentage = z.string().trim().regex(/^\d{1,3}(?:\.\d{1,4})?$/, 'Enter a percentage with at most four decimal places').refine(value => new Decimal(value).lte(100), 'Percentage must be between 0 and 100').transform(value => new Decimal(value).toString()).nullable();
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD').refine(value => {
  const parsed = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}, 'Enter a real calendar date').refine(value => value <= londonTodayIso(), 'A statement or forecast date cannot be in the future').nullable();

const common = {
  id: z.uuid(),
  name: z.string().trim().min(1, 'Scheme name is required').max(160),
  provider: z.string().trim().min(1).max(160).nullable(),
  ownerId: z.number().int().positive().nullable(),
  statementAsOf: date,
  notes: z.string().trim().max(2000).nullable(),
};

export const pensionRecordSchema = z.discriminatedUnion('type', [
  z.object({
    ...common,
    type: z.literal('dc'),
    linkedAccountId: z.number().int().positive().nullable(),
    potAmount: money,
    personalMonthlyContribution: money,
    employerMonthlyContribution: money,
    annualFeeRate: percentage,
  }).strict().refine(record => record.linkedAccountId === null || record.potAmount === null, 'A linked pension uses its ledger balance; leave the separate statement pot blank'),
  z.object({
    ...common,
    type: z.literal('db'),
    promisedAnnualIncome: money,
    startAge: z.number().int().min(0).max(120).nullable(),
  }).strict(),
  z.object({
    ...common,
    type: z.literal('state'),
    forecastAnnualIncome: money,
    forecastSourceDate: date,
    startAge: z.number().int().min(0).max(120).nullable(),
  }).strict(),
]);

export const pensionRecordsDataSchema = z.array(pensionRecordSchema).max(250).superRefine((records, ctx) => {
  const ids = new Set<string>();
  const links = new Set<number>();
  const stateOwners = new Set<number>();
  records.forEach((record, index) => {
    if (ids.has(record.id)) ctx.addIssue({ code: 'custom', path: [index, 'id'], message: 'Each scheme needs a unique ID' });
    ids.add(record.id);
    if (record.type === 'dc' && record.linkedAccountId !== null) {
      if (links.has(record.linkedAccountId)) ctx.addIssue({ code: 'custom', path: [index, 'linkedAccountId'], message: 'Link a ledger pension account to one scheme only' });
      links.add(record.linkedAccountId);
    }
    if (record.type === 'state' && record.ownerId !== null) {
      if (stateOwners.has(record.ownerId)) ctx.addIssue({ code: 'custom', path: [index, 'ownerId'], message: 'Keep one current State Pension forecast per person; update their existing forecast' });
      stateOwners.add(record.ownerId);
    }
  });
});

export const pensionRecordsPutSchema = z.object({
  data: pensionRecordsDataSchema,
  revision: z.number().int().nonnegative(),
}).strict();

export type PensionRecord = z.infer<typeof pensionRecordSchema>;
export type PensionRecordType = PensionRecord['type'];

export interface PensionAccount {
  id: number;
  name: string;
  ownerId: number | null;
  ownerName: string | null;
  balance: string;
  balanceAsOf: string;
}

export interface PensionOwner { id: number; name: string }

/** Validate relationships against current records before writing the inventory. */
export function validatePensionRecordLinks(records: PensionRecord[], owners: PensionOwner[], accounts: PensionAccount[]): string[] {
  const errors: string[] = [];
  const ownerIds = new Set(owners.map(owner => owner.id));
  const accountMap = new Map(accounts.map(account => [account.id, account]));
  for (const record of records) {
    if (record.ownerId !== null && !ownerIds.has(record.ownerId)) errors.push(`${record.name}: the selected owner no longer exists`);
    if (record.type !== 'dc' || record.linkedAccountId === null) continue;
    const account = accountMap.get(record.linkedAccountId);
    if (!account) errors.push(`${record.name}: choose an existing ASSET investment account tagged pension`);
    else if (record.ownerId !== account.ownerId) errors.push(`${record.name}: the scheme owner must match the linked ledger account owner`);
  }
  return errors;
}
