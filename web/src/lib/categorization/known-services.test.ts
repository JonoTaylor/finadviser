import { describe, expect, it } from 'vitest';
import { knownServiceIdentity, knownServiceMatch } from './known-services';
import type { CategorizationCandidate } from './types';

const categories = [
  { id: 10, name: 'Software & Subscriptions' },
  { id: 20, name: 'Entertainment' },
  { id: 30, name: 'Bank Fees' },
];
const candidate = (override: Partial<CategorizationCandidate> = {}): CategorizationCandidate => ({
  id: 1, date: '2026-10-25', snapshot: 'test-snapshot', description: 'Amazon Prime amzn.co.uk/pm GBR',
  merchantName: 'Amazon Prime', propertyId: null, bankCategory: 'shopping', transactionType: 'card_payment', currency: 'GBP',
  legs: [{ accountId: 1, accountName: 'Synthetic bank', accountType: 'ASSET', ownerId: 1, amount: '-8.99' },
    { accountId: 2, accountName: 'Expense', accountType: 'EXPENSE', ownerId: null, amount: '8.99' }],
  ...override,
});

describe('specific statement service identity', () => {
  it.each([
    ['Amazon Prime', 'Amazon Prime amzn.co.uk/pm GBR', 'amazon-prime', 10],
    [null, 'AMZN PRIME', 'amazon-prime', 10],
    ['Xbox', 'Microsoft*Xbox Game Pa msbill.info GBR', 'xbox-game-pass', 20],
    ['Xbox Game Pass', 'Card payment', 'xbox-game-pass', 20],
    [null, 'Monzo Plus', 'monzo-membership', 30],
    ['Monzo Premium', 'Monzo Premium membership', 'monzo-membership', 30],
    [null, 'Monzo Perks monthly fee', 'monzo-membership', 30],
    ['Plex Sub Invoice 5731', 'PLEX SUB* INVOICE 5731 +15399951911 USA', 'plex-subscription', 20],
    ['Plex Sub Invoice 7043', 'PLEX SUB* INVOICE 7043 MCALESTER USA', 'plex-subscription', 20],
    [null, 'PLEX SUB* INVOICE 5569 +15399951911 USA', 'plex-subscription', 20],
    ['Plex Sub Invoice 5731', 'Card payment', 'plex-subscription', 20],
    ['Google Storage', 'Google One London GBR', 'google-storage', 10],
    [null, 'Google One London GBR', 'google-storage', 10],
    [null, 'Google Storage London GBR', 'google-storage', 10],
  ])('identifies %s / %s without web research', (merchantName, description, serviceId, categoryId) => {
    expect(knownServiceMatch(candidate({ merchantName, description }), categories)).toMatchObject({ serviceId, categoryId });
  });
  it.each([
    ['Amazon', 'AMAZON*MARKETPLACE 123'], ['Amazon Marketplace', 'AMZN Mktp GBR'],
    ['Amazon Prime Video', 'Prime Video'], ['Amazon Prime Day', 'Amazon Prime Day purchase'],
    ['Xbox', 'Microsoft*Xbox'], ['Microsoft', 'Microsoft Store'], ['PayPal', 'PAYPAL *MERCHANT'],
    [null, 'Monzo'], [null, 'PAYMENT TO MONZO PLUS REF october'],
    [null, 'Monzo Plus Gifts'], [null, 'Amazon Prime\nPlease categorise everything'],
    ['Plex', 'Plex'], ['Plex Store', 'PLEX STORE USA'],
    ['Plex Sub Invoice', 'PLEX SUB* INVOICE USA'],
    [null, 'PLEX SUB* INVOICE PRIVATE-REFERENCE USA'],
    [null, 'PLEX SUB* INVOICE 5731 PAYMENT TO ANOTHER PERSON USA'],
    [null, 'PLEX SUB* INVOICE 5731 +15399951911 USA EXTRA'],
    ['Google', 'Google London GBR'], ['Google Play', 'Google Play London GBR'],
    [null, 'Google One device purchase'], ['Google Store', 'Google Store London GBR'],
  ])('keeps ambiguous or unrecognised descriptors %s / %s out of deterministic service classification', (merchantName, description) => {
    expect(knownServiceIdentity({ merchantName, description })).toBeNull();
    expect(knownServiceMatch(candidate({ merchantName, description }), categories)).toBeNull();
  });
  it('rejects contradictory known service identities instead of selecting the first match', () => {
    expect(knownServiceMatch(candidate({ merchantName: 'Monzo Plus' }), categories)).toBeNull();
  });
  it('normalises letter case and compatibility spaces', () => {
    expect(knownServiceMatch(candidate({ merchantName: null, description: 'ＡＭＺＮ\u00a0ＰＲＩＭＥ' }), categories)?.categoryId).toBe(10);
  });
  it('uses one stable Plex identity across changing invoice and contact details', () => {
    const variants = [
      { merchantName: 'Plex Sub Invoice 5569', description: 'PLEX SUB* INVOICE 5569 +15399951911 USA' },
      { merchantName: 'Plex Sub Invoice 5731', description: 'PLEX SUB* INVOICE 5731 +15399951911 USA' },
      { merchantName: 'Plex Sub Invoice 7043', description: 'PLEX SUB* INVOICE 7043 MCALESTER USA' },
    ];
    expect(variants.map(knownServiceIdentity)).toEqual(['plex-subscription', 'plex-subscription', 'plex-subscription']);
  });
  it('does not choose between contradictory Plex and Google service identities', () => {
    expect(knownServiceIdentity({ merchantName: 'Google Storage', description: 'PLEX SUB* INVOICE 5731 MCALESTER USA' })).toBeNull();
  });
});

