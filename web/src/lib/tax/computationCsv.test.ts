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

  it('includes every breakdown line and ends with the disclaimer', () => {
    const c = emily();
    const working = parsed.data.filter(r => r[0] === 'Income tax');
    expect(working.length).toBe(c.breakdown.filter(l => l.section === 'Income tax').length);
    const last = parsed.data[parsed.data.length - 1];
    expect(last[0]).toBe('Disclaimer');
    expect(last[1]).toContain('not tax advice');
  });
});
