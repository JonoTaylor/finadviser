import { describe, it, expect } from 'vitest';
import { ClientError } from '@/lib/errors';
import { computeIncomeTax, type IncomeTaxInputs } from './incomeTax';
import { getRatesForTaxYear } from './taxRates';

function calc(overrides: Partial<IncomeTaxInputs> = {}, year = '2025-26') {
  return computeIncomeTax({
    rates: getRatesForTaxYear(year).table,
    nonSavingsIncome: 0,
    propertyProfit: 0,
    savingsInterest: 0,
    dividends: 0,
    financeCostsThisYear: 0,
    financeCostsBroughtForward: 0,
    ...overrides,
  });
}

const fx = (d: { toFixed: (n: number) => string }) => d.toFixed(2);

describe('computeIncomeTax: bands and personal allowance (2025-26)', () => {
  it('charges nothing on income at or under the personal allowance', () => {
    const r = calc({ nonSavingsIncome: 12570 });
    expect(fx(r.liability)).toBe('0.00');
    expect(r.rows).toHaveLength(0);
  });

  it('basic-rate taxpayer with S.24 relief', () => {
    // Employment 20,000 + property profit 6,000, finance costs 4,000.
    // Personal allowance 12,570 is used by employment: taxable 7,430 + 6,000 = 13,430.
    // All basic rate: 7,430 x 20% = 1,486.00 and 6,000 x 20% = 1,200.00 -> 2,686.00.
    // S.24 reducer: 20% x lowest of finance costs 4,000, property profit 6,000,
    // adjusted total income over allowance (26,000 - 12,570 = 13,430) = 20% x 4,000 = 800.00.
    // Liability 2,686 - 800 = 1,886.00.
    const r = calc({ nonSavingsIncome: 20000, propertyProfit: 6000, financeCostsThisYear: 4000 });
    expect(fx(r.taxBeforeReductions)).toBe('2686.00');
    expect(fx(r.financeCostReducer.reducer)).toBe('800.00');
    expect(r.financeCostReducer.limitedBy).toBe('finance_costs');
    expect(fx(r.financeCostReducer.carriedForward)).toBe('0.00');
    expect(fx(r.liability)).toBe('1886.00');
  });

  it('higher-rate taxpayer: property income lands in the 40% band', () => {
    // Employment 60,000 + property profit 10,000, finance costs 6,000.
    // Taxable after allowance: employment 47,430, property 10,000.
    // Employment: 37,700 x 20% = 7,540 + 9,730 x 40% = 3,892.
    // Property sits wholly above the basic band: 10,000 x 40% = 4,000.
    // Before reductions 15,432. Reducer 20% x min(6,000; 10,000; 70,000-12,570) = 1,200.
    // Liability 14,232.
    const r = calc({ nonSavingsIncome: 60000, propertyProfit: 10000, financeCostsThisYear: 6000 });
    expect(r.rows.map(x => [x.layer, x.kind, fx(x.income), x.ratePct.toString(), fx(x.tax)])).toEqual([
      ['non_savings', 'basic', '37700.00', '20', '7540.00'],
      ['non_savings', 'higher', '9730.00', '40', '3892.00'],
      ['property', 'higher', '10000.00', '40', '4000.00'],
    ]);
    expect(fx(r.taxBeforeReductions)).toBe('15432.00');
    expect(fx(r.financeCostReducer.reducer)).toBe('1200.00');
    expect(fx(r.liability)).toBe('14232.00');
  });

  it('tapers the personal allowance by £1 for every £2 over £100,000', () => {
    // Income 110,000: allowance loses (110,000 - 100,000) / 2 = 5,000 -> 7,570.
    // Taxable 102,430: 37,700 x 20% = 7,540 + 64,730 x 40% = 25,892 -> 33,432.
    const r = calc({ nonSavingsIncome: 110000 });
    expect(fx(r.personalAllowance.taperReduction)).toBe('5000.00');
    expect(fx(r.personalAllowance.effective)).toBe('7570.00');
    expect(fx(r.liability)).toBe('33432.00');
  });

  it('leaves the allowance whole at exactly £100,000 and removes it at £125,140', () => {
    expect(fx(calc({ nonSavingsIncome: 100000 }).personalAllowance.effective)).toBe('12570.00');
    expect(fx(calc({ nonSavingsIncome: 125140 }).personalAllowance.effective)).toBe('0.00');
    // Well past the point it cannot go negative.
    expect(fx(calc({ nonSavingsIncome: 200000 }).personalAllowance.effective)).toBe('0.00');
  });

  it('applies the additional rate above £125,140 of taxable income', () => {
    // Income 130,000, no allowance: 37,700 x 20% = 7,540;
    // (125,140 - 37,700) = 87,440 x 40% = 34,976; 4,860 x 45% = 2,187 -> 44,703.
    const r = calc({ nonSavingsIncome: 130000 });
    expect(fx(r.liability)).toBe('44703.00');
  });

  it('matches widely published figures for salary-only taxpayers', () => {
    // Employment only, 2025-26 England: £50,270 -> 7,540; £60,000 -> 11,432;
    // £100,000 -> 27,432; £150,000 -> 53,703 (no allowance, 45% above 125,140).
    expect(fx(calc({ nonSavingsIncome: 50270 }).liability)).toBe('7540.00');
    expect(fx(calc({ nonSavingsIncome: 60000 }).liability)).toBe('11432.00');
    expect(fx(calc({ nonSavingsIncome: 100000 }).liability)).toBe('27432.00');
    expect(fx(calc({ nonSavingsIncome: 150000 }).liability)).toBe('53703.00');
  });

  it('rejects negative inputs with a ClientError', () => {
    expect(() => calc({ nonSavingsIncome: -1 })).toThrow(ClientError);
    expect(() => calc({ dividends: 'abc' })).toThrow(ClientError);
  });
});