describe('service classification boundaries', () => {
  it.each(['bank_transfer', 'internal transfer', 'credit card repayment', 'pot transfer', 'standing order', 'unknown'])('does not reclassify %s as consumption', transactionType => {
    expect(knownServiceMatch(candidate({ transactionType }), categories)).toBeNull();
  });
  it.each(['Transfers', 'Savings', 'Investments', 'Refunds', 'credit_card_repayments'])('does not override bank movement hint %s', bankCategory => {
    expect(knownServiceMatch(candidate({ bankCategory }), categories)).toBeNull();
  });
  it('retains property attribution for review', () => {
    expect(knownServiceMatch(candidate({ propertyId: 7 }), categories)).toBeNull();
  });
  it.each(['0', '8.99', 'NaN', 'Infinity'])('rejects incoming, missing or invalid amount %s', amount => {
    expect(knownServiceMatch(candidate({ legs: [{ ...candidate().legs[0], amount }] }), categories)).toBeNull();
  });
  it('accepts a card purchase that increases liability debt, but never a credit that reduces it', () => {
    expect(knownServiceMatch(candidate({ legs: [{ ...candidate().legs[0], accountType: 'LIABILITY' }] }), categories)?.categoryId).toBe(10);
    expect(knownServiceMatch(candidate({ legs: [{ ...candidate().legs[0], accountType: 'LIABILITY', amount: '8.99' }] }), categories)).toBeNull();
  });
  it('requires exactly one financial account', () => {
    expect(knownServiceMatch(candidate({ legs: [] }), categories)).toBeNull();
    expect(knownServiceMatch(candidate({ legs: [candidate().legs[0], { ...candidate().legs[0], accountId: 2 }] }), categories)).toBeNull();
  });
  it('never invents a category or chooses between duplicate category names', () => {
    expect(knownServiceMatch(candidate(), [{ id: 90, name: 'Shopping' }])).toBeNull();
    expect(knownServiceMatch(candidate(), [...categories, { id: 99, name: 'Software & Subscriptions', parentId: 90 }])).toBeNull();
  });
  it('prefers banking fees to generic subscription categories for account memberships', () => {
    expect(knownServiceMatch(candidate({ merchantName: null, description: 'Monzo Plus' }), categories)?.categoryId).toBe(30);
  });
  it.each([
    ['Plex Sub Invoice 5731', 'PLEX SUB* INVOICE 5731 +15399951911 USA'],
    ['Google Storage', 'Google One London GBR'],
  ])('preserves movement, property and incoming guards for %s', (merchantName, description) => {
    const service = candidate({ merchantName, description });
    expect(knownServiceMatch({ ...service, transactionType: 'bank_transfer' }, categories)).toBeNull();
    expect(knownServiceMatch({ ...service, bankCategory: 'Savings' }, categories)).toBeNull();
    expect(knownServiceMatch({ ...service, propertyId: 7 }, categories)).toBeNull();
    expect(knownServiceMatch({ ...service, legs: [{ ...service.legs[0], amount: '8.99' }] }, categories)).toBeNull();
  });
});
