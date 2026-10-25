import type { CategorizationCandidate, CategorizationCategory } from './types';

/**
 * Specific service descriptors can establish purpose where a marketplace name
 * alone cannot. Keep these identifiers narrow: Xbox and Amazon on their own do
 * not identify a subscription, and bank names do not identify banking fees.
 */
const services = [
  {
    id: 'amazon-prime',
    merchantNames: ['amazon prime', 'amzn prime'],
    descriptor: /^(?:amazon prime|amzn prime)(?: amzn\.co\.uk\/pm)?(?: gbr)?$/i,
    categoryNames: ['Software & Subscriptions', 'Subscriptions'],
    reason: 'The statement identifies Amazon Prime membership, rather than an unspecified Amazon purchase.',
  },
  {
    id: 'xbox-game-pass',
    merchantNames: ['xbox game pass', 'microsoft xbox game pass'],
    descriptor: /^(?:microsoft\*xbox game pa(?:ss)?|xbox game pass)(?: msbill\.info)?(?: gbr)?$/i,
    categoryNames: ['Entertainment'],
    reason: 'The statement identifies Xbox Game Pass, an entertainment subscription, rather than an unspecified Microsoft or Xbox purchase.',
  },
  {
    id: 'monzo-membership',
    merchantNames: ['monzo plus', 'monzo premium', 'monzo perks'],
    descriptor: /^monzo (?:plus|premium|perks)(?: subscription| membership| monthly fee| fee)?$/i,
    categoryNames: ['Bank Fees & Charges', 'Bank Fees', 'Banking Fees', 'Bank Charges', 'Fees & Charges', 'Subscriptions', 'Software & Subscriptions'],
    reason: 'The statement identifies a Monzo account membership fee, rather than a transfer to a Monzo account.',
  },
  {
    id: 'plex-subscription',
    merchantNames: [],
    merchantDescriptor: /^plex sub invoice \d{1,12}$/i,
    descriptor: /^plex sub\* invoice \d{1,12}(?: (?:\+\d{7,15}|mcalester))? usa$/i,
    categoryNames: ['Entertainment', 'Software & Subscriptions', 'Subscriptions'],
    reason: 'The statement identifies a Plex subscription invoice. Changing invoice numbers do not change the service identity.',
  },
  {
    id: 'google-storage',
    merchantNames: ['google one', 'google storage'],
    descriptor: /^google (?:one|storage)(?: london)?(?: gbr)?$/i,
    categoryNames: ['Software & Subscriptions', 'Subscriptions'],
    reason: 'The statement identifies Google One or Google Storage, a cloud storage subscription.',
  },
] as const;

export type KnownServiceId = typeof services[number]['id'];
export type KnownServiceMatch = { serviceId: KnownServiceId; categoryId: number; reason: string };

function normalized(value: string | null): string {
  return (value ?? '').normalize('NFKC').replace(/\s+/g, ' ').trim().toLocaleLowerCase('en-GB');
}

/** Identity only; callers must still enforce account movement/category guards. */
export function knownServiceIdentity(candidate: Pick<CategorizationCandidate, 'merchantName' | 'description'>): KnownServiceId | null {
  // Do not accept a multiline memo merely because its whitespace can be folded.
  if (/[\r\n]/.test(candidate.description) || /[\r\n]/.test(candidate.merchantName ?? '')) return null;
  const merchant = normalized(candidate.merchantName);
  const description = normalized(candidate.description);
  const matches = services.filter(service => (service.merchantNames as readonly string[]).includes(merchant)
    || ('merchantDescriptor' in service && service.merchantDescriptor.test(merchant))
    || service.descriptor.test(description));
  return matches.length === 1 ? matches[0].id : null;
}

/**
 * No model confidence is promoted here. This returns a specific deterministic
 * classification only when statement identity, outgoing purchase context and
 * one unambiguous existing category agree. It never assigns property use.
 */
export function knownServiceMatch(candidate: CategorizationCandidate, categories: readonly CategorizationCategory[]): KnownServiceMatch | null {
  if (candidate.propertyId !== null) return null;
  const financial = candidate.legs.filter(leg => leg.accountType === 'ASSET' || leg.accountType === 'LIABILITY');
  if (financial.length !== 1 || !Number.isFinite(Number(financial[0].amount)) || Number(financial[0].amount) >= 0) return null;
  const type = normalized(candidate.transactionType).replace(/[_-]+/g, ' ');
  if (!/^(?:|(?:(?:debit|credit) )?card(?: payment| purchase| transaction)?|pos(?: payment| purchase)?|point of sale(?: payment| purchase)?|direct debit|subscription(?: payment)?|(?:bank )?fee)$/.test(type)) return null;
  if (/\b(?:transfers?|savings?|investments?|income|salary|refunds?|repayments?)\b/.test(normalized(candidate.bankCategory).replace(/[_-]+/g, ' '))) return null;
  const id = knownServiceIdentity(candidate);
  const service = services.find(value => value.id === id);
  if (!service) return null;
  for (const name of service.categoryNames) {
    const matches = categories.filter(category => normalized(category.name) === normalized(name));
    // Identically named categories in different branches need a user choice.
    if (matches.length > 1) return null;
    if (matches.length === 1) return { serviceId: service.id, categoryId: matches[0].id, reason: service.reason };
  }
  return null;
}