describe('computeIncomeTax: savings and dividends (2025-26)', () => {
  it('uses the starting rate for savings and personal savings allowance before taxing interest', () => {
    // Employment 15,000: taxable 2,430 -> 486.00 at 20%.
    // Starting-rate band 5,000 - 2,430 = 2,570 at 0%.
    // Basic-rate taxpayer PSA 1,000 at 0%. Remaining interest 4,000 - 2,570 - 1,000 = 430 x 20% = 86.00.
    const r = calc({ nonSavingsIncome: 15000, savingsInterest: 4000 });
    expect(r.rows.map(x => [x.kind, fx(x.income), fx(x.tax)])).toEqual([
      ['basic', '2430.00', '486.00'],
      ['starting_rate', '2570.00', '0.00'],
      ['personal_savings_allowance', '1000.00', '0.00'],
      ['basic', '430.00', '86.00'],
    ]);
    expect(fx(r.liability)).toBe('572.00');
  });

  it('halves the personal savings allowance for a higher-rate taxpayer', () => {
    // Employment 50,000: taxable 37,430 x 20% = 7,486.00; no starting-rate band left.
    // Total taxable with savings 39,430 is over 37,700, so PSA is 500.
    // Interest 2,000: 500 at 0%, the other 1,500 sits above the basic band: x 40% = 600.00.
    const r = calc({ nonSavingsIncome: 50000, savingsInterest: 2000 });
    expect(fx(r.liability)).toBe('8086.00');
  });

  it('gives no personal savings allowance to an additional-rate taxpayer', () => {
    const r = calc({ nonSavingsIncome: 150000, savingsInterest: 1000 });
    expect(r.rows.some(x => x.kind === 'personal_savings_allowance')).toBe(false);
  });

  it('dividends straddle the basic and higher bands, with the allowance using band space', () => {
    // Employment 44,570: taxable 32,000 x 20% = 6,400.00.
    // Basic band left: 37,700 - 32,000 = 5,700.
    // Dividends 9,000: first 500 at 0% (allowance, still uses band space) -> 5,200 of basic band left.
    // 5,200 x 8.75% = 455.00; remaining 9,000 - 500 - 5,200 = 3,300 x 33.75% = 1,113.75.
    // Total 6,400 + 455 + 1,113.75 = 7,968.75.
    const r = calc({ nonSavingsIncome: 44570, dividends: 9000 });
    expect(r.rows.map(x => [x.layer, x.kind, fx(x.income), x.ratePct.toString(), fx(x.tax)])).toEqual([
      ['non_savings', 'basic', '32000.00', '20', '6400.00'],
      ['dividends', 'dividend_allowance', '500.00', '0', '0.00'],
      ['dividends', 'basic', '5200.00', '8.75', '455.00'],
      ['dividends', 'higher', '3300.00', '33.75', '1113.75'],
    ]);
    expect(fx(r.liability)).toBe('7968.75');
  });

  it('uses the higher 2026-27 dividend rates', () => {
    // Same stack as above: 6,400 + 5,200 x 10.75% (559.00) + 3,300 x 35.75% (1,179.75) = 8,138.75.
    const r = calc({ nonSavingsIncome: 44570, dividends: 9000 }, '2026-27');
    expect(fx(r.liability)).toBe('8138.75');
  });

  it('does not tax dividends covered by spare personal allowance', () => {
    // Employment 10,000 leaves 2,570 of allowance for the dividends, then 500 allowance.
    // Dividends 5,000 -> taxable 2,430, of which 500 covered -> 1,930 x 8.75% = 168.875 -> 168.88.
    const r = calc({ nonSavingsIncome: 10000, dividends: 5000 });
    expect(fx(r.layerTaxable.dividends)).toBe('2430.00');
    expect(fx(r.liability)).toBe('168.88');
  });
});

