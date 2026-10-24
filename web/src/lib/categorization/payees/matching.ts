import { createHash } from 'node:crypto';
import type { CategorizationCandidate, CategorizationCategory } from '../types';
import type { PayeeIdentity, PayeeMemory, PayeeScope, PayeeMatch } from './types';

/** Exact canonical identity only. Never remove arbitrary references or use substring matching. */
export function normalizePayeeAlias(value: string): string {
  return value.normalize('NFKC').replace(/\s+/gu, ' ').trim().toLocaleLowerCase('en-GB');
}

export function isGenericPayeeIdentity(value: string): boolean {
  return /^(?:amazon(?: marketplace| retail| uk)?|amzn(?:mktp|mktplace)?|ebay|etsy|paypal|stripe|square|sumup|zettle|izettle|klarna|clearpay|bank transfer|faster payments?|standing order|transfer|card payment|direct debit|cash withdrawal|unknown|uncategorised|uncategorized)$/i.test(normalizePayeeAlias(value));
}

export function payeeScope(candidate: CategorizationCandidate): PayeeScope | null {
  const legs = candidate.legs.filter(leg => leg.accountType === 'ASSET' || leg.accountType === 'LIABILITY');
  if (legs.length !== 1 || !Number.isFinite(Number(legs[0].amount)) || Number(legs[0].amount) === 0) return null;
  const leg = legs[0];
  return { accountId: leg.accountId, accountName: leg.accountName, accountType: leg.accountType as 'ASSET' | 'LIABILITY',
    ownerId: leg.ownerId, direction: Number(leg.amount) < 0 ? -1 : 1,
    currency: candidate.currency?.trim().toUpperCase() || null, propertyId: candidate.propertyId };
}

export function payeeScopeKey(scope: PayeeScope): string {
  return createHash('sha256').update(JSON.stringify([
    'confirmed-payee-v1', scope.accountId, scope.accountType, scope.ownerId, scope.direction, scope.currency, scope.propertyId,
  ])).digest('hex');
}

/** A deliberately narrow bank format: recipient and reference have explicit delimiters. */
export const BANK_PAYEE_PATTERN = '^(?:PAYMENT TO|FASTER PAYMENT TO|TRANSFER TO|STANDING ORDER TO)\\s+(.{1,100}?)\\s+(?:REF(?:ERENCE)?[.:]?|REFERENCE[.:]?)\\s+\\S.{0,150}$';
function bankPayee(candidate: CategorizationCandidate): string | null {
  const type = (candidate.transactionType ?? '').replace(/[_-]+/g, ' ').trim();
  if (!/^(?:bank transfer|faster payment|faster payments|bacs|standing order|payment)$/i.test(type)) return null;
  if ((candidate.description.match(/\bREF(?:ERENCE)?[.:]?(?=\s)/gi) ?? []).length !== 1) return null;
  const match = new RegExp(BANK_PAYEE_PATTERN, 'i').exec(candidate.description.trim());
  const recipient = match?.[1]?.trim();
  return recipient && !/[\u0000-\u001f\u007f<>\[\]{}]/.test(recipient) ? recipient : null;
}

export function payeeIdentities(candidate: CategorizationCandidate): PayeeIdentity[] {
  const identities: PayeeIdentity[] = [];
  const merchant = candidate.merchantName?.trim();
  if (merchant && merchant.length <= 200 && !isGenericPayeeIdentity(merchant)) identities.push({ kind: 'merchant', value: merchant, label: 'Exact merchant or recipient name' });
  const bank = bankPayee(candidate);
  if (bank && !isGenericPayeeIdentity(bank)) identities.push({ kind: 'bank_payee', value: bank, label: 'Bank recipient before the reference' });
  if (candidate.description.trim() && candidate.description.length <= 200 && !isGenericPayeeIdentity(candidate.description)) identities.push({ kind: 'description', value: candidate.description.trim(), label: 'Exact statement description' });
  return identities;
}

/** A conflict is uncertainty, never an arbitrary priority between two meanings. */
export function matchingConfirmedPayees(candidate: CategorizationCandidate, memories: readonly PayeeMemory[], categories: readonly CategorizationCategory[]): PayeeMatch[] {
  const scope = payeeScope(candidate);
  if (!scope) return [];
  const key = payeeScopeKey(scope);
  const categoryIds = new Set(categories.map(category => category.id));
  const identities = payeeIdentities(candidate);
  return memories.flatMap(memory => {
    if (memory.status !== 'active' || payeeScopeKey(memory.scope) !== key || !categoryIds.has(memory.categoryId)) return [];
    const identity = identities.find(value => value.kind === memory.identityKind
      && memory.aliases.some(alias => normalizePayeeAlias(alias) === normalizePayeeAlias(value.value)));
    return identity ? [{ memory, identity }] : [];
  });
}

export function matchConfirmedPayee(candidate: CategorizationCandidate, memories: readonly PayeeMemory[], categories: readonly CategorizationCategory[]): PayeeMatch | null {
  const matches = matchingConfirmedPayees(candidate, memories, categories);
  if (new Set(matches.map(match => match.memory.categoryId)).size !== 1) return null;
  // Multiple meanings are ambiguous even if they currently use the same category.
  return matches.length === 1 ? matches[0] : null;
}
