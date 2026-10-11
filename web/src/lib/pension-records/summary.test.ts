import { describe, expect, it } from 'vitest';
import { pensionRecordSchema, pensionRecordsDataSchema, validatePensionRecordLinks, type PensionAccount, type PensionRecord } from './schema';
import { pensionRecordDraft, pensionRecordFromDraft } from './editor';
import { summarizePensionRecords } from './summary';

const id = (last: number) => `00000000-0000-4000-8000-${String(last).padStart(12, '0')}`;
const common = { name: 'Scheme', provider: null, ownerId: 1, statementAsOf: '2026-01-31', notes: null };
const dc = (overrides: Partial<Extract<PensionRecord, { type: 'dc' }>> = {}): Extract<PensionRecord, { type: 'dc' }> => ({
  ...common, id: id(1), type: 'dc', linkedAccountId: null, potAmount: '20000.00', personalMonthlyContribution: '125.25', employerMonthlyContribution: '75.50', annualFeeRate: null, ...overrides,
});
const db: PensionRecord = { ...common, id: id(2), type: 'db', promisedAnnualIncome: '6000.00', startAge: 62 };
const state: PensionRecord = { ...common, id: id(3), type: 'state', forecastAnnualIncome: '9500.00', forecastSourceDate: '2026-01-31', startAge: 67 };
const accounts: PensionAccount[] = [{ id: 4, name: 'Ledger pension', ownerId: 1, ownerName: 'Jono', balance: '30000.15', balanceAsOf: '2026-10-11' }];

describe('pension inventory summaries', () => {
  it('keeps DC capital, DB income and State Pension forecasts separate', () => {
    const summary = summarizePensionRecords([dc(), db, state], accounts);
    expect(summary.dc.pot.knownTotal).toBe('20000.00');
    expect(summary.db.annualIncome.knownTotal).toBe('6000.00');
    expect(summary.state.annualForecast.knownTotal).toBe('9500.00');
    expect(summary).not.toHaveProperty('netWorth');
    expect(summary).not.toHaveProperty('totalPensionValue');
  });

  it('uses the current linked ledger balance and preserves exact contribution pennies', () => {
    const summary = summarizePensionRecords([dc({ linkedAccountId: 4, potAmount: null })], accounts);
    expect(summary.dc.pot.knownTotal).toBe('30000.15');
    expect(summary.dc.totalMonthlyContributions).toEqual({ knownTotal: '200.75', knownCount: 1, unknownCount: 0, complete: true });
    expect(summary.dc.personalMonthlyContributions.knownTotal).toBe('125.25');
    expect(summary.dc.employerMonthlyContributions.knownTotal).toBe('75.50');
  });

  it('keeps unknown values unknown and labels partial totals', () => {
    const summary = summarizePensionRecords([
      dc(), dc({ id: id(4), potAmount: null, personalMonthlyContribution: null, employerMonthlyContribution: '50.00' }),
      { ...db, promisedAnnualIncome: null }, { ...state, forecastAnnualIncome: null },
    ], accounts);
    expect(summary.dc.pot).toEqual({ knownTotal: '20000.00', knownCount: 1, unknownCount: 1, complete: false });
    expect(summary.dc.employerMonthlyContributions.knownTotal).toBe('125.50');
    expect(summary.dc.totalMonthlyContributions).toEqual({ knownTotal: '200.75', knownCount: 1, unknownCount: 1, complete: false });
    expect(summary.db.annualIncome.knownTotal).toBeNull();
    expect(summary.state.annualForecast.knownTotal).toBeNull();
  });

  it('distinguishes confirmed zero from unknown', () => {
    const summary = summarizePensionRecords([dc({ potAmount: '0.00', personalMonthlyContribution: '0.00', employerMonthlyContribution: '0.00' })], []);
    expect(summary.dc.pot).toEqual({ knownTotal: '0.00', knownCount: 1, unknownCount: 0, complete: true });
    expect(summary.dc.totalMonthlyContributions.knownTotal).toBe('0.00');
    expect(summarizePensionRecords([], []).dc.pot.knownTotal).toBeNull();
  });

  it('excludes other owners and unassigned records from personal totals', () => {
    const records = [dc(), dc({ id: id(5), ownerId: 2, potAmount: '90000.00' }), dc({ id: id(6), ownerId: null, potAmount: '5000.00' }), db, state];
    const summary = summarizePensionRecords(records, [], 1);
    expect(summary.scope).toBe('owner');
    expect(summary.recordCount).toBe(3);
    expect(summary.dc.pot.knownTotal).toBe('20000.00');
    expect(summary.excludedForMissingOwnership).toBe(1);
    expect(summary.warnings[0]).toContain('excluded');
    expect(summarizePensionRecords(records, []).dc.pot.knownTotal).toBe('115000.00');
  });

  it('uses ledger ownership if the linked account owner changed after saving', () => {
    const linked = dc({ linkedAccountId: 4, potAmount: null, ownerId: 2 });
    expect(summarizePensionRecords([linked], accounts, 1).dc.pot.knownTotal).toBe('30000.15');
    expect(summarizePensionRecords([linked], accounts, 2).recordCount).toBe(0);
  });

  it('does not fall back to a stored pot or owner when a linked account disappears', () => {
    const summary = summarizePensionRecords([dc({ linkedAccountId: 999, potAmount: null })], []);
    expect(summary.dc.pot.knownTotal).toBeNull();
    expect(summary.unknownOwnershipCount).toBe(1);
    expect(summary.warnings.join(' ')).toContain('unavailable');
    expect(summarizePensionRecords([dc({ linkedAccountId: 999, potAmount: null })], [], 1).recordCount).toBe(0);
  });

  it('flags negative ledger balances rather than inventing a positive pension pot', () => {
    const summary = summarizePensionRecords([dc({ linkedAccountId: 4, potAmount: null })], [{ ...accounts[0], balance: '-100.00' }]);
    expect(summary.dc.pot.knownTotal).toBe('-100.00');
    expect(summary.warnings[0]).toContain('negative');
  });
});

