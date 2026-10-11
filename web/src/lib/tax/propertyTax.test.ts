import { describe, it, expect } from 'vitest';
import { ClientError } from '@/lib/errors';
import {
  computePropertyIncome,
  type PropertyLetting,
  type PropertyMethod,
} from './propertyTax';
import { getRatesForTaxYear } from './taxRates';

const rates = getRatesForTaxYear('2025-26').table;

function run(
  properties: PropertyLetting[],
  opts: { method?: PropertyMethod; losses?: number } = {},
) {
  return computePropertyIncome({
    rates,
    properties,
    method: opts.method ?? 'expenses',
    lossesBroughtForward: opts.losses ?? 0,
  });
}

function standard(name: string, income: number, expenses: number, interest = 0): PropertyLetting {
  return { name, lettingType: 'standard', grossIncome: income, totalExpenses: expenses, mortgageInterest: interest };
}

function room(name: string, income: number, expenses: number, shared: boolean, interest = 0): PropertyLetting {
  return {
    name,
    lettingType: 'rent_a_room',
    grossIncome: income,
    totalExpenses: expenses,
    mortgageInterest: interest,
    rentARoomShared: shared,
  };
}

const fx = (d: { toFixed: (n: number) => string }) => d.toFixed(2);

describe('computePropertyIncome: standard lettings', () => {
  it('pools every standard letting into one business', () => {
    // A: 10,000 - 2,000; B: 3,000 - 500 -> receipts 13,000, expenses 2,500, profit 10,500.
    const r = run([standard('A', 10000, 2000, 1500), standard('B', 3000, 500)]);
    expect(fx(r.standard.grossIncome)).toBe('13000.00');
    expect(fx(r.standard.expenses)).toBe('2500.00');
    expect(fx(r.standard.profitByExpenses)).toBe('10500.00');
    expect(fx(r.taxableProfit)).toBe('10500.00');
    // Mortgage interest is not deducted from profit; it goes to the S.24 pool.
    expect(fx(r.financeCostsClaimed)).toBe('1500.00');
  });

  it('property allowance (partial relief) replaces expenses and forfeits finance costs', () => {
    // Receipts 13,000 - 1,000 allowance = 12,000 profit; expenses and finance costs not claimed.
    const r = run([standard('A', 10000, 2000, 1500), standard('B', 3000, 500)], { method: 'allowance' });
    expect(r.standard.allowanceRelief).toBe('partial');
    expect(fx(r.standard.profitByAllowance)).toBe('12000.00');
    expect(fx(r.taxableProfit)).toBe('12000.00');
    expect(fx(r.financeCostsClaimed)).toBe('0.00');
    expect(fx(r.financeCostsUnclaimed)).toBe('1500.00');
  });

  it('allowance beats expenses when expenses are under £1,000', () => {
    // Receipts 3,000, expenses 400: expenses profit 2,600; allowance profit 2,000.
    const r = run([standard('A', 3000, 400)]);
    expect(fx(r.standard.profitByExpenses)).toBe('2600.00');
    expect(fx(r.standard.profitByAllowance)).toBe('2000.00');
  });

  it('full relief gives nil profit when receipts are within the allowance', () => {
    const r = run([standard('A', 800, 100)], { method: 'allowance' });
    expect(r.standard.allowanceRelief).toBe('full');
    expect(fx(r.taxableProfit)).toBe('0.00');
    expect(fx(r.lossesCarriedForward)).toBe('0.00');
  });

  it('partial relief can never create a loss', () => {
    const r = run([standard('A', 1000.01, 5000)], { method: 'allowance' });
    expect(fx(r.standard.profitByAllowance)).toBe('0.01');
    expect(r.currentYearResult.isNeg()).toBe(false);
  });

  it('reports no allowance relief when there are no standard receipts', () => {
    expect(run([]).standard.allowanceRelief).toBe('none');
  });
});

describe('computePropertyIncome: losses', () => {
  it('carries a loss forward and taxes nothing', () => {
    // Receipts 5,000 - expenses 7,000 = loss of 2,000.
    const r = run([standard('A', 5000, 7000)]);
    expect(fx(r.currentYearResult)).toBe('-2000.00');
    expect(fx(r.taxableProfit)).toBe('0.00');
    expect(fx(r.lossesCarriedForward)).toBe('2000.00');
  });

  it('adds a new loss to losses already brought forward', () => {
    const r = run([standard('A', 5000, 7000)], { losses: 1000 });
    expect(fx(r.lossesCarriedForward)).toBe('3000.00');
  });

  it('sets losses brought forward against profit', () => {
    // Profit 5,000; brought forward 3,000 -> taxable 2,000, nothing left.
    const r = run([standard('A', 9000, 4000)], { losses: 3000 });
    expect(fx(r.lossesUsed)).toBe('3000.00');
    expect(fx(r.taxableProfit)).toBe('2000.00');
    expect(fx(r.lossesCarriedForward)).toBe('0.00');
  });

  it('carries the unused part of losses brought forward when profit is smaller', () => {
    // Profit 5,000; brought forward 8,000 -> all 5,000 absorbed, 3,000 left.
    const r = run([standard('A', 9000, 4000)], { losses: 8000 });
    expect(fx(r.lossesUsed)).toBe('5000.00');
    expect(fx(r.taxableProfit)).toBe('0.00');
    expect(fx(r.lossesCarriedForward)).toBe('3000.00');
  });
});

