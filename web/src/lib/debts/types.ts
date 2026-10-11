import Decimal from 'decimal.js';
import { z } from 'zod';

const money = z.string().trim().regex(/^\d+(\.\d{1,2})?$/, 'Use a non-negative amount with at most 2 decimal places')
  .refine(value => !/^\d+(\.\d{1,2})?$/.test(value) || new Decimal(value).lt('1000000000000'), 'Amount is too large')
  .transform(value => new Decimal(value).toFixed(2));
const rate = z.string().trim().regex(/^\d+(\.\d{1,4})?$/, 'Use a percentage with at most 4 decimal places')
  .refine(value => !/^\d+(\.\d{1,4})?$/.test(value) || new Decimal(value).lte(1000), 'APR must be between 0 and 1,000%');
export const debtDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(value => {
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value && value >= '1900-01-01' && value <= '2200-12-31';
}, 'Use a valid calendar date');
const foreignId = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);

export const debtRecordSchema = z.object({
  id: z.uuid(),
  name: z.string().trim().min(1).max(160),
  accountId: foreignId.nullable(),
  ownerId: foreignId.nullable(),
  statementBalance: money.nullable(),
  statementAsOf: debtDateSchema.nullable(),
  apr: rate.nullable(),
  minimumPayment: money.nullable(),
  priority: z.boolean(),
  inArrears: z.boolean(),
  promotionalApr: rate.nullable(),
  promotionalExpiresOn: debtDateSchema.nullable(),
  paymentRestrictions: z.string().trim().max(1000),
  feeNotes: z.string().trim().max(1000),
}).strict().superRefine((debt, context) => {
  if (debt.accountId === null && (debt.statementBalance === null || debt.statementAsOf === null)) {
    context.addIssue({ code: 'custom', path: ['statementBalance'], message: 'An unlinked debt needs a statement balance and date' });
  }
  if (debt.accountId !== null && (debt.statementBalance !== null || debt.statementAsOf !== null)) {
    context.addIssue({ code: 'custom', path: ['statementBalance'], message: 'Linked debts use their ledger balance; remove the statement balance and date' });
  }
  if ((debt.promotionalApr === null) !== (debt.promotionalExpiresOn === null)) {
    context.addIssue({ code: 'custom', path: ['promotionalApr'], message: 'Enter both the promotional APR and its expiry date' });
  }
});

export const debtWorkspaceSchema = z.object({ debts: z.array(debtRecordSchema).max(200) }).strict()
  .superRefine(({ debts }, context) => {
    const ids = new Set<string>();
    const accounts = new Set<number>();
    debts.forEach((debt, index) => {
      if (ids.has(debt.id)) context.addIssue({ code: 'custom', path: ['debts', index, 'id'], message: 'Duplicate debt ID' });
      ids.add(debt.id);
      if (debt.accountId !== null) {
        if (accounts.has(debt.accountId)) context.addIssue({ code: 'custom', path: ['debts', index, 'accountId'], message: 'Link each liability account only once' });
        accounts.add(debt.accountId);
      }
    });
  });

export const debtPutSchema = z.object({ data: debtWorkspaceSchema, revision: z.number().int().nonnegative() }).strict();
export type DebtRecord = z.infer<typeof debtRecordSchema>;
export type DebtWorkspaceData = z.infer<typeof debtWorkspaceSchema>;

export interface ResolvedDebt extends DebtRecord {
  effectiveBalance: string | null;
  balanceAsOf: string | null;
  balanceSource: 'ledger' | 'statement' | 'unavailable';
  accountName: string | null;
  sourceWarning: string | null;
}

export interface LiabilityChoice { id: number; name: string; ownerId: number | null; balance: string; }
export interface DebtOwnerChoice { id: number; name: string; }
export interface DebtWorkspaceResponse {
  workspace: { version: 1; revision: number; updatedAt: string | null; data: DebtWorkspaceData };
  accounts: LiabilityChoice[];
  owners: DebtOwnerChoice[];
  debts: ResolvedDebt[];
  asOf: string;
}
