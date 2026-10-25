import { describe, expect, it } from 'vitest';
import { buildMerchantResearchQuery, merchantResearchInputFromCandidate } from '@/lib/merchant-research/privacy';
import type { MerchantResearchResult } from '@/lib/merchant-research/types';
import type { CategorizationCandidate, CategorizationCategory } from './types';
import { assessAutomaticSpending, consumerCategoryFamily, hasMovementDescription, isFinancialOrBarePaymentProvider, isProtectedSpendingCategory } from './autonomy';

const categories: CategorizationCategory[] = [
  { id: 1, name: 'Dining' }, { id: 2, name: 'Groceries' }, { id: 3, name: 'Transport' },
  { id: 4, name: 'Shopping' }, { id: 5, name: 'Software & Subscriptions' },
  { id: 6, name: 'Income' }, { id: 7, name: 'Transfer' }, { id: 8, name: 'Property expenses' },
  { id: 9, name: 'Mortgage interest' }, { id: 10, name: 'Tax' },
  { id: 11, name: 'Child restaurant', parentId: 1 }, { id: 12, name: 'Dining', parentId: 8 },
];
const withUnknown = [...categories, { id: 20, name: 'Spending details unknown', parentId: null }];
const candidate = (overrides: Partial<CategorizationCandidate> = {}): CategorizationCandidate => ({
  id: 1, date: '2026-10-25', description: 'BLUE SUSHI GBR', merchantName: 'Blue Sushi',
  bankCategory: null, transactionType: 'card_payment', currency: 'GBP', propertyId: null,
  legs: [{ accountId: 1, accountName: 'Home bank', accountType: 'ASSET', ownerId: 1, amount: '-12.89' },
    { accountId: 2, accountName: 'Expense', accountType: 'EXPENSE', ownerId: null, amount: '12.89' }],
  snapshot: 'a'.repeat(32), ...overrides,
});
const decision = (overrides: Partial<{ categoryId: number | null; confidence: number; reason: string; status: 'applied' | 'needs_review' }> = {}) => ({
  categoryId: 1, confidence: 0.85, reason: 'The merchant is a restaurant.', status: 'needs_review' as const, ...overrides,
});
function research(row: CategorizationCandidate): MerchantResearchResult {
  const input = merchantResearchInputFromCandidate(row);
  const query = input && buildMerchantResearchQuery(input);
  if (!query) throw new Error('Fixture has no screened public merchant');
  return { status: 'matched', query: query.query, researchedAt: '2026-10-25T10:00:00.000Z',
    sources: [{ title: 'Public business information', url: 'https://business-information.org/store', snippet: 'A public merchant directory listing.', retrievedAt: '2026-10-25T10:00:00.000Z' }],
    provider: 'gateway_perplexity', scope: 'merchant_identity_only' };
}

describe('consumer category boundaries', () => {
  it.each([[1, 'dining'], [2, 'groceries'], [3, 'transport'], [4, 'shopping'], [5, 'subscriptions'], [11, 'dining']] as const)
  ('resolves category %i through valid consumer ancestry', (id, family) => expect(consumerCategoryFamily(id, categories)).toBe(family));
  it.each([6, 7, 8, 9, 10, 12, 99])('rejects financial, property or missing category %i', id => expect(consumerCategoryFamily(id, categories)).toBeNull());
  it('fails closed on cycles, missing ancestors and duplicate IDs', () => {
    expect(consumerCategoryFamily(1, [{ id: 1, name: 'Dining', parentId: 1 }])).toBeNull();
    expect(consumerCategoryFamily(1, [{ id: 1, name: 'Dining', parentId: 99 }])).toBeNull();
    expect(consumerCategoryFamily(1, [{ id: 1, name: 'Dining' }, { id: 1, name: 'Income' }])).toBeNull();
  });
  it('exposes a protected-category guard for fallback high-confidence decisions', () => {
    for (const id of [6, 7, 8, 9, 10, 12, 99]) expect(isProtectedSpendingCategory(id, categories)).toBe(true);
    expect(isProtectedSpendingCategory(1, categories)).toBe(false);
    expect(isProtectedSpendingCategory(20, withUnknown)).toBe(false);
    expect(consumerCategoryFamily(21, [{ id: 21, name: 'Home & Garden' }])).toBe('household');
    expect(consumerCategoryFamily(21, [{ id: 21, name: 'Food & Drink' }])).toBe('dining');
  });
});

