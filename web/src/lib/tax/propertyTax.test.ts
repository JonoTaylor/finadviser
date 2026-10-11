import { describe, it, expect } from 'vitest';
import { ClientError } from '@/lib/errors';
import {
  computePropertyIncome,
  poolRentARoom,
  type PropertyLetting,
  type PropertyMethod,
  type RentARoomTreatment,
} from './propertyTax';
import { getRatesForTaxYear } from './taxRates';

const rates = getRatesForTaxYear('2025-26').table;

function run(
  properties: PropertyLetting[],
  opts: { method?: PropertyMethod; losses?: number; treatment?: RentARoomTreatment } = {},
) {
  return computePropertyIncome({
    rates,
    properties,
    method: opts.method ?? 'expenses',
    rentARoomTreatment: opts.treatment,
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

describe('computePropertyIncome: rent-a-room pooling and treatments', () => {
  // The caller (computeOwnerTax) now picks the treatment by final tax, so
  // these tests pass it explicitly. With none given, the default is HMRC's:
  // exempt within the limit, otherwise the normal method.

  it('has no rent-a-room result when there are no rent_a_room lettings', () => {
    expect(run([standard('Flat', 5000, 1000)]).rentARoom).toBeNull();
    expect(poolRentARoom([standard('Flat', 5000, 1000)], rates)).toBeNull();
  });

  it('is exempt at or under the shared £3,750 limit', () => {
    const atLimit = run([room('Home', 3750, 0, true)]);
    expect(atLimit.rentARoom?.treatment).toBe('exempt');
    expect(fx(atLimit.rentARoom!.limit)).toBe('3750.00');
    expect(atLimit.rentARoom!.validTreatments).toEqual(['exempt', 'normal']);
    expect(fx(atLimit.taxableProfit)).toBe('0.00');

    const under = run([room('Home', 3000, 500, true)]);
    expect(under.rentARoom?.treatment).toBe('exempt');
    expect(fx(under.taxableProfit)).toBe('0.00');
  });

  it('uses the full £7,500 limit when the letting is not shared', () => {
    const r = run([room('Home', 7000, 0, false)]);
    expect(fx(r.rentARoom!.limit)).toBe('7500.00');
    expect(r.rentARoom!.treatment).toBe('exempt');
    // The same receipts shared exceed the halved limit: only normal and alternative are valid.
    const shared = run([room('Home', 7000, 0, true)]);
    expect(shared.rentARoom!.validTreatments).toEqual(['normal', 'alternative']);
    expect(shared.rentARoom!.treatment).toBe('normal'); // the default over the limit
  });

  it('pools two homes under ONE limit (PIM4010), so two £5,000 homes are not both exempt', () => {
    // Pooled receipts 10,000 against one 7,500 limit: alternative method taxes 2,500.
    // (Per property, each 5,000 was under its own 7,500 and both were exempt.)
    const homes = [room('Home A', 5000, 0, false), room('Home B', 5000, 0, false)];
    const r = run(homes, { treatment: 'alternative' });
    expect(fx(r.rentARoom!.receipts)).toBe('10000.00');
    expect(fx(r.rentARoom!.limit)).toBe('7500.00');
    expect(r.rentARoom!.validTreatments).toEqual(['normal', 'alternative']);
    expect(fx(r.rentARoom!.alternativeTaxable)).toBe('2500.00');
    expect(fx(r.taxableProfit)).toBe('2500.00');
    expect(r.rentARoom!.lettings.map(l => [l.name, fx(l.receipts)])).toEqual([
      ['Home A', '5000.00'],
      ['Home B', '5000.00'],
    ]);
    // Exempt is not an option once the pool is over the limit.
    expect(() => run(homes, { treatment: 'exempt' })).toThrow(/not valid/);
  });

  it('halves the limit for the whole pool when ANY letting is shared (conservative)', () => {
    // 2,000 unshared + 3,000 shared = 5,000 against 3,750 -> alternative taxes 1,250.
    const r = run([room('Home A', 2000, 0, false), room('Home B', 3000, 0, true)], { treatment: 'alternative' });
    expect(r.rentARoom!.shared).toBe(true);
    expect(fx(r.rentARoom!.limit)).toBe('3750.00');
    expect(fx(r.taxableProfit)).toBe('1250.00');
    // Both unshared: the full limit, and 5,000 is exempt.
    const unshared = run([room('Home A', 2000, 0, false), room('Home B', 3000, 0, false)]);
    expect(fx(unshared.rentARoom!.limit)).toBe('7500.00');
    expect(unshared.rentARoom!.treatment).toBe('exempt');
  });

  it('alternative treatment taxes receipts less the limit with no expenses', () => {
    // Receipts 5,000, expenses 500, limit 3,750: alternative 1,250 vs normal 4,500.
    const r = run([room('Home', 5000, 500, true)], { treatment: 'alternative' });
    expect(fx(r.rentARoom!.alternativeTaxable)).toBe('1250.00');
    expect(fx(r.rentARoom!.normalResult)).toBe('4500.00');
    expect(fx(r.rentARoom!.taxable)).toBe('1250.00');
    expect(fx(r.taxableProfit)).toBe('1250.00');
    // Over the limit with no treatment given, HMRC's default is the normal method.
    expect(fx(run([room('Home', 5000, 500, true)]).taxableProfit)).toBe('4500.00');
  });

  it('normal treatment claims real expenses and puts mortgage interest in the S.24 pool', () => {
    // Receipts 5,000, expenses 4,000 -> profit 1,000; interest 600 is a finance cost, not a deduction.
    const r = run([room('Home', 5000, 4000, true, 600)], { treatment: 'normal' });
    expect(r.rentARoom!.treatment).toBe('normal');
    expect(fx(r.taxableProfit)).toBe('1000.00');
    expect(fx(r.rentARoom!.taxable)).toBe('1000.00');
    expect(fx(r.financeCostsClaimed)).toBe('600.00');
    expect(fx(r.rentARoom!.financeCostsClaimed)).toBe('600.00');
  });

  it('claims no finance costs on the exempt or alternative treatments', () => {
    const alt = run([room('Home', 5000, 500, true, 600)], { treatment: 'alternative' });
    expect(fx(alt.financeCostsClaimed)).toBe('0.00');
    expect(fx(alt.financeCostsUnclaimed)).toBe('600.00');
    const exempt = run([room('Home', 3000, 500, true, 600)], { treatment: 'exempt' });
    expect(fx(exempt.financeCostsClaimed)).toBe('0.00');
    expect(fx(exempt.financeCostsUnclaimed)).toBe('600.00');
  });

  it('normal treatment flows a rent-a-room loss into the property business loss', () => {
    const r = run([room('Home', 5000, 6000, true)], { treatment: 'normal' });
    expect(fx(r.currentYearResult)).toBe('-1000.00');
    expect(fx(r.lossesCarriedForward)).toBe('1000.00');
  });

  it('normal treatment lets a within-limit loss offset standard profit (elected out of the exemption)', () => {
    // Standard profit 15,000 - 2,000 = 13,000. Home: receipts 5,000 (within the 7,500 limit), expenses 10,000.
    // Exempt: 13,000. Normal: pool 20,000 - 12,000 = 8,000, so Home contributes a 5,000 loss.
    const props = [standard('Flat', 15000, 2000), room('Home', 5000, 10000, false)];
    expect(fx(run(props, { treatment: 'exempt' }).taxableProfit)).toBe('13000.00');
    const normal = run(props, { treatment: 'normal' });
    expect(fx(normal.standard.grossIncome)).toBe('20000.00');
    expect(normal.standard.includesRentARoom).toBe(true);
    expect(fx(normal.taxableProfit)).toBe('8000.00');
    expect(fx(normal.rentARoom!.taxable)).toBe('-5000.00');
  });

  it('normal treatment carries a rent-a-room loss forward exactly like a standard letting', () => {
    const r = run([room('Home', 5000, 10000, false)], { treatment: 'normal', losses: 1000 });
    expect(fx(r.currentYearResult)).toBe('-5000.00');
    expect(fx(r.taxableProfit)).toBe('0.00');
    expect(fx(r.lossesCarriedForward)).toBe('6000.00');
  });

  it('normal treatment puts the rent-a-room receipts under the property allowance too', () => {
    // Pool: Flat 5,000 + Home 3,000 = 8,000 receipts. Allowance profit 7,000; the Flat alone would be 4,000.
    const props = [standard('Flat', 5000, 4500), room('Home', 3000, 0, true)];
    const r = run(props, { method: 'allowance', treatment: 'normal' });
    expect(fx(r.standard.grossIncome)).toBe('8000.00');
    expect(fx(r.standard.profitByAllowance)).toBe('7000.00');
    expect(fx(r.taxableProfit)).toBe('7000.00');
    expect(fx(r.rentARoom!.taxable)).toBe('3000.00'); // 7,000 less the Flat's own 4,000
  });

  it('keeps exempt rent-a-room receipts out of the property allowance', () => {
    // Standard: receipts 5,000, expenses 4,500. Allowance would give 4,000.
    // The 3,000 of exempt rent-a-room receipts are NOT added to the pool the allowance covers.
    const r = run([standard('Flat', 5000, 4500), room('Home', 3000, 0, true)], { method: 'allowance' });
    expect(r.rentARoom?.treatment).toBe('exempt');
    expect(fx(r.standard.grossIncome)).toBe('5000.00');
    expect(fx(r.standard.profitByAllowance)).toBe('4000.00');
    expect(fx(r.taxableProfit)).toBe('4000.00');
  });

  it('keeps alternative-method receipts out of the property allowance too', () => {
    // The allowance covers the Flat only (5,000 - 1,000 = 4,000); the alternative amount 1,250 is added on top.
    const r = run([standard('Flat', 5000, 4500), room('Home', 5000, 500, true)], { method: 'allowance', treatment: 'alternative' });
    expect(fx(r.standard.grossIncome)).toBe('5000.00');
    expect(fx(r.taxableProfit)).toBe('5250.00');
  });

  it('adds the alternative-method amount to standard profit', () => {
    // Standard profit 500 + alternative-method 1,250 = 1,750.
    const r = run([standard('Flat', 5000, 4500), room('Home', 5000, 500, true)], { treatment: 'alternative' });
    expect(fx(r.currentYearResult)).toBe('1750.00');
  });

  it('states unclaimed finance costs on exempt homes when the allowance is used on the standard pool', () => {
    const r = run([standard('Flat', 5000, 0, 1500), room('Home', 3000, 0, true, 600)], { method: 'allowance' });
    expect(fx(r.financeCostsClaimed)).toBe('0.00');
    expect(fx(r.financeCostsUnclaimed)).toBe('2100.00');
    const text = r.lines.map(l => l.text).join('\n');
    expect(text).toContain('Finance costs £1,500.00 get no relief');
    expect(text).toContain('A further £600.00 on rent-a-room homes is not claimed');
  });
});

describe('computePropertyIncome: input checks and lines', () => {
  it('rejects negative losses brought forward and non-numeric amounts', () => {
    expect(() => run([], { losses: -5 })).toThrow(ClientError);
    expect(() => run([standard('A', Number.NaN, 0)])).toThrow(ClientError);
  });

  it('accepts ledger figures that went negative because refunds exceeded charges', () => {
    // Net expenses of -200 (a service-charge refund bigger than the year's costs) add to profit.
    const refund = run([standard('A', 5000, -200)]);
    expect(fx(refund.standard.profitByExpenses)).toBe('5200.00');
    // Net receipts below zero are just a bigger loss, and open no allowance relief.
    const negativeReceipts = run([standard('A', -100, 0)]);
    expect(fx(negativeReceipts.currentYearResult)).toBe('-100.00');
    expect(negativeReceipts.standard.allowanceRelief).toBe('none');
  });

  it('floors a net negative mortgage interest at zero finance costs', () => {
    const r = run([standard('A', 5000, 0, -50)]);
    expect(fx(r.financeCostsClaimed)).toBe('0.00');
  });

  it('writes a readable line for each step', () => {
    const r = run([standard('Flat', 5000, 4500), room('Home', 5000, 500, true)], { treatment: 'alternative' });
    expect(r.lines.every(l => l.section === 'Property income')).toBe(true);
    expect(r.lines.some(l => l.text.includes('Rent-a-room (Home)'))).toBe(true);
    expect(r.lines.some(l => l.text.includes('halved because the letting is shared'))).toBe(true);
    // Several lettings: each is listed, then the pooled computation names them together.
    const two = run([room('Home A', 2000, 0, false), room('Home B', 3000, 0, true)], { treatment: 'alternative' });
    expect(two.lines.some(l => l.text.startsWith('Rent-a-room (Home A): receipts £2,000.00'))).toBe(true);
    expect(two.lines.some(l => l.text.startsWith('Rent-a-room (Home B): receipts £3,000.00'))).toBe(true);
    expect(two.lines.some(l => l.text.includes('all 2 lettings together') && l.text.includes('halved because at least one of the lettings is shared'))).toBe(true);
  });
});
