import { z } from 'zod';

// Shared with the browser; this file deliberately imports no database or Node APIs.
const evidenceSchema = z.object({
  status: z.literal('matched'), query: z.string(),
  sources: z.array(z.object({ title: z.string(), url: z.string(), snippet: z.string(), retrievedAt: z.string() }).strict()).min(1).max(3),
  researchedAt: z.string(), provider: z.literal('gateway_perplexity'), scope: z.literal('merchant_identity_only'),
}).strict();
export const categorizationActivitySchema = z.object({
  counts: z.object({ standard: z.number().int().nonnegative(), estimated: z.number().int().nonnegative(), broad: z.number().int().nonnegative() }).strict(),
  items: z.array(z.object({
    journalId: z.number().int().positive(), date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    description: z.string(), merchantName: z.string().nullable(), categoryId: z.number().int().positive(), categoryName: z.string(),
    assignmentKind: z.enum(['standard', 'estimated', 'broad']), confidence: z.number().finite().min(0).max(1).nullable(),
    reason: z.string(), currency: z.string().nullable(), amount: z.string().regex(/^-?\d+(?:\.\d+)?$/).nullable(),
    updatedAt: z.iso.datetime({ offset: true }), evidence: evidenceSchema.nullable().optional(),
  }).strict()).max(20),
  observedAt: z.iso.datetime({ offset: true }),
}).strict().refine(value => new Set(value.items.map(item => item.journalId)).size === value.items.length);
export type CategorizationActivity = z.infer<typeof categorizationActivitySchema>;