describe('computePropertyIncome: rent-a-room', () => {
  it('is exempt at or under the shared £3,750 limit', () => {
    const atLimit = run([room('Home', 3750, 0, true)]);
    expect(atLimit.rentARoom[0].outcome).toBe('exempt');
    expect(fx(atLimit.rentARoom[0].limit)).toBe('3750.00');
    expect(fx(atLimit.taxableProfit)).toBe('0.00');

    const under = run([room('Home', 3000, 500, true)]);
    expect(under.rentARoom[0].outcome).toBe('exempt');
    expect(fx(under.taxableProfit)).toBe('0.00');
  });

  it('uses the full £7,500 limit when the letting is not shared', () => {
    const r = run([room('Home', 7000, 0, false)]);
    expect(fx(r.rentARoom[0].limit)).toBe('7500.00');
    expect(r.rentARoom[0].outcome).toBe('exempt');
    // The same receipts shared would exceed the halved limit.
    expect(run([room('Home', 7000, 0, true)]).rentARoom[0].outcome).toBe('alternative');
  });

  it('picks the alternative method over the shared limit when it is lower', () => {
    // Receipts 5,000, expenses 500, limit 3,750: alternative 1,250 vs normal 4,500 -> 1,250.
    const r = run([room('Home', 5000, 500, true)]);
    expect(r.rentARoom[0].outcome).toBe('alternative');
    expect(fx(r.rentARoom[0].alternativeTaxable)).toBe('1250.00');
    expect(fx(r.rentARoom[0].normalResult)).toBe('4500.00');
    expect(fx(r.taxableProfit)).toBe('1250.00');
  });

  it('picks the normal method when real expenses are higher than the limit', () => {
    // Receipts 5,000, expenses 4,000: alternative 1,250 vs normal 1,000 -> normal, 1,000.
    // Mortgage interest is claimed as a finance cost only on the normal method.
    const r = run([room('Home', 5000, 4000, true, 600)]);
    expect(r.rentARoom[0].outcome).toBe('normal');
    expect(fx(r.taxableProfit)).toBe('1000.00');
    expect(fx(r.financeCostsClaimed)).toBe('600.00');
  });

  it('claims no finance costs on the exempt or alternative methods', () => {
    const r = run([room('Home', 5000, 500, true, 600)]);
    expect(fx(r.financeCostsClaimed)).toBe('0.00');
    expect(fx(r.financeCostsUnclaimed)).toBe('600.00');
  });

  it('flows a normal-method loss into the property business loss', () => {
    const r = run([room('Home', 5000, 6000, true)]);
    expect(r.rentARoom[0].outcome).toBe('normal');
    expect(fx(r.currentYearResult)).toBe('-1000.00');
    expect(fx(r.lossesCarriedForward)).toBe('1000.00');
  });

  it('keeps rent-a-room receipts out of the property allowance', () => {
    // Standard: receipts 5,000, expenses 4,500. Allowance would give 4,000.
    // The 3,000 of exempt rent-a-room receipts are NOT added to the pool the allowance covers.
    const r = run([standard('Flat', 5000, 4500), room('Home', 3000, 0, true)], { method: 'allowance' });
    expect(fx(r.standard.grossIncome)).toBe('5000.00');
    expect(fx(r.standard.profitByAllowance)).toBe('4000.00');
    expect(fx(r.taxableProfit)).toBe('4000.00');
  });

  it('adds the rent-a-room taxable amount to standard profit', () => {
    // Standard profit 500 + alternative-method 1,250 = 1,750.
    const r = run([standard('Flat', 5000, 4500), room('Home', 5000, 500, true)]);
    expect(fx(r.currentYearResult)).toBe('1750.00');
  });
});

describe('computePropertyIncome: input checks and lines', () => {
  it('rejects negative money', () => {
    expect(() => run([standard('A', -1, 0)])).toThrow(ClientError);
    expect(() => run([], { losses: -5 })).toThrow(ClientError);
  });

  it('writes a readable line for each step', () => {
    const r = run([standard('Flat', 5000, 4500), room('Home', 5000, 500, true)]);
    expect(r.lines.every(l => l.section === 'Property income')).toBe(true);
    expect(r.lines.some(l => l.text.includes('Rent-a-room (Home)'))).toBe(true);
    expect(r.lines.some(l => l.text.includes('halved because the letting is shared'))).toBe(true);
  });
});
