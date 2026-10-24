import { createHash } from 'node:crypto';
import { isIP } from 'node:net';
import { z } from 'zod';
import type { MerchantResearchInput, MerchantResearchQuery, MerchantResearchResult } from './types';

export const MERCHANT_RESEARCH_VERSION = 'merchant-research-v1';

const privateOrMovement = /\b(?:transfer|p2p|peer.to.peer|faster payment|standing order|beneficiary|sort code|account|iban|bacs|chaps|salary|payroll|payment to|payment from|sent to|received from|reference|ref|card ending)\b/i;
const instruction = /\b(?:ignore|instructions?|system prompt|developer|password|secret|token|execute|javascript|https?|www)\b/i;
const privateIdentifier = /(?:[@<>\[\]{}=\\\n\r]|(?:\d[ -]?){6,}|\b\d{1,4}[\/-]\d{1,2}[\/-]\d{1,4}\b|[£$€]|\b(?:gb|[a-z]{2})\d{2}[a-z\d]{10,}\b)/i;
const allowedName = /^[\p{L}\p{M}\p{N} &'’.,()*+\-]+$/u;
const privateAddressOrAmount = /(?:\b\d+\s+[\p{L} ]+\b(?:road|street|avenue|lane|drive|flat|apartment|close)\b|\b[A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2}\b|\b\d+[.,]\d{2}\b)/iu;

function normalise(value: string): string {
  return value.normalize('NFKC').replace(/\s+/g, ' ').trim();
}

/** Fail closed rather than exporting a raw transaction narrative as a web query. */
export function buildMerchantResearchQuery(input: MerchantResearchInput): MerchantResearchQuery | null {
  if (!input.merchantName || typeof input.merchantName !== 'string') return null;
  const original = input.merchantName.normalize('NFKC');
  if (original.length > 120 || privateIdentifier.test(original) || privateAddressOrAmount.test(original) || instruction.test(original)
    || privateOrMovement.test(original) || privateOrMovement.test((input.transactionType ?? '').replace(/[_-]+/g, ' '))) return null;
  // Payment processors may prefix the public trading name. Keep only that name.
  const merchantName = normalise(original).replace(/^(?:(?:SQ|TST|PAYPAL|ZETTLE|IZ|SUMUP)\s*\*\s*)/i, '');
  if (merchantName.length < 3 || merchantName.length > 120 || !allowedName.test(merchantName)
    || merchantName.split(' ').length > 12 || !/\p{L}{2}/u.test(merchantName)) return null;
  const foldedName = merchantName.toLocaleLowerCase('en-GB');
  for (const name of input.privateNames ?? []) {
    const foldedPrivate = normalise(name).toLocaleLowerCase('en-GB');
    if (foldedPrivate.length >= 3 && (foldedName.includes(foldedPrivate) || foldedPrivate.includes(foldedName))) return null;
  }
  // Town/city or country only: never a house number, postcode or street address.
  let coarseLocation: string | null = null;
  if (input.coarseLocation) {
    const location = normalise(input.coarseLocation);
    if (location.length > 60 || !/^[\p{L}\p{M} .,'’\-]+$/u.test(location)
      || location.split(' ').length > 5 || /\b(?:road|street|avenue|lane|drive|flat|apartment|close|postcode)\b/i.test(location)
      || instruction.test(location) || privateOrMovement.test(location)) return null;
    coarseLocation = location;
  }
  const query = `${merchantName}${coarseLocation ? ` ${coarseLocation}` : ''} business merchant`;
  if (query.length > 200) return null;
  const cacheKey = createHash('sha256').update(JSON.stringify([
    MERCHANT_RESEARCH_VERSION, 'gateway_perplexity', foldedName,
    coarseLocation?.toLocaleLowerCase('en-GB') ?? null,
  ])).digest('hex');
  return { merchantName, coarseLocation, query, cacheKey };
}

/**
 * Structured merchant metadata is preferred. Only explicit card purchases may
 * fall back to a short descriptor after recognisable bank wrappers are removed.
 * Never export a general journal memo, person-to-person reference or account name.
 */
export function merchantResearchInputFromCandidate(
  candidate: { merchantName: string | null; description: string; transactionType: string | null },
  privateNames: readonly string[] = [],
): MerchantResearchInput | null {
  let merchantName = candidate.merchantName?.trim() || null;
  if (!merchantName) {
    const type = (candidate.transactionType ?? '').replace(/[_-]+/g, ' ').trim();
    if (!/^(?:(?:debit|credit) )?card(?: payment| purchase| transaction)?$|^(?:pos|point of sale)(?: payment| purchase)?$/i.test(type)) return null;
    if (!candidate.description || candidate.description.length > 200 || /[\r\n]/.test(candidate.description)) return null;
    let descriptor = candidate.description.trim();
    // Remove only fixed bank wrappers, not arbitrary numeric segments in a memo.
    descriptor = descriptor.replace(/\s+ON\s+\d{1,2}[\/-]\d{1,2}[\/-]\d{2,4}\s*$/i, '');
    descriptor = descriptor.replace(/\s+(?:CARD\s+)?ENDING\s+(?:IN\s+)?\d{4}\s*$/i, '');
    const wrapper = /^(?:(?:(?:DEBIT|CREDIT)\s+)?CARD\s+(?:PAYMENT|PURCHASE|TRANSACTION)(?:\s+TO)?|POS(?:\s+PURCHASE)?)\s+/i;
    // A card type alone does not make a free-form journal memo public.
    if (!wrapper.test(descriptor)) return null;
    descriptor = descriptor.replace(wrapper, '');
    // Any remaining number may be a private reference, address or amount.
    if (/\d/.test(descriptor)) return null;
    merchantName = descriptor;
  }
  const input = { merchantName, transactionType: candidate.transactionType, privateNames };
  return buildMerchantResearchQuery(input) ? input : null;
}

/** Citations are displayed only; the application never fetches a result URL. */
export function isSafePublicSourceUrl(value: string): boolean {
  if (value.length > 2048) return false;
  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase().replace(/\.$/, '');
    const literal = host.replace(/^\[|\]$/g, '');
    return url.protocol === 'https:' && !url.username && !url.password && (!url.port || url.port === '443')
      && !isIP(literal) && host.includes('.') && /^[a-z0-9.-]+$/.test(host)
      && !/(?:^|\.)(?:localhost|local|internal|test|invalid|example|onion)$/.test(host)
      && !/(?:^|\.)(?:localhost|localdomain)$/.test(host)
      && host !== 'metadata.google.internal';
  } catch { return false; }
}

const sourceSchema = z.object({
  title: z.string().trim().min(1).max(200),
  url: z.string().refine(isSafePublicSourceUrl),
  snippet: z.string().trim().min(1).max(1200),
  retrievedAt: z.string().datetime({ offset: true }),
}).strict();
const resultSchema = z.object({
  status: z.enum(['matched', 'no_matches', 'unavailable', 'timed_out', 'skipped_private']),
  query: z.string().min(1).max(200).nullable(),
  sources: z.array(sourceSchema).max(3),
  researchedAt: z.string().datetime({ offset: true }),
  provider: z.literal('gateway_perplexity'),
  scope: z.literal('merchant_identity_only'),
}).strict();

/** Revalidate cached/provider data before passing it to a model or UI. */
export function validateMerchantResearchResult(value: unknown): MerchantResearchResult | null {
  const parsed = resultSchema.safeParse(value);
  if (!parsed.success) return null;
  const result = parsed.data;
  if ((result.status === 'matched') !== (result.sources.length > 0)) return null;
  if (result.status === 'skipped_private') return result.query === null ? result : null;
  if (!result.query || privateIdentifier.test(result.query) || privateAddressOrAmount.test(result.query) || instruction.test(result.query)
    || privateOrMovement.test(result.query) || !allowedName.test(result.query)) return null;
  return result;
}
