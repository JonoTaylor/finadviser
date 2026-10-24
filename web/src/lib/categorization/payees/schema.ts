import { z } from 'zod';

const literal = z.string().trim().min(1).max(200).refine(value => !/[\u0000-\u001f\u007f]/.test(value), 'Use a single line of text.');
export const payeeSaveSchema = z.object({
  journalId: z.number().int().positive(),
  snapshot: z.string().regex(/^[a-f0-9]{32}$/),
  categoryId: z.number().int().positive(),
  payeeName: literal.max(100),
  purpose: literal.max(200).optional(),
  identityKind: z.enum(['merchant', 'description', 'bank_payee']),
  aliases: z.array(literal).max(8).optional(),
  memoryId: z.uuid().optional(),
  expectedRevision: z.number().int().positive().optional(),
}).strict().superRefine((input, context) => {
  if (Boolean(input.memoryId) !== Boolean(input.expectedRevision)) context.addIssue({ code: 'custom', message: 'Supply the current memory revision when changing an existing meaning.' });
});
export type PayeeSaveInput = z.infer<typeof payeeSaveSchema>;
export const payeeDisableSchema = z.object({ expectedRevision: z.number().int().positive() }).strict();

export const payeeScopeSchema = z.object({
  accountId: z.number().int().positive(), accountName: z.string(), accountType: z.enum(['ASSET', 'LIABILITY']),
  ownerId: z.number().int().positive().nullable(), direction: z.union([z.literal(-1), z.literal(1)]),
  currency: z.string().nullable(), propertyId: z.number().int().positive().nullable(),
}).strict();
export const payeeMemorySchema = z.object({
  id: z.uuid(), revision: z.number().int().positive(), status: z.enum(['active', 'disabled', 'conflicted']),
  scope: payeeScopeSchema, payeeName: z.string(), purpose: z.string().nullable(),
  categoryId: z.number().int().positive(), categoryName: z.string(), identityKind: z.enum(['merchant', 'description', 'bank_payee']),
  aliases: z.array(z.string()).max(9), sourceJournalId: z.number().int().positive().nullable(),
  createdAt: z.iso.datetime({ offset: true }), updatedAt: z.iso.datetime({ offset: true }),
}).strict();
export const payeeLearningContextSchema = z.object({
  record: z.object({ journalId: z.number().int().positive(), snapshot: z.string().regex(/^[a-f0-9]{32}$/),
    description: z.string(), merchantName: z.string().nullable(), categoryId: z.number().int().positive().nullable() }).strict(),
  scope: payeeScopeSchema.nullable(), identities: z.array(z.object({ kind: z.enum(['merchant', 'description', 'bank_payee']), value: z.string(), label: z.string() }).strict()),
  eligible: z.boolean(), reason: z.string().nullable(), existingMemory: payeeMemorySchema.nullable().optional(),
}).strict();
