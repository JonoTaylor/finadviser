import Decimal from 'decimal.js';
import { z } from 'zod';

export const PROPERTY_OPERATIONS_KEY = 'finance.property-operations.v1';
const propertyId = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
export const calendarDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(value => {
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}, 'Use a valid calendar date');
const money = z.string().regex(/^\d+(\.\d{1,2})?$/, 'Use a non-negative amount with up to two decimal places')
  .refine(value => new Decimal(value).lt('1000000000000'), 'Amount is too large')
  .transform(value => new Decimal(value).toFixed(2));

export const propertyObligationSchema = z.object({
  id: z.string().min(1).max(100).regex(/^[A-Za-z0-9_-]+$/),
  propertyId,
  title: z.string().trim().min(1).max(160),
  dueDate: calendarDateSchema,
  status: z.enum(['open', 'completed']),
  category: z.enum(['inspection', 'insurance', 'mortgage', 'tax', 'repair', 'other']),
}).strict();

export const propertyOperationsSchema = z.object({
  obligations: z.array(propertyObligationSchema).max(1000),
  reserveTargets: z.array(z.object({ propertyId, targetAmount: money.nullable() }).strict()).max(500),
}).strict().superRefine((data, ctx) => {
  if (new Set(data.obligations.map(row => row.id)).size !== data.obligations.length) {
    ctx.addIssue({ code: 'custom', path: ['obligations'], message: 'Obligation IDs must be unique' });
  }
  if (new Set(data.reserveTargets.map(row => row.propertyId)).size !== data.reserveTargets.length) {
    ctx.addIssue({ code: 'custom', path: ['reserveTargets'], message: 'A property can have only one reserve target' });
  }
});

export type PropertyObligation = z.infer<typeof propertyObligationSchema>;
export type PropertyOperationsData = z.infer<typeof propertyOperationsSchema>;
export const initialPropertyOperations: PropertyOperationsData = { obligations: [], reserveTargets: [] };

export function validatePropertyReferences(data: PropertyOperationsData, validIds: number[]): void {
  const known = new Set(validIds);
  if ([...data.obligations, ...data.reserveTargets].some(row => !known.has(row.propertyId))) {
    throw new UnknownPropertyError();
  }
}

export class UnknownPropertyError extends Error {
  constructor() {
    super('Choose an existing property for every obligation and reserve target. Refresh if a property has been removed.');
    this.name = 'UnknownPropertyError';
  }
}
