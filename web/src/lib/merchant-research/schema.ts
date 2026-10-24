import { z } from 'zod';
import { isSafePublicSourceUrl, validateMerchantResearchResult } from './privacy';
import type { MerchantResearchResult } from './types';

export const merchantResearchSourceSchema = z.object({
  title: z.string().trim().min(1).max(200),
  url: z.string().max(2048).refine(isSafePublicSourceUrl),
  snippet: z.string().trim().min(1).max(1200),
  retrievedAt: z.iso.datetime({ offset: true }),
}).strict();

export const merchantResearchResultSchema = z.object({
  status: z.enum(['matched', 'no_matches', 'unavailable', 'timed_out', 'skipped_private']),
  query: z.string().trim().min(1).max(200).nullable(),
  sources: z.array(merchantResearchSourceSchema).max(3),
  researchedAt: z.iso.datetime({ offset: true }),
  provider: z.literal('gateway_perplexity'),
  scope: z.literal('merchant_identity_only'),
}).strict().superRefine((result, context) => {
  if (!validateMerchantResearchResult(result)) {
    context.addIssue({ code: 'custom', message: 'Research must contain only a valid public merchant query.' });
  }
  if (result.status === 'matched' && (result.query === null || result.sources.length === 0)) {
    context.addIssue({ code: 'custom', message: 'Merchant research needs a public query and actual cited sources.' });
  }
  if (result.status !== 'matched' && result.sources.length !== 0) {
    context.addIssue({ code: 'custom', message: 'Unavailable merchant research cannot supply evidence.' });
  }
});

/** Only actual, validated public sources are persisted as category evidence. */
export const merchantResearchEvidenceSchema = merchantResearchResultSchema.refine(result => result.status === 'matched');

export function parseMerchantResearchEvidence(value: unknown): MerchantResearchResult | null {
  const parsed = merchantResearchEvidenceSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}
