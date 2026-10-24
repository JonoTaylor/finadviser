import { describe, expect, it } from 'vitest';
import type { CategorizationCandidate } from '../types';
import type { PayeeMemory } from './types';
import { matchConfirmedPayee, matchingConfirmedPayees, normalizePayeeAlias, payeeIdentities, payeeScope, payeeScopeKey } from './matching';

const candidate = (overrides: Partial<CategorizationCandidate> = {}): CategorizationCandidate => ({
  id: 1, date: '2026-10-01', description: 'PAYMENT TO Avery REF October cleaning', merchantName: null,
  propertyId: null, transactionType: 'BANK_TRANSFER', bankCategory: null, currency: 'GBP', snapshot: 'fixture',
  legs: [{ accountId: 11, accountName: 'Home bank', accountType: 'ASSET', ownerId: 1, amount: '-40.00' }], ...overrides,
});
const profile = (overrides: Partial<PayeeMemory> = {}): PayeeMemory => ({
  id: '7f867206-621c-463d-b803-14d91558bc67', revision: 1, status: 'active', scope: payeeScope(candidate())!,
  payeeName: 'Avery', purpose: 'Household cleaner', categoryId: 1, categoryName: 'Cleaning', identityKind: 'bank_payee', aliases: ['Avery'],
  sourceJournalId: 1, createdAt: '2026-10-24T12:00:00.000Z', updatedAt: '2026-10-24T12:00:00.000Z', ...overrides,
});
const categories = [{ id: 1, name: 'Cleaning' }, { id: 2, name: 'Pets' }];

describe('private confirmed payee identity', () => {
  it('matches an explicitly confirmed bank recipient across changing dates, amounts and references', () => {
    const next = candidate({ id: 2, date: '2026-11-01', description: 'PAYMENT TO AVERY REF November service', legs: [{ ...candidate().legs[0], amount: '-55.00' }] });
    expect(matchConfirmedPayee(next, [profile()], categories)?.memory.id).toBe(profile().id);
    expect(normalizePayeeAlias('Ａｖｅｒｙ')).toBe('avery');
  });
  it.each([
    { propertyId: 2 }, { currency: 'EUR' },
    { legs: [{ ...candidate().legs[0], accountId: 21 }] },
    { legs: [{ ...candidate().legs[0], ownerId: 2 }] },
    { legs: [{ ...candidate().legs[0], amount: '40.00' }] },
  ])('keeps account, owner, direction, currency and property scopes distinct: %j', overrides => {
    expect(matchConfirmedPayee(candidate(overrides), [profile()], categories)).toBeNull();
  });
  it('never turns a name substring or a different person into the remembered recipient', () => {
    for (const description of ['PAYMENT TO Avery Jones REF October', 'PAYMENT TO Averyn REF October', 'Rent for Avery', 'PAYMENT TO Avery October', 'PAYMENT TO Avery Ref Services REF October']) {
      expect(matchConfirmedPayee(candidate({ description }), [profile()], categories)).toBeNull();
    }
  });
  it('requires an explicit known bank wrapper and payment type', () => {
    expect(payeeIdentities(candidate({ transactionType: 'Card payment' })).some(identity => identity.kind === 'bank_payee')).toBe(false);
    expect(payeeIdentities(candidate({ description: 'Avery REF October' })).some(identity => identity.kind === 'bank_payee')).toBe(false);
  });
  it('does not offer generic processors or transfer labels as personal identities', () => {
    for (const generic of ['PayPal', 'Faster Payments', 'Bank transfer', 'Amazon Marketplace']) {
      expect(payeeIdentities(candidate({ description: generic, merchantName: generic }))).toEqual([]);
    }
  });
  it('makes conflicting personal meanings explicit rather than selecting one or falling back to a model guess', () => {
    const two = [profile(), profile({ id: 'b0d05dbe-02d8-419c-a244-335f18a2d223', categoryId: 2 })];
    expect(matchingConfirmedPayees(candidate(), two, categories)).toHaveLength(2);
    expect(matchConfirmedPayee(candidate(), two, categories)).toBeNull();
  });
  it('does not use disabled knowledge or deleted categories', () => {
    expect(matchConfirmedPayee(candidate(), [profile({ status: 'disabled' })], categories)).toBeNull();
    expect(matchConfirmedPayee(candidate(), [profile()], [])).toBeNull();
  });
  it('does not expose private names in its deterministic scope key', () => {
    expect(payeeScopeKey(profile().scope)).toMatch(/^[a-f0-9]{64}$/);
    expect(payeeScopeKey({ ...profile().scope, accountName: 'Renamed bank' })).toBe(payeeScopeKey(profile().scope));
  });
});