describe('reversible automatic spending decisions', () => {
  it('uses a clear commercial description and explicit purchase context for an estimated ordinary category', () => {
    expect(assessAutomaticSpending(candidate(), categories, decision())).toMatchObject({ assignmentKind: 'estimated', categoryId: 1 });
  });
  it('requires support beyond lower model confidence', () => {
    const row = candidate({ merchantName: 'Acme Trading', description: 'ACME TRADING GBR' });
    expect(assessAutomaticSpending(row, categories, decision())).toBeNull();
    expect(assessAutomaticSpending(row, categories, decision(), { research: research(row) })).toMatchObject({ assignmentKind: 'estimated', categoryId: 1 });
  });
  it('uses a matching bank category without representing it as research', () => {
    const row = candidate({ merchantName: 'Acme Trading', description: 'ACME TRADING GBR', bankCategory: 'Eating Out' });
    const result = assessAutomaticSpending(row, categories, decision());
    expect(result).toMatchObject({ assignmentKind: 'estimated', categoryId: 1 });
    expect(result?.reason).toContain('matching bank category');
    expect(result?.reason).not.toContain('public merchant evidence');
    expect(assessAutomaticSpending({ ...row, bankCategory: 'Shopping' }, categories, decision())).toBeNull();
  });
  it('does not accept a claimed or mismatched citation as supporting merchant evidence', () => {
    const row = candidate({ merchantName: 'Acme Trading', description: 'ACME TRADING GBR' });
    const evidence = research(row);
    for (const value of [{ ...evidence, query: 'Different shop business merchant' }, { ...evidence, sources: [] },
      { ...evidence, sources: [{ ...evidence.sources[0], url: 'https://127.0.0.1/private' }] }]) {
      expect(assessAutomaticSpending(row, categories, decision(), { research: value })).toBeNull();
    }
  });
  it('preserves missing currency and does not manufacture account or amount data', () => {
    const row = candidate({ currency: null }); const before = structuredClone(row);
    expect(assessAutomaticSpending(row, categories, decision())).toMatchObject({ categoryId: 1 });
    expect(row).toEqual(before); expect(row.currency).toBeNull();
  });
  it('does not infer card context from a missing type and merchant name alone', () => {
    const row = candidate({ transactionType: null });
    expect(assessAutomaticSpending(row, categories, decision(), { research: research(row) })).toBeNull();
    expect(assessAutomaticSpending({ ...row, bankCategory: 'Eating Out' }, categories, decision(), { research: research(row) })).toMatchObject({ assignmentKind: 'estimated' });
  });
  it('uses actual public evidence for a narrowly recognised metadata-null retail statement without inventing its type', () => {
    const row = candidate({ merchantName: null, description: 'JOKER SØRVÅGEN SØRVÅGEN NOR', transactionType: null, currency: null });
    expect(assessAutomaticSpending(row, categories, decision({ categoryId: 2 }))).toBeNull();
    expect(assessAutomaticSpending(row, categories, decision({ categoryId: 2 }), { research: research(row) })).toMatchObject({ assignmentKind: 'estimated', categoryId: 2 });
    expect(row.transactionType).toBeNull();
  });
  it.each(['bank_transfer', 'faster_payment', 'standing_order', 'p2p', 'cash_withdrawal', 'credit_card_repayment', 'refund'])
  ('keeps movement transaction type %s unresolved', transactionType => {
    expect(assessAutomaticSpending(candidate({ transactionType }), withUnknown, decision({ confidence: 1 }))).toBeNull();
  });
  it.each(['Transfers', 'Savings', 'Investments', 'Income', 'Salary', 'Refunds', 'Loan repayment', 'Pension contribution', 'Cash'])
  ('keeps financial bank hint %s unresolved', bankCategory => {
    expect(assessAutomaticSpending(candidate({ bankCategory }), withUnknown, decision({ confidence: 1 }))).toBeNull();
  });
  it.each(['AMERICAN EXP 3773', 'FNZ', 'PayPal', 'Stripe', 'Wise', 'HSBC'])('does not call bare financial identity %s ordinary spending', merchantName => {
    expect(isFinancialOrBarePaymentProvider({ merchantName, description: merchantName })).toBe(true);
    expect(assessAutomaticSpending(candidate({ merchantName, description: merchantName }), withUnknown, decision({ confidence: 1 }))).toBeNull();
  });
  it('recognises bare providers behind card wrappers while allowing retail merchants', () => {
    expect(isFinancialOrBarePaymentProvider({ merchantName: null, description: 'CARD PAYMENT TO STRIPE' })).toBe(true);
    expect(isFinancialOrBarePaymentProvider({ merchantName: null, description: 'POS PURCHASE AMERICAN EXPRESS' })).toBe(true);
    expect(isFinancialOrBarePaymentProvider({ merchantName: 'Amazon Marketplace', description: 'AMAZON MARKETPLACE GBR' })).toBe(false);
    expect(isFinancialOrBarePaymentProvider({ merchantName: 'Blue Sushi', description: 'BLUE SUSHI GBR' })).toBe(false);
  });
  it('keeps unknown personal incoming payments, liability credits, ambiguous financial legs and property costs unresolved', () => {
    const positive = candidate().legs.map(leg => ({ ...leg, amount: leg.accountType === 'ASSET' ? '5088.51' : '-5088.51' }));
    const liability = [{ ...positive[0], accountType: 'LIABILITY' as const }];
    const multiple = [...candidate().legs, { accountId: 3, accountName: 'Other bank', ownerId: 1, accountType: 'ASSET' as const, amount: '12.89' }];
    for (const row of [candidate({ legs: positive }), candidate({ legs: liability }), candidate({ legs: multiple }), candidate({ propertyId: 2 })]) {
      expect(assessAutomaticSpending(row, withUnknown, decision({ confidence: 1 }))).toBeNull();
    }
  });
  it('rejects private names even when a nominal card type is present', () => {
    const row = candidate({ merchantName: 'Avery', description: 'AVERY' });
    expect(assessAutomaticSpending(row, withUnknown, decision({ confidence: 1 }), { privateNames: ['Avery'] })).toBeNull();
    expect(assessAutomaticSpending(candidate({ merchantName: 'J TAYLOR', description: 'J TAYLOR' }), withUnknown, decision({ confidence: 1 }))).toBeNull();
  });
  it.each([6, 7, 8, 9, 10, 12])('never promotes financial or property category %i even with high confidence', categoryId => {
    expect(assessAutomaticSpending(candidate(), withUnknown, decision({ categoryId, confidence: 1 }))).toBeNull();
  });
  it('allows only broad Shopping for an explicit marketplace purchase, never a guessed specific category', () => {
    const row = candidate({ merchantName: 'Amazon Marketplace', description: 'AMAZON MARKETPLACE GBR' });
    expect(assessAutomaticSpending(row, withUnknown, decision())).toMatchObject({ assignmentKind: 'estimated', categoryId: 4 });
    expect(assessAutomaticSpending({ ...row, transactionType: null }, withUnknown, decision(), { research: research(row) })).toBeNull();
  });
  it('keeps an explicit purchase with unknown details visible in the reserved broad bucket', () => {
    expect(assessAutomaticSpending(candidate({ merchantName: 'Acme Trading', description: 'ACME TRADING GBR' }), withUnknown,
      decision({ categoryId: null, confidence: 0.2 }), { unknownCategoryId: 20 })).toMatchObject({ assignmentKind: 'broad', categoryId: 20 });
    expect(assessAutomaticSpending(candidate(), categories, decision({ categoryId: null, confidence: 0.2 }))).toBeNull();
  });
  it('does not use arbitrary, duplicated or nested unknown buckets', () => {
    const low = decision({ categoryId: null, confidence: 0.2 });
    expect(assessAutomaticSpending(candidate(), categories, low, { unknownCategoryId: 1 })).toBeNull();
    expect(assessAutomaticSpending(candidate(), [...withUnknown, { id: 21, name: 'Spending details unknown' }], low)).toBeNull();
    expect(assessAutomaticSpending(candidate(), [...categories, { id: 20, name: 'Spending details unknown', parentId: 1 }], low)).toBeNull();
    expect(assessAutomaticSpending(candidate(), withUnknown, low, { unknownCategoryId: 99 })).toBeNull();
  });
  it('does not hide uncertain bank movements under the broad bucket even when the memo is the only warning', () => {
    expect(assessAutomaticSpending(candidate({ description: 'BANK TRANSFER TO AVERY' }), withUnknown, decision({ categoryId: null, confidence: 0.2 }))).toBeNull();
  });
  it('exposes explicit movement descriptions independently of category or imported type', () => {
    for (const description of ['BANK TRANSFER TO AVERY', 'Payment from Avery', 'ATM withdrawal', 'Credit card repayment']) {
      expect(hasMovementDescription({ description })).toBe(true);
    }
    expect(hasMovementDescription({ description: 'BLUE SUSHI GBR' })).toBe(false);
  });
});
