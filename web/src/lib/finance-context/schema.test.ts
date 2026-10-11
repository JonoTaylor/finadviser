import { describe, expect, it } from 'vitest';
import { contextSchema, contextWriteSchema, defaultContext, resolveCashAccessibility, type AccessibilityAccount } from './schema';
import { validateContextReferences } from './lookup';

const cash: AccessibilityAccount = { id: 1, name: 'Current account', accountType: 'ASSET', isInvestment: false, investmentKind: null };

describe('personal financial context', () => {
  it('records only the known name and requested priorities while personal facts remain unknown', () => {
    expect(contextSchema.parse({})).toEqual({
      preferredName: 'Jono', ownerId: null, taxResidence: null, dependants: null,
      employmentStability: null, priorities: ['spending', 'wealth', 'property', 'pensions'],
      nextReviewDate: null, accountAccessibility: [],
    });
  });

  it('distinguishes no dependants from unknown and validates leap-year review dates', () => {
    expect(contextSchema.parse({ dependants: 0, nextReviewDate: '2028-02-29' })).toMatchObject({ dependants: 0, nextReviewDate: '2028-02-29' });
    expect(contextSchema.parse({ dependants: null })).toMatchObject({ dependants: null });
  });

  it.each([
    { ownerId: 0 }, { ownerId: '2' }, { dependants: -1 }, { dependants: 1.5 },
    { dependants: '0' }, { taxResidence: 'UK' }, { employmentStability: 'inferred' },
    { preferredName: '  ' }, { arbitrary: 'fact' }, { nextReviewDate: '2027-02-29' },
    { nextReviewDate: '2026-04-31' }, { nextReviewDate: '2026-2-1' },
    { priorities: [] }, { priorities: ['wealth', 'wealth'] },
    { accountAccessibility: [{ accountId: 1, accessibility: 'liquid', note: 'unknown' }] },
    { accountAccessibility: [{ accountId: 1, accessibility: 'available' }, { accountId: 1, accessibility: 'excluded' }] },
  ])('rejects unsafe, unsupported or ambiguous personal facts: %j', value => {
    expect(contextSchema.safeParse(value).success).toBe(false);
  });

  it('requires a whole revision number and a strict workspace envelope', () => {
    expect(contextWriteSchema.safeParse({ data: {}, revision: 0 }).success).toBe(true);
    expect(contextWriteSchema.safeParse({ data: {}, revision: -1 }).success).toBe(false);
    expect(contextWriteSchema.safeParse({ data: {}, revision: 0.5 }).success).toBe(false);
    expect(contextWriteSchema.safeParse({ data: {}, revision: 0, force: true }).success).toBe(false);
  });

  it('validates selected IDs without choosing the first owner or changing account ownership', () => {
    const lookup = { asOf: '2026-10-11', owners: [{ id: 22, name: 'Someone else' }, { id: 44, name: 'Jono' }], accounts: [{ ...cash, ownerId: null, balance: '100.00', latestJournalDate: null, postingCount: 0, futurePostingCount: 0 }] };
    expect(() => validateContextReferences(defaultContext, lookup)).not.toThrow();
    expect(() => validateContextReferences(contextSchema.parse({ ownerId: 44, accountAccessibility: [{ accountId: 1, accessibility: 'available' }] }), lookup)).not.toThrow();
    expect(() => validateContextReferences(contextSchema.parse({ ownerId: 99 }), lookup)).toThrow('Choose an owner recorded');
    expect(() => validateContextReferences(contextSchema.parse({ accountAccessibility: [{ accountId: 99, accessibility: 'available' }] }), lookup)).toThrow('Choose an asset or liability');
    expect(lookup.accounts[0].ownerId).toBeNull();
  });
});

describe('confirmed cash access', () => {
  it('keeps automatic bank classification inferred until the user confirms it', () => {
    expect(resolveCashAccessibility(cash, defaultContext)).toEqual({ eligible: true, source: 'inferred', accessibility: null });
    expect(resolveCashAccessibility(cash, { accountAccessibility: [{ accountId: 1, accessibility: 'available' }] })).toEqual({ eligible: true, source: 'confirmed', accessibility: 'available' });
  });

  it.each(['restricted', 'excluded'] as const)('respects an explicit %s cash setting', accessibility => {
    expect(resolveCashAccessibility(cash, { accountAccessibility: [{ accountId: 1, accessibility }] }).eligible).toBe(false);
  });

  it('can confirm accessible cash whose name is ambiguous without relying on its label', () => {
    const asset = { ...cash, name: 'Reserve' };
    expect(resolveCashAccessibility(asset, defaultContext).eligible).toBe(false);
    expect(resolveCashAccessibility(asset, { accountAccessibility: [{ accountId: 1, accessibility: 'available' }] }).eligible).toBe(true);
  });

  it.each([
    { ...cash, accountType: 'LIABILITY' }, { ...cash, isPropertyAsset: true },
    { ...cash, isInvestment: true, investmentKind: 'pension' },
    { ...cash, isInvestment: true, investmentKind: 'stocks_and_shares_isa' },
    { ...cash, isInvestment: true, investmentKind: null },
    { ...cash, isInvestment: false, investmentKind: 'crypto' },
    { ...cash, name: 'Unclassified pension' }, { ...cash, name: 'Crypto wallet' },
  ])('never converts a noncash asset into emergency cash, even with an available override: %j', account => {
    expect(resolveCashAccessibility(account, { accountAccessibility: [{ accountId: 1, accessibility: 'available' }] }).eligible).toBe(false);
  });

  it('does not infer access to a notice savings account, while accepting a reviewed cash setting', () => {
    const savings = { ...cash, name: 'Notice savings', isInvestment: true, investmentKind: 'savings' };
    expect(resolveCashAccessibility(savings, defaultContext).eligible).toBe(false);
    expect(resolveCashAccessibility(savings, { accountAccessibility: [{ accountId: 1, accessibility: 'available' }] }).eligible).toBe(true);
  });
});
