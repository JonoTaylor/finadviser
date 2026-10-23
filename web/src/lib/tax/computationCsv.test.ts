import { describe, it, expect } from 'vitest';
import Papa from 'papaparse';
import { taxComputationCsv } from './computationCsv';
import { computeOwnerTax } from './ownerTaxComputation';

function emily() {
  const computation = computeOwnerTax({
    taxYear: '2025-26',
    properties: [{ name: '249 Francis Road', lettingType: 'standard', grossIncome: '10000.00', totalExpenses: '1800.00', mortgageInterest: '2400.00' }],
    profile: {
      employmentIncome: '12570.00', payeTaxPaid: '0.00', selfEmploymentIncome: '0.00', savingsInterest: '0.00',
      dividends: '0.00', otherIncome: '0.00', propertyLossesBroughtForward: '0.00', financeCostsBroughtForward: '0.00',
    },
  });
  return { ...computation, owner: { id: 1, name: 'Emily "Em" Pun' } };
}

describe('taxComputationCsv', () => {
  const csv = taxComputationCsv(emily());
  const parsed = Papa.parse<string[]>(csv, { skipEmptyLines: true });

  it('parses cleanly with a Section / Line / Amount header and three columns on every row', () => {
    expect(parsed.errors).toEqual([]);
    expect(parsed.data[0]).toEqual(['Section', 'Line', 'Amount']);
    expect(parsed.data.every(r => r.length === 3)).toBe(true);
  });

  it('leads with the headline figures', () => {
    const summary = new Map(parsed.data.filter(r => r[0] === 'Summary').map(r => [r[1], r[2]]));
    expect(summary.get('Owner')).toBe('Emily "Em" Pun');
    expect(summary.get('Property method')).toBe('Actual expenses');
    expect(summary.get('Taxable UK property profit')).toBe('8200.00');
    expect(summary.get('S.24 finance-cost tax reducer')).toBe('480.00');
    expect(summary.get('Income tax liability')).toBe('1160.00');
    expect(summary.get('Tax attributable to rental income')).toBe('1160.00');
    expect(summary.get('Balance due through Self Assessment by 2027-01-31')).toBe('1160.00');
    expect(summary.get('Payment on account 1 due 2027-01-31')).toBe('580.00');
    expect(summary.get('Payment on account 2 due 2027-07-31')).toBe('580.00');
  });

  it('adds the pooled rent-a-room treatment to the summary only when there are rent-a-room lettings', () => {
    expect(parsed.data.some(r => r[1].startsWith('Rent-a-room'))).toBe(false);

    const computation = computeOwnerTax({
      taxYear: '2025-26',
      properties: [
        { name: 'Home A', lettingType: 'rent_a_room', grossIncome: '5000.00', totalExpenses: '0.00', mortgageInterest: '0.00', rentARoomShared: false },
        { name: 'Home B', lettingType: 'rent_a_room', grossIncome: '5000.00', totalExpenses: '0.00', mortgageInterest: '0.00', rentARoomShared: false },
      ],
      profile: {
        employmentIncome: '12570.00', payeTaxPaid: '0.00', selfEmploymentIncome: '0.00', savingsInterest: '0.00',
        dividends: '0.00', otherIncome: '0.00', propertyLossesBroughtForward: '0.00', financeCostsBroughtForward: '0.00',
      },
    });
    const rows = Papa.parse<string[]>(taxComputationCsv({ ...computation, owner: { name: 'Emily' } }), { skipEmptyLines: true });
    expect(rows.errors).toEqual([]);
    const summary = new Map(rows.data.filter(r => r[0] === 'Summary').map(r => [r[1], r[2]]));
    expect(summary.get('Rent-a-room treatment')).toBe('Alternative method (receipts less limit)');
    expect(summary.get('Rent-a-room pooled receipts (limit 7500.00)')).toBe('10000.00');
    expect(summary.get('Rent-a-room effect on property business')).toBe('2500.00');
    expect(summary.get('Income tax liability')).toBe('500.00');
  });

  it('includes every breakdown line and ends with the disclaimer', () => {
    const c = emily();
    const working = parsed.data.filter(r => r[0] === 'Income tax');
    expect(working.length).toBe(c.breakdown.filter(l => l.section === 'Income tax').length);
    const last = parsed.data[parsed.data.length - 1];
    expect(last[0]).toBe('Disclaimer');
    expect(last[1]).toContain('not tax advice');
  });
});

