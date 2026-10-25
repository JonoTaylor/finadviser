import { createHash } from 'node:crypto';
import { isIP } from 'node:net';
import { z } from 'zod';
import { knownServiceIdentity } from '@/lib/categorization/known-services';
import type { MerchantResearchInput, MerchantResearchQuery, MerchantResearchResult } from './types';

export const MERCHANT_RESEARCH_VERSION = 'merchant-research-v2';

const privateOrMovement = /\b(?:transfer|p2p|peer.to.peer|faster payment|standing order|beneficiary|sort code|account|iban|bacs|chaps|salary|payroll|payment to|payment from|sent to|received from|reference|ref|card ending)\b/i;
const instruction = /\b(?:ignore|instructions?|system prompt|developer|password|secret|token|execute|javascript|https?|www)\b/i;
const privateIdentifier = /(?:[@<>\[\]{}=\\\n\r]|(?:\d[ -]?){6,}|\b\d{1,4}[\/-]\d{1,2}[\/-]\d{1,4}\b|[£$€]|\b(?:gb|[a-z]{2})\d{2}[a-z\d]{10,}\b)/i;
const allowedName = /^[\p{L}\p{M}\p{N} &'’.,()*+\-]+$/u;
const privateAddressOrAmount = /(?:\b\d+\s+[\p{L} ]+\b(?:road|street|avenue|lane|drive|flat|apartment|close)\b|\b[A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2}\b|\b\d+[.,]\d{2}\b)/iu;
const merchantWrapper = /^(?:(?:SQ|TST|PAYPAL|ZETTLE|IZ|SUMUP)\s*\*\s*)/i;
const cardType = /^(?:(?:debit|credit) )?card(?: payment| purchase| transaction)?$|^(?:pos|point of sale)(?: payment| purchase)?$/i;
const commercialLabel = /\b(?:cafe|café|coffee|bean|restaurant|sushi|desserts?|bakery|pizza|bar|pub|hotel|parking|autopay|supermarket|grocer(?:y|ies)?|shops?|stores?|retail|cinema|theatre|gym|pharmacy|fuel|petrol|oil|ltd|limited|lt|fare)\b/iu;
const publicRetailBrand = /^(?:tesco|aldi|lidl|asda|sainsburys?|sainsbury's|waitrose|morrisons|ikea|starbucks)(?:\s|$)/i;
const movementHint = /\b(?:transfers?|savings?|investments?|salary|payroll|income|repayments?|refunds?|cash withdrawals?)\b/i;

type ResearchCandidate = {
  merchantName: string | null;
  description: string;
  transactionType: string | null;
  bankCategory?: string | null;
  legs?: readonly { accountType: string; amount: string }[];
};

const countries: Record<string, { name: string; cities: readonly string[] }> = {
  GBR: { name: 'United Kingdom', cities: ['London', 'Manchester', 'Edinburgh', 'Bristol', 'Glasgow', 'Birmingham'] },
  NOR: { name: 'Norway', cities: ['Bodo', 'Bodø', 'Sørvågen', 'Sorvagen', 'Oslo', 'Bergen'] },
  IDN: { name: 'Indonesia', cities: ['Tangerang', 'Jakarta', 'Denpasar', 'Ubud'] },
  MYS: { name: 'Malaysia', cities: ['Puchong', 'Petaling Jaya', 'Kuala Lumpur'] },
  ITA: { name: 'Italy', cities: ['Alghero', 'Rome', 'Roma', 'Milan', 'Milano', 'Naples', 'Napoli'] },
  MUS: { name: 'Mauritius', cities: [] },
  USA: { name: 'United States', cities: ['New York', 'San Francisco', 'McAlester'] },
  FRA: { name: 'France', cities: ['Paris', 'Lyon', 'Nice'] },
  ESP: { name: 'Spain', cities: ['Madrid', 'Barcelona', 'Valencia'] },
  PRT: { name: 'Portugal', cities: ['Lisbon', 'Lisboa', 'Porto'] },
  DEU: { name: 'Germany', cities: ['Berlin', 'Munich', 'Hamburg'] },
  IRL: { name: 'Ireland', cities: ['Dublin', 'Cork'] },
  NLD: { name: 'Netherlands', cities: ['Amsterdam', 'Rotterdam'] },
  SWE: { name: 'Sweden', cities: ['Stockholm', 'Gothenburg'] },
  DNK: { name: 'Denmark', cities: ['Copenhagen'] },
  THA: { name: 'Thailand', cities: ['Bangkok', 'Phuket'] },
  SGP: { name: 'Singapore', cities: [] },
  JPN: { name: 'Japan', cities: ['Tokyo', 'Osaka', 'Kyoto'] },
  AUS: { name: 'Australia', cities: ['Sydney', 'Melbourne'] },
  NZL: { name: 'New Zealand', cities: ['Auckland', 'Wellington'] },
};

function normalise(value: string): string {
  return value.normalize('NFKC').replace(/\s+/g, ' ').trim();
}

/** A reference is removed only when a precise service identifier establishes its identity. */
function publicServiceName(value: string): string {
  const identity = knownServiceIdentity({ merchantName: value, description: value });
  if (identity === 'plex-subscription') return 'Plex subscription';
  if (identity === 'google-storage') return 'Google One';
  return value;
}

function knownRetailDescriptor(value: string): { merchantName: string; coarseLocation: string } | null {
  if (/[\r\n]/.test(value)) return null;
  const descriptor = normalise(value);
  if (/^NARVESEN(?:\s+\d{1,4})?\s+(?:BODO|BODØ)(?:\s+LUFT)?(?:\s+(?:BODO|BODØ))?\s+NOR$/iu.test(descriptor)) {
    return { merchantName: 'Narvesen', coarseLocation: 'Bodo Norway' };
  }
  if (/^JOKER\s+(?:SØRVÅGEN|SORVAGEN)(?:\s+(?:SØRVÅGEN|SORVAGEN))?\s+NOR$/iu.test(descriptor)) {
    return { merchantName: 'Joker', coarseLocation: 'Sørvågen Norway' };
  }
  return null;
}

/** Public identity basis only: this does not prove a card payment or items bought. */
export function recognisedRetailDescriptorBasis(candidate: Pick<ResearchCandidate, 'merchantName' | 'description' | 'transactionType'>): boolean {
  return knownRetailDescriptor(candidate.description) !== null
    || (candidate.merchantName !== null && knownRetailDescriptor(candidate.merchantName) !== null);
}

function cleanCardDescriptor(value: string): { descriptor: string; wrapped: boolean } | null {
  if (!value || value.length > 200 || /[\r\n]/.test(value)) return null;
  let descriptor = normalise(value);
  // Strip fixed bank syntax only; arbitrary reference and numeric segments stay screened.
  descriptor = descriptor.replace(/\s+ON\s+\d{1,2}[\/-]\d{1,2}[\/-]\d{2,4}\s*$/i, '');
  descriptor = descriptor.replace(/\s+(?:CARD\s+)?ENDING\s+(?:IN\s+)?\d{4}\s*$/i, '');
  const wrapper = /^(?:(?:(?:DEBIT|CREDIT)\s+)?CARD\s+(?:PAYMENT|PURCHASE|TRANSACTION)(?:\s+TO)?|POS(?:\s+PURCHASE)?)\s+/i;
  const wrapped = wrapper.test(descriptor);
  return { descriptor: descriptor.replace(wrapper, '').replace(merchantWrapper, ''), wrapped };
}

function descriptorLocation(value: string, merchantName: string): { coarseLocation: string; withoutCountry: string } | null {
  const cleaned = cleanCardDescriptor(value);
  const descriptor = cleaned?.descriptor;
  if (!descriptor || privateIdentifier.test(descriptor) || privateAddressOrAmount.test(descriptor)
    || privateOrMovement.test(descriptor) || instruction.test(descriptor)) return null;
  const terminal = /\s+([A-Z]{3})$/i.exec(descriptor);
  const country = terminal ? countries[terminal[1].toUpperCase()] : undefined;
  if (!country || !terminal) return null;
  const withoutCountry = descriptor.slice(0, terminal.index).trim();
  const escapedMerchant = merchantName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+');
  const prefix = new RegExp(`^${escapedMerchant}(?:\\s+|$)`, 'iu');
  // A memo mentioning a place is not merchant location evidence: the descriptor
  // must begin with the actual screened business name (optionally repeated).
  if (!prefix.test(withoutCountry)) return null;
  const remainder = withoutCountry.replace(prefix, '').replace(prefix, '').trim();
  const city = country.cities.find(name => normalise(name).toLocaleLowerCase('en-GB') === remainder.toLocaleLowerCase('en-GB'));
  return { coarseLocation: city ? `${city} ${country.name}` : country.name, withoutCountry };
}

/** Fail closed rather than exporting a raw transaction narrative as a web query. */
export function buildMerchantResearchQuery(input: MerchantResearchInput): MerchantResearchQuery | null {
  if (!input.merchantName || typeof input.merchantName !== 'string') return null;
  if (/[\r\n]/.test(input.merchantName)) return null;
  const original = publicServiceName(normalise(input.merchantName)).replace(merchantWrapper, '');
  if (original.length > 120 || privateIdentifier.test(original) || privateAddressOrAmount.test(original) || instruction.test(original)
    || privateOrMovement.test(original) || privateOrMovement.test((input.transactionType ?? '').replace(/[_-]+/g, ' '))) return null;
  // Payment processors may prefix the public trading name. Keep only that name.
  const merchantName = normalise(original);
  if (merchantName.length < 3 || merchantName.length > 120 || !allowedName.test(merchantName)
    || merchantName.split(' ').length > 12 || !/\p{L}{2}/u.test(merchantName)) return null;
  const foldedName = merchantName.toLocaleLowerCase('en-GB');
  for (const name of input.privateNames ?? []) {
    const foldedPrivate = normalise(name).toLocaleLowerCase('en-GB');
    const compactName = foldedName.replace(/[^\p{L}\p{N}]/gu, '');
    const compactPrivate = foldedPrivate.replace(/[^\p{L}\p{N}]/gu, '');
    if (foldedPrivate.length >= 3 && (foldedName.includes(foldedPrivate) || foldedPrivate.includes(foldedName)
      || (compactPrivate.length >= 3 && (compactName.includes(compactPrivate) || compactPrivate.includes(compactName))))) return null;
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
 * Structured merchant metadata is preferred. Explicit card purchases may use a
 * screened business descriptor, while metadata-free imports need a known chain.
 * Never export a general journal memo, person-to-person reference or account name.
 */
export function merchantResearchInputFromCandidate(
  candidate: ResearchCandidate,
  privateNames: readonly string[] = [],
): MerchantResearchInput | null {
  const type = normalise(candidate.transactionType ?? '').replace(/[_-]+/g, ' ');
  const bankHint = normalise(candidate.bankCategory ?? '').replace(/[_-]+/g, ' ');
  if (privateOrMovement.test(type) || movementHint.test(type) || privateOrMovement.test(bankHint) || movementHint.test(bankHint)) return null;
  if (candidate.legs !== undefined) {
    const financial = candidate.legs.filter(leg => leg.accountType === 'ASSET' || leg.accountType === 'LIABILITY');
    if (financial.length !== 1 || !Number.isFinite(Number(financial[0].amount)) || Number(financial[0].amount) >= 0) return null;
  }
  const chain = knownRetailDescriptor(candidate.description)
    ?? (candidate.merchantName ? knownRetailDescriptor(candidate.merchantName) : null);
  if (chain && candidate.merchantName) {
    const structured = normalise(candidate.merchantName).replace(merchantWrapper, '');
    const sameChain = chain.merchantName === 'Narvesen' ? /^narvesen(?:\s+\d{1,4})?$/i.test(structured) : /^joker$/i.test(structured);
    if (!sameChain && knownRetailDescriptor(structured)?.merchantName !== chain.merchantName) return null;
  }
  let merchantName = chain?.merchantName ?? (candidate.merchantName ? publicServiceName(candidate.merchantName.trim()).replace(merchantWrapper, '') : null);
  let coarseLocation = chain?.coarseLocation;
  if (!merchantName) {
    if (!cardType.test(type)) return null;
    const cleaned = cleanCardDescriptor(candidate.description);
    if (!cleaned || (!commercialLabel.test(cleaned.descriptor) && !publicRetailBrand.test(cleaned.descriptor))) return null;
    // A country tag provides public location, not permission to search any name.
    // Require a business label/known brand as well as card context.
    const terminal = /\s+([A-Z]{3})$/i.exec(cleaned.descriptor);
    const country = terminal ? countries[terminal[1].toUpperCase()] : undefined;
    if (!cleaned.wrapped && !country) return null;
    merchantName = country && terminal ? cleaned.descriptor.slice(0, terminal.index).trim() : cleaned.descriptor;
    if (/\d/.test(merchantName)) return null;
    if (country) coarseLocation = country.name;
  } else if (!cardType.test(type) && !chain) {
    // A structured name without a card type can still be a private payee.
    // Initials and plausible multiword personal names are not public businesses.
    const tokens = normalise(merchantName).split(' ');
    const namedService = knownServiceIdentity({ merchantName: merchantName, description: candidate.description }) !== null;
    if (!namedService && !commercialLabel.test(merchantName) && !publicRetailBrand.test(merchantName)
      && tokens.length >= 2 && tokens.length <= 4 && tokens.every(token => /^[\p{L}'’.-]+$/u.test(token))) return null;
  }
  coarseLocation ??= descriptorLocation(candidate.description, merchantName)?.coarseLocation;
  const input = { merchantName, transactionType: candidate.transactionType, privateNames, ...(coarseLocation ? { coarseLocation } : {}) };
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