describe('pension inventory validation', () => {
  it('accepts blank unknown inputs without default pot, fee or statutory age', () => {
    const draft = pensionRecordDraft(null, id(1));
    const parsed = pensionRecordSchema.parse(pensionRecordFromDraft({ ...draft, name: 'New scheme' }));
    expect(parsed).toMatchObject({ type: 'dc', ownerId: null, statementAsOf: null, potAmount: null, annualFeeRate: null, personalMonthlyContribution: null, employerMonthlyContribution: null });
    const forecast = pensionRecordSchema.parse(pensionRecordFromDraft({ ...draft, name: 'My forecast', type: 'state' }));
    expect(forecast).toMatchObject({ forecastAnnualIncome: null, startAge: null });
  });

  it('normalises valid money and round-trips explicit zero fields', () => {
    const parsed = pensionRecordSchema.parse(dc({ potAmount: '12.5', annualFeeRate: '0.3500', personalMonthlyContribution: '0', employerMonthlyContribution: '0' }));
    expect(parsed).toMatchObject({ potAmount: '12.50', annualFeeRate: '0.35', personalMonthlyContribution: '0.00' });
    expect(pensionRecordSchema.parse(pensionRecordFromDraft(pensionRecordDraft({ ...db, startAge: 0 }, id(9))))).toEqual({ ...db, startAge: 0 });
  });

  it.each([
    { potAmount: '-1' }, { potAmount: '1.001' }, { potAmount: '1e5' }, { potAmount: 123 },
    { annualFeeRate: '100.1' }, { annualFeeRate: '-0.1' }, { ownerId: 0 }, { ownerId: 1.5 },
    { statementAsOf: '2026-02-30' }, { statementAsOf: '2099-01-01' }, { name: '  ' },
    { linkedAccountId: 4, potAmount: '10.00' }, { ignoredExtra: 'unsafe' },
  ])('rejects invalid pension facts before saving: %j', overrides => {
    expect(pensionRecordSchema.safeParse({ ...dc(), ...overrides }).success).toBe(false);
  });

  it('rejects DB capital or DC account fields in income records', () => {
    expect(pensionRecordSchema.safeParse({ ...db, potAmount: '100000.00' }).success).toBe(false);
    expect(pensionRecordSchema.safeParse({ ...state, linkedAccountId: 4 }).success).toBe(false);
    expect(pensionRecordSchema.safeParse({ ...state, startAge: 68.5 }).success).toBe(false);
  });

  it('rejects duplicate IDs and duplicate ledger account links', () => {
    expect(pensionRecordsDataSchema.safeParse([dc(), dc()]).success).toBe(false);
    expect(pensionRecordsDataSchema.safeParse([dc({ linkedAccountId: 4, potAmount: null }), dc({ id: id(4), linkedAccountId: 4, potAmount: null })]).success).toBe(false);
  });

  it('keeps one current State Pension forecast per known person to avoid duplicate income', () => {
    expect(pensionRecordsDataSchema.safeParse([state, { ...state, id: id(9) }]).success).toBe(false);
    expect(pensionRecordsDataSchema.safeParse([state, { ...state, id: id(9), ownerId: 2 }]).success).toBe(true);
  });

  it('validates existing owners and pension accounts without permitting cross-owner attribution', () => {
    const owners = [{ id: 1, name: 'Jono' }, { id: 2, name: 'Another owner' }];
    expect(validatePensionRecordLinks([dc({ linkedAccountId: 4, potAmount: null })], owners, accounts)).toEqual([]);
    expect(validatePensionRecordLinks([dc({ ownerId: 99 })], owners, accounts)[0]).toContain('owner no longer exists');
    expect(validatePensionRecordLinks([dc({ linkedAccountId: 99, potAmount: null })], owners, accounts)[0]).toContain('ASSET');
    expect(validatePensionRecordLinks([dc({ linkedAccountId: 4, potAmount: null, ownerId: 2 })], owners, accounts)[0]).toContain('must match');
    expect(validatePensionRecordLinks([dc({ linkedAccountId: 4, potAmount: null, ownerId: null })], owners, accounts)[0]).toContain('must match');
  });
});