describe('taxComputationCsv: persisted profile readiness', () => {
  function exportRows(overrides: {
    profileGaps?: string[]; estimateOnly?: boolean; profileComplete?: boolean;
    payeTaxPaidKnown?: boolean; estimatedBalancePayable?: string | null;
  }) {
    return Papa.parse<string[]>(taxComputationCsv({ ...emily(), ...overrides }), { skipEmptyLines: true }).data;
  }

  it('exports missing PAYE and settlement amounts as unknown, including detailed working', () => {
    const rows = exportRows({
      profileGaps: ['PAYE tax paid has not been confirmed (including whether it is zero).'],
      estimateOnly: true, profileComplete: false, payeTaxPaidKnown: false, estimatedBalancePayable: null,
    });
    const summary = new Map(rows.filter(r => r[0] === 'Summary').map(r => [r[1], r[2]]));
    expect(summary.get('Calculation status')).toContain('incomplete tax profile');
    expect(summary.get('Tax already paid through PAYE — unknown')).toBe('');
    expect(summary.get('Self Assessment balance — unknown: incomplete or estimated profile')).toBe('');
    expect(summary.get('Payments on account — unknown: incomplete or estimated profile')).toBe('');
    expect(summary.has('Balance due through Self Assessment by 2027-01-31')).toBe(false);
    expect(rows.some(r => r[1].startsWith('Payment on account 1'))).toBe(false);
    expect(rows.some(r => r[0].startsWith('Self Assessment'))).toBe(false);
    expect(rows.some(r => r[1].startsWith('Tax already paid through PAYE £0.00'))).toBe(false);
    expect(rows).toContainEqual(['Profile gaps', 'PAYE tax paid has not been confirmed (including whether it is zero).', '']);
    expect(summary.get('Tax attributable to rental income (scenario)')).toBe('1160.00');
    expect(rows.some(r => r[0] === 'Income tax (scenario)')).toBe(true);
  });

  it('preserves explicit zero PAYE while withholding settlement when other profile inputs are unknown', () => {
    const rows = exportRows({
      profileGaps: ['Savings interest has not been confirmed.'],
      estimateOnly: true, profileComplete: false, payeTaxPaidKnown: true, estimatedBalancePayable: null,
    });
    expect(rows).toContainEqual(['Summary', 'Tax already paid through PAYE', '0.00']);
    expect(rows.some(r => r[1].startsWith('Balance due through Self Assessment'))).toBe(false);
    expect(rows.some(r => r[1].startsWith('Payment on account 1'))).toBe(false);
  });

  it('labels an estimated complete profile as a scenario rather than a confirmed payment', () => {
    const rows = exportRows({
      profileGaps: [], estimateOnly: true, profileComplete: true,
      payeTaxPaidKnown: true, estimatedBalancePayable: null,
    });
    expect(rows.find(r => r[1] === 'Calculation status')?.[2]).toContain('estimated or unconfirmed inputs');
    expect(rows.some(r => r[1].startsWith('Balance due through Self Assessment'))).toBe(false);
    expect(rows).toContainEqual(['Summary', 'Income tax liability (scenario)', '1160.00']);
  });

  it('retains settlement figures for a complete profile with confirmed inputs', () => {
    const rows = exportRows({
      profileGaps: [], estimateOnly: false, profileComplete: true,
      payeTaxPaidKnown: true, estimatedBalancePayable: '1160.00',
    });
    expect(rows).toContainEqual(['Summary', 'Balance due through Self Assessment by 2027-01-31', '1160.00']);
    expect(rows).toContainEqual(['Summary', 'Payment on account 1 due 2027-01-31', '580.00']);
    expect(rows.some(r => r[0] === 'Self Assessment')).toBe(true);
  });
});