describe('computeIncomeTax: S.24 finance-cost reducer', () => {
  it('is capped by property profit, carrying the rest forward', () => {
    // Employment 30,000 + property profit 3,000; finance costs 10,000.
    // Lowest of 10,000 / 3,000 / (33,000 - 12,570 = 20,430) is 3,000 -> 600.00; 7,000 carries forward.
    // Tax before: taxable 17,430 + 3,000 = 20,430 x 20% = 4,086; liability 3,486.
    const r = calc({ nonSavingsIncome: 30000, propertyProfit: 3000, financeCostsThisYear: 10000 });
    expect(r.financeCostReducer.limitedBy).toBe('property_profits');
    expect(fx(r.financeCostReducer.reducer)).toBe('600.00');
    expect(fx(r.financeCostReducer.carriedForward)).toBe('7000.00');
    expect(fx(r.liability)).toBe('3486.00');
  });

  it('is capped by adjusted total income over the personal allowance', () => {
    // Employment 8,000 + property profit 6,000 = 14,000; allowance 12,570 -> 1,430 over.
    // Finance costs 5,000, profit 6,000, ATI over allowance 1,430 -> lowest 1,430.
    // Reducer 20% x 1,430 = 286.00; carried forward 5,000 - 1,430 = 3,570.
    // Tax before reducer: property taxable 1,430 x 20% = 286.00 -> liability 0.
    const r = calc({ nonSavingsIncome: 8000, propertyProfit: 6000, financeCostsThisYear: 5000 });
    expect(r.financeCostReducer.limitedBy).toBe('adjusted_total_income');
    expect(fx(r.financeCostReducer.adjustedTotalIncomeCap)).toBe('1430.00');
    expect(fx(r.financeCostReducer.reducer)).toBe('286.00');
    expect(fx(r.financeCostReducer.carriedForward)).toBe('3570.00');
    expect(fx(r.liability)).toBe('0.00');
  });

  it('ignores savings and dividends when measuring adjusted total income', () => {
    // As above plus 5,000 of dividends: the cap is still 1,430 (dividends do not count).
    // Allowance 12,570: employment 8,000, property 4,570, so property taxable 1,430 -> 286.00.
    // Dividends 5,000 untouched by allowance: 500 at 0%, 4,500 x 8.75% = 393.75.
    // Before reductions 679.75; reducer 286.00; liability 393.75.
    const r = calc({
      nonSavingsIncome: 8000,
      propertyProfit: 6000,
      dividends: 5000,
      financeCostsThisYear: 5000,
    });
    expect(fx(r.financeCostReducer.adjustedTotalIncomeCap)).toBe('1430.00');
    expect(fx(r.taxBeforeReductions)).toBe('679.75');
    expect(fx(r.liability)).toBe('393.75');
  });

  it('adds finance costs brought forward to this year before applying the caps', () => {
    // 2,000 this year + 3,000 brought forward = 5,000; property profit 4,000 is lowest.
    const r = calc({
      nonSavingsIncome: 30000,
      propertyProfit: 4000,
      financeCostsThisYear: 2000,
      financeCostsBroughtForward: 3000,
    });
    expect(fx(r.financeCostReducer.financeCostsAvailable)).toBe('5000.00');
    expect(fx(r.financeCostReducer.reducer)).toBe('800.00');
    expect(fx(r.financeCostReducer.carriedForward)).toBe('1000.00');
  });

  it('measures adjusted total income against the tapered allowance', () => {
    // Income 110,000 employment + property 5,000 = 115,000 -> allowance 12,570 - 7,500 = 5,070.
    // ATI over allowance = 115,000 - 5,070 = 109,930, far above profit, so profit 5,000 caps it.
    const r = calc({ nonSavingsIncome: 110000, propertyProfit: 5000, financeCostsThisYear: 9000 });
    expect(fx(r.personalAllowance.effective)).toBe('5070.00');
    expect(fx(r.financeCostReducer.reducer)).toBe('1000.00');
  });

  it('gives no reducer when there is no property profit', () => {
    const r = calc({ nonSavingsIncome: 30000, propertyProfit: 0, financeCostsThisYear: 5000 });
    expect(fx(r.financeCostReducer.reducer)).toBe('0.00');
    expect(fx(r.financeCostReducer.carriedForward)).toBe('5000.00');
  });
});

