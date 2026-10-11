import { z } from 'zod';

export const reviewDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(value => {
  const parsed = new Date(`${value}T00:00:00Z`);
  return Number(value.slice(0, 4)) > 0 && Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}, 'Use a valid calendar date');
const money = z.string().regex(/^-?\d{1,13}\.\d{2}$/).nullable();
export const goalProgressSchema = z.object({
  id: z.number().int().positive(),
  name: z.string().min(1).max(500),
  targetAmount: z.string().regex(/^\d{1,13}\.\d{2}$/),
  currentAmount: z.string().regex(/^\d{1,13}\.\d{2}$/),
  targetDate: reviewDateSchema.nullable(),
  accountId: z.number().int().positive().nullable(),
  status: z.enum(['active', 'completed', 'cancelled']),
  progressPercent: z.number().finite().nonnegative().nullable(),
}).strict();
export const goalsProgressSchema = z.object({
  basis: z.literal('manual_progress'),
  goals: z.array(goalProgressSchema).max(250),
}).strict();
export type GoalsProgress = z.infer<typeof goalsProgressSchema>;
export const capturedGoalsSchema = z.discriminatedUnion('status', [
  z.object({ status: z.literal('ready'), data: goalsProgressSchema }).strict(),
  z.object({ status: z.literal('unavailable'), error: z.string().max(500) }).strict(),
]);
export const actionRecordSchema = z.object({
  id: z.string().min(1).max(180),
  status: z.enum(['planned', 'in_progress', 'completed', 'deferred', 'dismissed']),
  dueDate: reviewDateSchema.nullable(),
  note: z.string().max(2000),
  evidenceFingerprint: z.string().regex(/^[a-f0-9]{64}$/),
}).strict().refine(action => action.status !== 'deferred' || action.dueDate !== null, { path: ['dueDate'], message: 'Choose a date to review a deferred action' });
export type ActionRecord = z.infer<typeof actionRecordSchema>;
export const recurringReviewSchema = z.object({
  merchant: z.string().trim().min(1).max(160),
  status: z.enum(['confirmed', 'dismissed', 'changed']),
  note: z.string().max(2000),
  expectedMonthlySaving: z.string().regex(/^\d{1,12}(\.\d{1,2})?$/).nullable(),
}).strict();
export const reviewSnapshotSchema = z.object({
  id: z.uuid(),
  recordedAt: z.iso.datetime(),
  asOf: reviewDateSchema,
  scope: z.literal('household'),
  currency: z.literal('GBP'),
  selectedOwnerId: z.number().int().positive().nullable(),
  period: z.object({ start: reviewDateSchema, end: reviewDateSchema, monthsRecorded: z.number().int().min(0).max(3) }).strict(),
  metrics: z.object({ monthlyIncome: money, monthlySpending: money, monthlySurplus: money, netWorth: money, cashReserve: money, reserveShortfall: money, debt: money }).strict(),
  workspaceRevisions: z.record(z.string(), z.number().int().min(0)),
  warnings: z.array(z.string()).max(100),
  // Legacy snapshots predate goal capture. Manual goal progress is descriptive,
  // not an additional account balance or a component of recorded net worth.
  goals: capturedGoalsSchema.optional(),
}).strict();
export type ReviewSnapshot = z.infer<typeof reviewSnapshotSchema>;
export const reviewEditableSchema = z.object({
  actions: z.array(actionRecordSchema).max(250),
  recurring: z.array(recurringReviewSchema).max(250),
}).strict().superRefine((data, ctx) => {
  for (const key of ['actions', 'recurring'] as const) {
    const ids = data[key].map(item => 'id' in item ? item.id : item.merchant.toLowerCase());
    if (new Set(ids).size !== ids.length) ctx.addIssue({ code: 'custom', path: [key], message: 'Each action or merchant can be recorded once' });
  }
});
export const reviewsDataSchema = reviewEditableSchema.safeExtend({ snapshots: z.array(reviewSnapshotSchema).max(60) });
export type ReviewsData = z.infer<typeof reviewsDataSchema>;
export const initialReviews: ReviewsData = { actions: [], recurring: [], snapshots: [] };
export const REVIEWS_KEY = 'finance.reviews.v1';
export const reviewsPutSchema = z.object({
  revision: z.number().int().min(0).max(999_999_999),
  data: reviewEditableSchema,
}).strict();
export const reviewsPostSchema = z.object({ revision: z.number().int().min(0).max(999_999_999) }).strict();