describe('computeIncomeTax: 2027-28 property rates', () => {
  it('taxes property profit at 22% and relieves finance costs at 22%', () => {
    // Employment 12,570 uses the whole allowance. Property 8,200 x 22% = 1,804.00.
    // Reducer 22% x min(2,400; 8,200; 8,200) = 528.00. Liability 1,276.00.
    const r = calc({ nonSavingsIncome: 12570, propertyProfit: 8200, financeCostsThisYear: 2400 }, '2027-28');
    expect(fx(r.taxBeforeReductions)).toBe('1804.00');
    expect(fx(r.financeCostReducer.reducer)).toBe('528.00');
    expect(fx(r.liability)).toBe('1276.00');
  });

  it('stacks property above employment and taxes the higher slice at 42%', () => {
    // Employment 44,570 (taxable 32,000) x 20% = 6,400. Basic band left 5,700.
    // Property 10,000: 5,700 x 22% = 1,254.00 + 4,300 x 42% = 1,806.00.
    // Total 6,400 + 1,254 + 1,806 = 9,460.00.
    const r = calc({ nonSavingsIncome: 44570, propertyProfit: 10000 }, '2027-28');
    expect(r.rows.map(x => [x.layer, x.kind, fx(x.income), x.ratePct.toString(), fx(x.tax)])).toEqual([
      ['non_savings', 'basic', '32000.00', '20', '6400.00'],
      ['property', 'basic', '5700.00', '22', '1254.00'],
      ['property', 'higher', '4300.00', '42', '1806.00'],
    ]);
    expect(fx(r.liability)).toBe('9460.00');
  });

  it('sets the personal allowance against employment before property', () => {
    // Employment 5,000 takes 5,000 of the allowance; property takes the other 7,570.
    // Property taxable 10,000 - 7,570 = 2,430 x 22% = 534.60 (it would be 486.00 at 20%).
    const r = calc({ nonSavingsIncome: 5000, propertyProfit: 10000 }, '2027-28');
    expect(fx(r.layerTaxable.property)).toBe('2430.00');
    expect(fx(r.liability)).toBe('534.60');
    expect(fx(calc({ nonSavingsIncome: 5000, propertyProfit: 10000 }, '2026-27').liability)).toBe('486.00');
  });

  it('taxes savings interest at 22% from 2027-28', () => {
    // Employment 12,570 leaves nothing taxable, so the starting-rate band is 5,000.
    // Interest 8,000: 5,000 at 0%, PSA 1,000 at 0%, remaining 2,000 x 22% = 440.00.
    const r = calc({ nonSavingsIncome: 12570, savingsInterest: 8000 }, '2027-28');
    expect(fx(r.liability)).toBe('440.00');
  });
});

describe('computeIncomeTax: breakdown lines', () => {
  it('produces readable lines that end on the liability', () => {
    const r = calc({ nonSavingsIncome: 20000, propertyProfit: 6000, financeCostsThisYear: 4000 });
    expect(r.lines.length).toBeGreaterThan(4);
    expect(r.lines.every(l => l.section === 'Income tax' && l.text.length > 0)).toBe(true);
    const last = r.lines[r.lines.length - 1];
    expect(last.text).toContain('£1,886.00');
    expect(last.amount).toBe('1886.00');
  });
});

describe('computeIncomeTax: gross relief-at-source pension contributions', () => {
  it('restores the personal allowance from adjusted net income while keeping gross pay in income', () => {
    const r = calc({ nonSavingsIncome: 123500, reliefAtSourcePensionGross: 7600 });
    expect(fx(r.totalIncome)).toBe('123500.00');
    expect(fx(r.adjustedNetIncome)).toBe('115900.00');
    expect(fx(r.personalAllowance.effective)).toBe('4620.00');
    // Basic band is extended from £37,700 to £45,300; the contribution
    // also received £1,520 basic-rate relief inside the pension scheme.
    expect(fx(r.liability)).toBe('38492.00');
    expect(r.rows.map(row => [row.kind, fx(row.income)])).toEqual([
      ['basic', '45300.00'], ['higher', '73580.00'],
    ]);
  });

  it('extends the additional-rate threshold as well as the basic-rate limit', () => {
    const r = calc({ nonSavingsIncome: 150000, reliefAtSourcePensionGross: 30000 });
    expect(fx(r.adjustedNetIncome)).toBe('120000.00');
    expect(fx(r.personalAllowance.effective)).toBe('2570.00');
    expect(r.rows.some(row => row.kind === 'additional')).toBe(false);
    expect(fx(r.liability)).toBe('45432.00');
  });

  it('uses the extended bands when deciding the personal savings allowance', () => {
    const r = calc({ nonSavingsIncome: 60000, savingsInterest: 500, reliefAtSourcePensionGross: 11000 });
    expect(r.rows.find(row => row.kind === 'personal_savings_allowance')?.income.toFixed(2)).toBe('500.00');
    expect(r.rows.some(row => row.layer === 'savings' && row.tax.gt(0))).toBe(false);
  });

  it('rejects invalid relief-at-source amounts', () => {
    expect(() => calc({ reliefAtSourcePensionGross: -1 })).toThrow(ClientError);
    expect(() => calc({ reliefAtSourcePensionGross: 'not money' })).toThrow(ClientError);
  });
});
