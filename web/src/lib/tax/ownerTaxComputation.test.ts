import { describe, it, expect } from 'vitest';
import { ClientError } from '@/lib/errors';
import {
  computeOwnerTax,
  type OwnerTaxComputation,
  type OwnerTaxProfileInput,
  type PropertyLetting,
} from './ownerTaxComputation';
import noRentARoomFixture from './__fixtures__/ownerTaxNoRentARoom.json';

const EMPTY_PROFILE: OwnerTaxProfileInput = {
  employmentIncome: 0,
  payeTaxPaid: 0,
  selfEmploymentIncome: 0,
  savingsInterest: 0,
  dividends: 0,
  otherIncome: 0,
  propertyLossesBroughtForward: 0,
  financeCostsBroughtForward: 0,
};

function run(
  properties: PropertyLetting[],
  profile: Partial<OwnerTaxProfileInput> = {},
  taxYear = '2025-26',
) {
  return computeOwnerTax({ taxYear, properties, profile: { ...EMPTY_PROFILE, ...profile } });
}

function flat(income: number, expenses: number, interest = 0, name = 'Flat'): PropertyLetting {
  return { name, lettingType: 'standard', grossIncome: income, totalExpenses: expenses, mortgageInterest: interest };
}

describe('computeOwnerTax: realistic Emily-like scenario (2025-26)', () => {
  // Salary 12,570 (1,047.50 x 12) with no tax deducted because 1257L covers it all.
  // 50% of a buy-to-let let at £2,000 a month for 10 months: rent 20,000, her share 10,000.
  // Her share of costs: service charge, insurance and agent 1,800; mortgage interest 2,400.
  const result = run(
    [flat(10000, 1800, 2400, '249 Francis Road')],
    { employmentIncome: 12570, payeTaxPaid: 0 },
  );

  it('works out the property profit on actual expenses', () => {
    // Expenses 10,000 - 1,800 = 8,200 beats the allowance (10,000 - 1,000 = 9,000).
    expect(result.property.method).toBe('expenses');
    expect(result.property.profitByExpenses).toBe('8200.00');
    expect(result.property.profitByAllowance).toBe('9000.00');
    expect(result.property.taxableProfit).toBe('8200.00');
  });

  it('taxes it all at 20% because the salary uses the whole personal allowance', () => {
    // 8,200 x 20% = 1,640.00 before the S.24 reducer.
    expect(result.incomeTax.taxBeforeReductions).toBe('1640.00');
    expect(result.incomeTax.rows).toHaveLength(1);
    expect(result.incomeTax.rows[0]).toMatchObject({ layer: 'property', kind: 'basic', ratePct: '20', tax: '1640.00' });
  });

  it('gives S.24 relief on the mortgage interest at 20%', () => {
    // 20% x lowest of finance costs 2,400, profit 8,200, ATI over allowance 8,200 = 480.00.
    expect(result.financeCosts.limitedBy).toBe('finance_costs');
    expect(result.financeCosts.reducer).toBe('480.00');
    expect(result.financeCosts.carriedForward).toBe('0.00');
    expect(result.financeCosts.hasFinanceCosts).toBe(true);
    expect(result.financeCosts.hasCarriedForward).toBe(false);
    expect(result.property.hasLosses).toBe(false);
    // Liability 1,640 - 480 = 1,160.00.
    expect(result.incomeTax.liability).toBe('1160.00');
  });

  it('attributes the whole bill to the rental income', () => {
    // Salary alone is covered by the allowance, so without the flat the tax is nil.
    expect(result.taxOnRentalIncome.liabilityWithoutProperty).toBe('0.00');
    expect(result.taxOnRentalIncome.amount).toBe('1160.00');
  });

  it('shows a Self Assessment balance with payments on account', () => {
    // PAYE paid is nil, so the whole 1,160 is due by 31 Jan 2027.
    expect(result.selfAssessment.balanceDue).toBe('1160.00');
    expect(result.selfAssessment.amountDue).toBe('1160.00');
    expect(result.selfAssessment.refundDue).toBe('0.00');
    expect(result.selfAssessment.isRefund).toBe(false);
    expect(result.selfAssessment.deadline).toBe('2027-01-31');
    // 1,160 is at least 1,000 and 0% was collected at source, so payments on account apply:
    // two of 580.00, on 31 Jan and 31 Jul 2027, with the first due alongside the balance.
    expect(result.selfAssessment.paymentsOnAccount.required).toBe(true);
    expect(result.selfAssessment.paymentsOnAccount.instalments).toEqual([
      { dueDate: '2027-01-31', amount: '580.00' },
      { dueDate: '2027-07-31', amount: '580.00' },
    ]);
    expect(result.selfAssessment.paymentsOnAccount.dueOnDeadline).toBe('1740.00');
  });

  it('is well under the MTD threshold for 2025-26 income', () => {
    // Gross rent 10,000 against the £30,000 threshold (from April 2027).
    expect(result.mtd.qualifyingIncome).toBe('10000.00');
    expect(result.mtd.scope).toBe('below_threshold');
    expect(result.mtd.headroom).toBe('20000.00');
  });

  it('uses confirmed rates with no warnings about the rates', () => {
    expect(result.rates.assumed).toBe(false);
    expect(result.rates.provisional).toBe(false);
    expect(result.warnings).toEqual([]);
  });
});

describe('computeOwnerTax: choosing between expenses and the property allowance', () => {
  it('picks the property allowance when it beats actual expenses', () => {
    // Employment 20,000 (taxable 7,430 -> 1,486.00). Flat receipts 3,000, expenses 400.
    // Expenses: profit 2,600 x 20% = 520 -> 2,006.00. Allowance: profit 2,000 x 20% = 400 -> 1,886.00.
    const r = run([flat(3000, 400)], { employmentIncome: 20000 });
    expect(r.property.method).toBe('allowance');
    expect(r.property.taxableProfit).toBe('2000.00');
    expect(r.incomeTax.liability).toBe('1886.00');
    expect(r.taxOnRentalIncome.amount).toBe('400.00');
    expect(r.property.methods.map(m => [m.method, m.available, m.liability])).toEqual([
      ['expenses', true, '2006.00'],
      ['allowance', true, '1886.00'],
    ]);
    expect(r.property.methodReason).toContain('Property allowance used');
  });

  it('keeps actual expenses when mortgage interest relief is worth more than the allowance', () => {
    // Same flat but with 2,000 mortgage interest. Expenses: 2,006 - S.24 reducer (20% x 2,000 = 400) = 1,606.00.
    // Allowance: 1,886.00 with no reducer, so expenses win even though the profit is higher.
    const r = run([flat(3000, 400, 2000)], { employmentIncome: 20000 });
    expect(r.property.method).toBe('expenses');
    expect(r.incomeTax.liability).toBe('1606.00');
    expect(r.property.methods[1]).toMatchObject({ method: 'allowance', available: true, liability: '1886.00' });
    expect(r.property.methodReason).toContain('give up the S.24 finance-cost reducer');
  });

  it('breaks a tie in favour of actual expenses', () => {
    // Employment under the allowance and receipts small enough that tax is nil either way.
    const r = run([flat(500, 100)], { employmentIncome: 0 });
    expect(r.incomeTax.liability).toBe('0.00');
    expect(r.property.method).toBe('expenses');
  });

  it('rules out partial relief while finance costs brought forward are being relieved', () => {
    // Without brought-forward costs the allowance would win (as in the first test).
    // With 1,000 brought forward the reducer applies (20% x 1,000 = 200), so the allowance is blocked.
    const r = run([flat(3000, 400)], { employmentIncome: 20000, financeCostsBroughtForward: 1000 });
    expect(r.property.method).toBe('expenses');
    expect(r.property.methods[1].available).toBe(false);
    expect(r.property.methods[1].note).toContain('brought forward');
    expect(r.financeCosts.reducer).toBe('200.00');
    expect(r.financeCosts.carriedForward).toBe('0.00');
  });

  it('still allows full relief when brought-forward finance costs exist and receipts are within £1,000', () => {
    const r = run([flat(800, 100)], { employmentIncome: 20000, financeCostsBroughtForward: 1000 });
    expect(r.property.methods[1].available).toBe(true);
    // Allowance gives nil profit (tax 1,486.00 on employment only); expenses give profit 700
    // and a 140.00 reducer: 1,486 + 140 - 140 = 1,486.00. Tie -> expenses.
    expect(r.incomeTax.liability).toBe('1486.00');
    expect(r.property.method).toBe('expenses');
  });

  it('offers no allowance when there are no standard receipts', () => {
    const r = run([], { employmentIncome: 20000 });
    expect(r.property.methods[1].available).toBe(false);
    expect(r.property.allowanceRelief).toBe('none');
  });
});

describe('computeOwnerTax: losses and carry-forwards', () => {
  it('carries a property loss forward and reports no tax on rental income', () => {
    // Receipts 5,000, expenses 7,000: a 2,000 loss. Expenses (loss) beat the allowance (profit 4,000).
    const r = run([flat(5000, 7000)], { employmentIncome: 20000 });
    expect(r.property.method).toBe('expenses');
    expect(r.property.currentYearResult).toBe('-2000.00');
    expect(r.property.taxableProfit).toBe('0.00');
    expect(r.property.lossesCarriedForward).toBe('2000.00');
    expect(r.property.hasLosses).toBe(true);
    expect(r.taxOnRentalIncome.amount).toBe('0.00');
  });

  it('uses losses brought forward against this year profit', () => {
    // Profit 9,000 - 4,000 = 5,000; brought forward 3,000 -> taxable 2,000.
    const r = run([flat(9000, 4000)], { employmentIncome: 20000, propertyLossesBroughtForward: 3000 });
    expect(r.property.lossesUsed).toBe('3000.00');
    expect(r.property.taxableProfit).toBe('2000.00');
    expect(r.property.lossesCarriedForward).toBe('0.00');
  });

  it('carries unrelieved finance costs forward when the profit cap bites', () => {
    // Profit 3,000, finance costs 10,000 and 1,000 brought forward: relief on 3,000 only.
    const r = run([flat(5000, 2000, 10000)], { employmentIncome: 30000, financeCostsBroughtForward: 1000 });
    expect(r.financeCosts.available).toBe('11000.00');
    expect(r.financeCosts.limitedBy).toBe('property_profits');
    expect(r.financeCosts.relieved).toBe('3000.00');
    expect(r.financeCosts.reducer).toBe('600.00');
    expect(r.financeCosts.carriedForward).toBe('8000.00');
    expect(r.financeCosts.hasCarriedForward).toBe(true);
  });
});

describe('computeOwnerTax: higher-rate taxpayer and payments on account', () => {
  // Salary 60,000 with PAYE of 11,432 already deducted
  // ((60,000 - 12,570) = 47,430: 37,700 x 20% + 9,730 x 40% = 7,540 + 3,892).
  // Flat: receipts 20,000, expenses 10,000, mortgage interest 6,000 -> profit 10,000.
  const higher = run(
    [flat(20000, 10000, 6000)],
    { employmentIncome: 60000, payeTaxPaid: 11432 },
  );

  it('taxes the profit at 40% less the S.24 reducer', () => {
    // 10,000 x 40% = 4,000; reducer 20% x 6,000 = 1,200; liability 11,432 + 4,000 - 1,200 = 14,232.
    expect(higher.incomeTax.liability).toBe('14232.00');
    expect(higher.taxOnRentalIncome.amount).toBe('2800.00');
    expect(higher.selfAssessment.balanceDue).toBe('2800.00');
  });

  it('skips payments on account when more than 80% was collected at source', () => {
    // 11,432 / 14,232 = 80.33% collected at source, so no payments on account even though the balance is over £1,000.
    expect(higher.selfAssessment.paymentsOnAccount.collectedAtSourcePct).toBe('80.33');
    expect(higher.selfAssessment.paymentsOnAccount.required).toBe(false);
    expect(higher.selfAssessment.paymentsOnAccount.instalments).toEqual([]);
    expect(higher.selfAssessment.paymentsOnAccount.dueOnDeadline).toBe('2800.00');
    expect(higher.selfAssessment.paymentsOnAccount.reason).toContain('collected at source');
  });

  it('skips payments on account when the balance is under £1,000', () => {
    // Employment 30,000 with its tax paid (3,486). Receipts 3,000: allowance profit 2,000 x 20% = 400.
    const r = run([flat(3000, 0)], { employmentIncome: 30000, payeTaxPaid: 3486 });
    expect(r.selfAssessment.balanceDue).toBe('400.00');
    expect(r.selfAssessment.paymentsOnAccount.required).toBe(false);
    expect(r.selfAssessment.paymentsOnAccount.reason).toContain('under');
  });

  // Employment 30,000 is taxed at 3,486. Receipts 13,570 on the allowance give profit 12,570 x 20% = 2,514,
  // so the liability is exactly 6,000.
  const six = (paye: number) =>
    run([flat(13570, 0)], { employmentIncome: 30000, payeTaxPaid: paye });

  it('requires payments on account at exactly 80% collected (the limit is MORE than 80%)', () => {
    // 4,800 / 6,000 = 80.00%; balance 1,200.
    const r = six(4800);
    expect(r.incomeTax.liability).toBe('6000.00');
    expect(r.selfAssessment.paymentsOnAccount.collectedAtSourcePct).toBe('80.00');
    expect(r.selfAssessment.paymentsOnAccount.required).toBe(true);
    expect(r.selfAssessment.paymentsOnAccount.instalments.map(i => i.amount)).toEqual(['600.00', '600.00']);
  });

  it('drops payments on account just over 80% collected', () => {
    // 4,801 / 6,000 = 80.02%.
    expect(six(4801).selfAssessment.paymentsOnAccount.required).toBe(false);
  });

  it('requires payments on account at a balance of exactly £1,000 (the limit is LESS than £1,000)', () => {
    // Employment 12,570 (no tax). Receipts 6,000 on the allowance: profit 5,000 x 20% = 1,000.00.
    const r = run([flat(6000, 0)], { employmentIncome: 12570 });
    expect(r.incomeTax.liability).toBe('1000.00');
    expect(r.selfAssessment.paymentsOnAccount.required).toBe(true);
    expect(r.selfAssessment.paymentsOnAccount.instalments.map(i => i.amount)).toEqual(['500.00', '500.00']);
  });

  it('shows an overpayment as a refund with no payments on account', () => {
    const r = run([], { employmentIncome: 20000, payeTaxPaid: 2000 });
    // Liability 1,486.00; paid 2,000.
    expect(r.selfAssessment.balanceDue).toBe('-514.00');
    expect(r.selfAssessment.amountDue).toBe('0.00');
    expect(r.selfAssessment.refundDue).toBe('514.00');
    expect(r.selfAssessment.isRefund).toBe(true);
    expect(r.selfAssessment.paymentsOnAccount.required).toBe(false);
    expect(r.warnings.some(w => w.includes('repayment of £514.00'))).toBe(true);
  });
});

describe('computeOwnerTax: rent-a-room (the family home)', () => {
  // A home let to a lodger, with two people receiving the income, so the limit is £3,750 each.
  const home = (income: number): PropertyLetting => ({
    name: 'Home',
    lettingType: 'rent_a_room',
    grossIncome: income,
    totalExpenses: 0,
    mortgageInterest: 0,
    rentARoomShared: true,
  });

  it('is exempt under the shared limit', () => {
    const r = run([home(3000)], { employmentIncome: 12570 });
    expect(r.property.rentARoomPool).toMatchObject({ treatment: 'exempt', limit: '3750.00', taxable: '0.00' });
    expect(r.property.rentARoom).toEqual([{ name: 'Home', receipts: '3000.00', expenses: '0.00', financeCosts: '0.00', shared: true }]);
    expect(r.incomeTax.liability).toBe('0.00');
    expect(r.taxOnRentalIncome.amount).toBe('0.00');
  });

  it('taxes only the excess over the shared limit by the alternative method', () => {
    // Her 65.08% share of 8,000 of rent = 5,206.40; limit 3,750; taxable 1,456.40 x 20% = 291.28.
    const r = run([home(5206.4)], { employmentIncome: 12570 });
    expect(r.property.rentARoomPool).toMatchObject({ treatment: 'alternative', taxable: '1456.40' });
    expect(r.incomeTax.liability).toBe('291.28');
  });

  it('counts rent-a-room receipts towards MTD qualifying income', () => {
    const r = run([home(3000), flat(10000, 0)], { employmentIncome: 12570 });
    expect(r.mtd.propertyReceipts).toBe('13000.00');
  });

  it('warns when a rent-a-room home has recorded expenses or mortgage interest', () => {
    const r = run([{ ...home(5000), totalExpenses: 300 }], { employmentIncome: 12570 });
    expect(r.warnings.some(w => w.includes('rent-a-room letting'))).toBe(true);
  });
});

// A rent_a_room letting at the owner's share. `shared` halves the limit.
function room(name: string, income: number, expenses: number, shared = false, interest = 0): PropertyLetting {
  return { name, lettingType: 'rent_a_room', grossIncome: income, totalExpenses: expenses, mortgageInterest: interest, rentARoomShared: shared };
}

/** Every option's income tax, keyed `<method>/<rent-a-room treatment>` ('-' = unavailable). */
function liabilities(r: OwnerTaxComputation): Record<string, string> {
  return Object.fromEntries(r.property.methods.map(m => [`${m.method}/${m.rentARoom ?? 'none'}`, m.liability ?? '-']));
}

describe('computeOwnerTax: rent-a-room is pooled under one limit (PIM4010)', () => {
  it('taxes two £5,000 homes by the alternative method instead of exempting both', () => {
    // Employment 12,570 is covered by the allowance. Pooled receipts 10,000 against ONE 7,500 limit.
    // Alternative: (10,000 - 7,500) = 2,500 x 20% = 500.00.
    // Normal: no expenses, so profit 10,000 x 20% = 2,000.00 (allowance on the merged pool: 9,000 x 20% = 1,800.00).
    // The old per-property rule exempted both homes (each 5,000 < 7,500) and gave 0.00.
    const r = run([room('Home A', 5000, 0), room('Home B', 5000, 0)], { employmentIncome: 12570 });
    expect(r.property.rentARoomPool).toMatchObject({
      treatment: 'alternative', receipts: '10000.00', limit: '7500.00', shared: false,
      alternativeTaxable: '2500.00', normalResult: '10000.00', taxable: '2500.00',
    });
    expect(r.property.rentARoom.map(l => [l.name, l.receipts])).toEqual([['Home A', '5000.00'], ['Home B', '5000.00']]);
    expect(r.property.taxableProfit).toBe('2500.00');
    expect(r.incomeTax.liability).toBe('500.00');
    expect(liabilities(r)).toEqual({
      'expenses/normal': '2000.00',
      'allowance/normal': '1800.00',
      'expenses/alternative': '500.00',
      'allowance/alternative': '-', // no standard receipts for the allowance to cover
    });
    expect(r.property.methods.filter(m => m.chosen).map(m => [m.method, m.rentARoom])).toEqual([['expenses', 'alternative']]);
  });

  it('applies the halved limit to the combined receipts when one of two homes is shared', () => {
    // Home A 2,000 (not shared) + Home B 3,000 (shared) = 5,000 against 3,750, not 7,500.
    // Alternative: (5,000 - 3,750) = 1,250 x 20% = 250.00. Normal on the allowance: (5,000 - 1,000) x 20% = 800.00.
    // Per property each was under its own limit (7,500 and 3,750), so both were exempt.
    const r = run([room('Home A', 2000, 0, false), room('Home B', 3000, 0, true)], { employmentIncome: 12570 });
    expect(r.property.rentARoomPool).toMatchObject({
      treatment: 'alternative', receipts: '5000.00', limit: '3750.00', shared: true, taxable: '1250.00',
    });
    expect(r.incomeTax.liability).toBe('250.00');
    expect(r.property.methods.find(m => m.method === 'allowance' && m.rentARoom === 'normal')?.liability).toBe('800.00');
  });

  it('names every home in the breakdown, with the pooled total', () => {
    const r = run([room('Home A', 5000, 0), room('Home B', 5000, 0)], { employmentIncome: 12570 });
    const text = r.breakdown.filter(l => l.section === 'Property income').map(l => l.text);
    expect(text.some(t => t.startsWith('Rent-a-room (Home A): receipts £5,000.00'))).toBe(true);
    expect(text.some(t => t.startsWith('Rent-a-room (Home B): receipts £5,000.00'))).toBe(true);
    expect(text.some(t => t.includes('all 2 lettings together') && t.includes('£10,000.00') && t.includes('single limit of £7,500.00'))).toBe(true);
  });
});

describe('computeOwnerTax: the rent-a-room choice is made on final tax, not profit (PIM4030, PIM4460)', () => {
  // Employment 20,000, rent-a-room receipts 10,000 (not shared: limit 7,500), no ordinary expenses,
  // mortgage interest 10,000. Taxable employment 20,000 - 12,570 = 7,430 -> 1,486.00.
  const r = run([room('Home', 10000, 0, false, 10000)], { employmentIncome: 20000 });

  it('picks the normal method because only it keeps the S.24 reducer', () => {
    // Alternative: profit 2,500 x 20% = 500 -> 1,986.00; no finance-cost relief. Adds 500.
    // Normal: profit 10,000 x 20% = 2,000 -> 3,486.00 before reductions; reducer 20% x min(10,000 interest,
    //   10,000 profit, 17,430 income above allowance) = 2,000.00 -> 1,486.00. Adds 0.
    // Normal on the allowance: 9,000 x 20% = 1,800 -> 3,286.00 and the reducer is forfeited.
    expect(r.property.rentARoomPool?.treatment).toBe('normal');
    expect(r.property.method).toBe('expenses');
    expect(r.financeCosts.reducer).toBe('2000.00');
    expect(r.incomeTax.liability).toBe('1486.00');
    expect(r.taxOnRentalIncome.amount).toBe('0.00');
    expect(liabilities(r)).toEqual({
      'expenses/normal': '1486.00',
      'allowance/normal': '3286.00',
      'expenses/alternative': '1986.00',
      'allowance/alternative': '-',
    });
  });

  it('explains why, and keeps the comparison in the breakdown', () => {
    expect(r.property.rentARoomPool?.reason).toBe(
      'Normal method used: pooled receipts £10,000.00 exceed the single £7,500.00 limit, and receipts less expenses ' +
        '(finance costs earning the S.24 reducer) give income tax of £1,486.00 against £1,986.00 with the alternative method, ' +
        'which allows no expenses and no finance-cost relief.',
    );
    const method = r.breakdown.filter(l => l.section === 'Property method').map(l => l.text);
    expect(method).toContain(r.property.rentARoomPool?.reason);
    expect(method.some(t => t.startsWith('Actual expenses, rent-a-room alternative method:') && t.includes('income tax £1,986.00'))).toBe(true);
  });

  it('still picks the alternative method when there is no finance cost to lose', () => {
    // Same receipts, no mortgage interest: alternative 500.00 total against normal 2,000.00 -> alternative.
    const noInterest = run([room('Home', 10000, 0, false, 0)], { employmentIncome: 20000 });
    expect(noInterest.property.rentARoomPool?.treatment).toBe('alternative');
    expect(noInterest.incomeTax.liability).toBe('1986.00');
  });

  it('picks the alternative method when it is only just over the limit and cheaper', () => {
    // Receipts 7,600, no expenses or finance costs, employment 12,570. Over the 7,500 limit by 100.
    // Alternative: 100 x 20% = 20.00. Normal: 7,600 x 20% = 1,520.00 (allowance: 6,600 x 20% = 1,320.00).
    const justOver = run([room('Home', 7600, 0)], { employmentIncome: 12570 });
    expect(justOver.property.rentARoomPool).toMatchObject({ treatment: 'alternative', taxable: '100.00' });
    expect(justOver.incomeTax.liability).toBe('20.00');
    expect(liabilities(justOver)).toMatchObject({ 'expenses/normal': '1520.00', 'allowance/normal': '1320.00', 'expenses/alternative': '20.00' });
  });
});

describe('computeOwnerTax: electing out of the exemption (PIM4020)', () => {
  it('lets a rent-a-room loss offset standard letting profit', () => {
    // Employment 12,570. Flat: 15,000 receipts, 2,000 expenses. Home: 5,000 receipts (within the 7,500 limit),
    // 10,000 expenses.
    // Exempt: Flat profit 13,000 x 20% = 2,600.00 (allowance: 14,000 x 20% = 2,800.00).
    // Normal: pool receipts 20,000 - expenses 12,000 = 8,000 x 20% = 1,600.00, so Home contributes a 5,000 loss
    //   and tax falls by 1,000.00 (allowance on the merged pool: 19,000 x 20% = 3,800.00).
    const r = run([flat(15000, 2000), room('Home', 5000, 10000)], { employmentIncome: 12570 });
    expect(r.property.rentARoomPool).toMatchObject({ treatment: 'normal', taxable: '-5000.00', normalResult: '-5000.00' });
    expect(r.property.taxableProfit).toBe('8000.00');
    expect(r.incomeTax.liability).toBe('1600.00');
    expect(liabilities(r)).toEqual({
      'expenses/exempt': '2600.00',
      'allowance/exempt': '2800.00',
      'expenses/normal': '1600.00',
      'allowance/normal': '3800.00',
    });
    expect(r.property.rentARoomPool?.reason).toBe(
      'Elected out of the exemption: the normal method gives a £5,000.00 loss that reduces income tax by £1,000.00 ' +
        '(£1,600.00 against £2,600.00 with the exemption).',
    );
  });

  it('carries the loss forward when there is no other property profit, even though tax is nil either way', () => {
    // Employment 0. Home: receipts 5,000, expenses 10,000. Exempt: tax 0.00, nothing carried forward.
    // Normal: loss of 5,000, tax 0.00, loss carried forward 5,000. Equal tax, so more carry-forward wins.
    const r = run([room('Home', 5000, 10000)]);
    expect(liabilities(r)).toMatchObject({ 'expenses/exempt': '0.00', 'expenses/normal': '0.00' });
    expect(r.property.rentARoomPool?.treatment).toBe('normal');
    expect(r.property.currentYearResult).toBe('-5000.00');
    expect(r.property.lossesCarriedForward).toBe('5000.00');
    expect(r.property.hasLosses).toBe(true);
    expect(r.property.rentARoomPool?.reason).toContain('Income tax is the same (£0.00), but £5,000.00 more loss and finance costs carry forward.');
  });

  it('stays exempt when the receipts are within the limit and the expenses are small', () => {
    // Employment 12,570. Receipts 5,000, expenses 500. Exempt: 0.00. Normal: 4,500 x 20% = 900.00
    // (allowance on the merged pool: 4,000 x 20% = 800.00).
    const r = run([room('Home', 5000, 500)], { employmentIncome: 12570 });
    expect(r.property.rentARoomPool?.treatment).toBe('exempt');
    expect(r.incomeTax.liability).toBe('0.00');
    expect(liabilities(r)).toMatchObject({ 'expenses/exempt': '0.00', 'expenses/normal': '900.00', 'allowance/normal': '800.00' });
    expect(r.property.rentARoomPool?.reason).toContain('Electing out (normal method) would give income tax of £800.00 against £0.00');
  });

  it('judges the property allowance on the merged pool once the rent-a-room is outside the scheme', () => {
    // Employment 12,570. Home: receipts 5,000, expenses 10,000 -> loss 5,000 (expenses). On the allowance the merged
    // pool is just 5,000 - 1,000 = 4,000 profit, never a loss, so expenses win.
    const r = run([room('Home', 5000, 10000)], { employmentIncome: 12570 });
    const normalAllowance = r.property.methods.find(m => m.method === 'allowance' && m.rentARoom === 'normal');
    expect(normalAllowance).toMatchObject({ available: true, liability: '800.00', propertyProfit: '4000.00' });
    expect(r.property.method).toBe('expenses');
  });
});

describe('computeOwnerTax: tie-breaks between rent-a-room treatments', () => {
  it('prefers the exemption over the normal method when tax and carry-forward are equal', () => {
    // Employment 0. Receipts 5,000, expenses 1,000: exempt 0.00; normal profit 4,000 is inside the allowance, 0.00.
    // No loss or finance cost is carried forward either way, so the exemption wins.
    const r = run([room('Home', 5000, 1000)]);
    expect(liabilities(r)).toMatchObject({ 'expenses/exempt': '0.00', 'expenses/normal': '0.00' });
    expect(r.property.rentARoomPool?.treatment).toBe('exempt');
    expect(r.property.rentARoomPool?.reason).toContain('no more loss or finance costs carried forward, so the exemption is kept');
  });

  it('prefers the normal method over the alternative when tax and carry-forward are equal', () => {
    // Employment 0. Receipts 8,000, no expenses (limit 7,500): alternative profit 500, normal profit 8,000.
    // Both sit inside the personal allowance, so tax is 0.00 and nothing is carried forward either way.
    const r = run([room('Home', 8000, 0)]);
    expect(liabilities(r)).toMatchObject({ 'expenses/normal': '0.00', 'expenses/alternative': '0.00' });
    expect(r.property.rentARoomPool?.treatment).toBe('normal');
    expect(r.property.rentARoomPool?.reason).toContain('give the same income tax (£0.00) as the alternative method');
  });

  it('puts more carry-forward ahead of the treatment order on a tax tie', () => {
    // Employment 0, losses brought forward 5,000. Receipts 8,000, no expenses (limit 7,500).
    // Alternative: profit 500 uses 500 of the losses -> 4,500 carried forward, taxable profit 0, tax 0.00.
    // Normal: profit 8,000 uses all 5,000 -> 0 carried forward, taxable profit 3,000 sits inside the personal
    //   allowance, tax 0.00.
    // The normal method is preferred on order, but the alternative keeps 4,500 of losses alive, so it wins.
    const r = run([room('Home', 8000, 0)], { propertyLossesBroughtForward: 5000 });
    expect(liabilities(r)).toMatchObject({ 'expenses/normal': '0.00', 'expenses/alternative': '0.00' });
    expect(r.property.rentARoomPool?.treatment).toBe('alternative');
    expect(r.property.lossesCarriedForward).toBe('4500.00');
    expect(r.property.rentARoomPool?.reason).toContain('same income tax (£0.00) but less loss and finance costs carried forward');
  });

  it('ties between expenses and the allowance still go to actual expenses', () => {
    // Employment 0, Flat receipts 500, expenses 100, plus an exempt Home: tax is nil under both methods.
    const r = run([flat(500, 100), room('Home', 2000, 0)]);
    expect(r.property.method).toBe('expenses');
    expect(r.property.rentARoomPool?.treatment).toBe('exempt');
  });
});

describe('computeOwnerTax: the Emily-like case with a rent-a-room home is unchanged', () => {
  // Standard share of Francis Road: gross 13,200.00, expenses 776.51, mortgage interest 8,375.20.
  // Denbigh Road (rent_a_room, shared): receipts 1,432.17, expenses 51.57, no mortgage interest.
  // Employment 12,570 with no PAYE.
  const emily = run(
    [
      { name: '249 Francis Road', lettingType: 'standard', grossIncome: '13200.00', totalExpenses: '776.51', mortgageInterest: '8375.20' },
      { name: '20 Denbigh Road', lettingType: 'rent_a_room', grossIncome: '1432.17', totalExpenses: '51.57', mortgageInterest: '0.00', rentARoomShared: true },
    ],
    { employmentIncome: 12570, payeTaxPaid: 0 },
  );

  it('stays exempt and gives the same liability as before', () => {
    // Denbigh 1,432.17 is within the shared limit of 3,750, so it is exempt.
    // Francis Road: 13,200.00 - 776.51 = 12,423.49 x 20% = 2,484.70 (2,484.698 rounded).
    // S.24: 20% x min(8,375.20, 12,423.49, 12,423.49) = 1,675.04. Liability 2,484.70 - 1,675.04 = 809.66.
    expect(emily.property.rentARoomPool).toMatchObject({ treatment: 'exempt', limit: '3750.00', shared: true, receipts: '1432.17', taxable: '0.00' });
    expect(emily.property.method).toBe('expenses');
    expect(emily.property.taxableProfit).toBe('12423.49');
    expect(emily.financeCosts.reducer).toBe('1675.04');
    expect(emily.incomeTax.liability).toBe('809.66');
  });

  it('rejects the alternatives on tax', () => {
    // Exempt on the allowance: (13,200.00 - 1,000) x 20% = 2,440.00, no reducer.
    // Elected out: pool 14,632.17 - 828.08 = 13,804.09 x 20% = 2,760.82; less the same 1,675.04 reducer = 1,085.78
    // (allowance on the merged pool: 13,632.17 x 20% = 2,726.43).
    expect(liabilities(emily)).toEqual({
      'expenses/exempt': '809.66',
      'allowance/exempt': '2440.00',
      'expenses/normal': '1085.78',
      'allowance/normal': '2726.43',
    });
  });

  it('keeps the warning about recorded expenses, worded for the method that is not claiming them', () => {
    expect(emily.warnings).toEqual([
      '20 Denbigh Road is a rent-a-room letting but has recorded expenses or mortgage interest. They are not claimed under the exempt method; ' +
        'only the part that relates to the let room would be claimable under the normal method, so make sure these figures are already apportioned.',
    ]);
  });
});

describe('computeOwnerTax: rent-a-room warning when the normal method is chosen', () => {
  it('says the figures count and still asks for them to be apportioned', () => {
    const r = run([flat(15000, 2000), room('Home', 5000, 10000)], { employmentIncome: 12570 });
    expect(r.property.rentARoomPool?.treatment).toBe('normal');
    expect(r.warnings).toEqual([
      'Home is a rent-a-room letting but has recorded expenses or mortgage interest. The normal method is being used, so they count: ' +
        'only the part that relates to the let room is claimable; make sure these figures are already apportioned.',
    ]);
  });
});

describe('computeOwnerTax: without rent-a-room lettings nothing changes', () => {
  // The fixture is the full output of the engine before rent-a-room pooling was added, for three owners with
  // only standard lettings: Emily-like (expenses + S.24), allowance chosen at the higher rate with savings and
  // dividends, and brought-forward losses and finance costs in 2027-28. Equality is exact (every number and
  // every line of working); only the new, additive fields are dropped before comparing.
  const profile = (over: Partial<OwnerTaxProfileInput>) => ({ ...EMPTY_PROFILE, ...over });
  const cases: Record<string, OwnerTaxComputation> = {
    emilyLike: computeOwnerTax({
      taxYear: '2025-26', properties: [flat(10000, 1800, 2400, '249 Francis Road')], profile: profile({ employmentIncome: 12570 }),
    }),
    allowanceChosen: computeOwnerTax({
      taxYear: '2025-26', properties: [flat(3000, 400, 0, 'Flat A'), flat(900, 50, 0, 'Flat B')],
      profile: profile({ employmentIncome: 45000, payeTaxPaid: 6486, savingsInterest: 800, dividends: 1500 }),
    }),
    carryForwards: computeOwnerTax({
      taxYear: '2027-28', properties: [flat(9000, 4000, 3000, 'Flat A'), flat(2000, 2500, 500, 'Flat B')],
      profile: profile({ employmentIncome: 30000, propertyLossesBroughtForward: 1200, financeCostsBroughtForward: 700 }),
    }),
  };

  for (const [name, result] of Object.entries(cases)) {
    it(`gives the same output as before for ${name}`, () => {
      // The additive fields are empty here...
      expect(result.property.rentARoomPool).toBeNull();
      expect(result.property.rentARoom).toEqual([]);
      expect(result.property.methods.map(m => m.rentARoom)).toEqual([null, null]);
      // ...and dropping them leaves exactly the old output.
      const old = JSON.parse(JSON.stringify(result)) as {
        income: { adjustedNetIncome?: unknown };
        property: { rentARoomPool?: unknown; methods: Array<Record<string, unknown>> };
      };
      delete old.income.adjustedNetIncome;
      delete old.property.rentARoomPool;
      for (const m of old.property.methods) {
        delete m.rentARoom;
        delete m.chosen;
      }
      expect(old).toEqual((noRentARoomFixture as Record<string, unknown>)[name]);
    });
  }

  it('flags exactly one option as chosen, and it is the method that was used', () => {
    for (const result of Object.values(cases)) {
      const chosen = result.property.methods.filter(m => m.chosen);
      expect(chosen.map(m => m.method)).toEqual([result.property.method]);
    }
  });
});

describe('computeOwnerTax: other years', () => {
  it('taxes property at the 2027-28 property rates and flags the year as provisional', () => {
    // Employment 44,570 (taxable 32,000 -> 6,400). Flat profit 14,000 - 4,000 = 10,000.
    // Property: 5,700 x 22% + 4,300 x 42% = 1,254 + 1,806 = 3,060. Total 9,460.
    const r = run([flat(14000, 4000)], { employmentIncome: 44570, payeTaxPaid: 6400 }, '2027-28');
    expect(r.property.method).toBe('expenses');
    expect(r.incomeTax.liability).toBe('9460.00');
    expect(r.taxOnRentalIncome.amount).toBe('3060.00');
    expect(r.rates.provisional).toBe(true);
    expect(r.warnings.some(w => w.includes('provisional'))).toBe(true);
  });

  it('relieves finance costs at 22% in 2027-28', () => {
    // Employment 12,570. Profit 8,200 x 22% = 1,804. Reducer 22% x 2,400 = 528 -> 1,276.00.
    const r = run([flat(10000, 1800, 2400)], { employmentIncome: 12570 }, '2027-28');
    expect(r.financeCosts.reliefRatePct).toBe('22');
    expect(r.financeCosts.reducer).toBe('528.00');
    expect(r.incomeTax.liability).toBe('1276.00');
  });

  it('falls back to the latest rates for an unknown year and flags it', () => {
    const r = run([flat(10000, 1800, 2400)], { employmentIncome: 12570 }, '2030-31');
    expect(r.rates.assumed).toBe(true);
    expect(r.rates.taxYear).toBe('2027-28');
    expect(r.warnings.some(w => w.includes('No rate table exists for 2030-31'))).toBe(true);
    expect(r.taxYear).toBe('2030-31');
  });

  it('rejects a malformed tax year', () => {
    expect(() => run([], {}, '2025/26')).toThrow(ClientError);
  });
});

describe('computeOwnerTax: whole-profile effects', () => {
  it('works through the personal allowance taper', () => {
    // Employment 110,000: allowance 7,570, tax 33,432.00 (see incomeTax tests).
    const r = run([], { employmentIncome: 110000 });
    expect(r.incomeTax.personalAllowance.taperReduction).toBe('5000.00');
    expect(r.incomeTax.personalAllowance.tapered).toBe(true);
    expect(r.incomeTax.liability).toBe('33432.00');
  });

  it('puts rental profit on top of employment, savings and dividends', () => {
    const r = run(
      [flat(8000, 0)],
      { employmentIncome: 30000, savingsInterest: 500, dividends: 2000 },
    );
    // Allowance profit 7,000 beats expenses profit 8,000.
    expect(r.property.method).toBe('allowance');
    // Total income 30,000 + 7,000 + 500 + 2,000 = 39,500.
    expect(r.income.total).toBe('39500.00');
    expect(r.income.propertyProfit).toBe('7000.00');
  });

  it('uses self-employment income for the MTD test', () => {
    const r = run([flat(10000, 0)], { selfEmploymentIncome: 25000 });
    expect(r.mtd.qualifyingIncome).toBe('35000.00');
    expect(r.mtd.scope).toBe('in_scope');
    expect(r.mtd.mandatoryFrom).toBe('2027-04-06');
  });

  it('copes with no properties', () => {
    const r = run([], { employmentIncome: 12570 });
    expect(r.incomeTax.liability).toBe('0.00');
    expect(r.taxOnRentalIncome.amount).toBe('0.00');
    expect(r.warnings.some(w => w.includes('No properties'))).toBe(true);
  });

  it('rejects negative profile figures', () => {
    expect(() => run([], { dividends: -1 })).toThrow(ClientError);
  });

  it('still computes when a ledger total is negative (refunds exceed costs)', () => {
    // Expenses net to -200: profit 5,200; no error, and MTD counts the receipts only.
    const r = run([flat(5000, -200)], { employmentIncome: 12570 });
    expect(r.property.profitByExpenses).toBe('5200.00');
    expect(r.mtd.propertyReceipts).toBe('5000.00');
    // A property whose receipts are negative adds nothing to MTD qualifying income.
    expect(run([flat(-100, 0)]).mtd.propertyReceipts).toBe('0.00');
  });
});

describe('computeOwnerTax: output shape', () => {
  const r = run([flat(10000, 1800, 2400)], { employmentIncome: 12570 });

  it('is plain JSON (money as strings, no Decimal instances)', () => {
    expect(JSON.parse(JSON.stringify(r))).toEqual(r);
  });

  it('carries a step-by-step breakdown with a section on every line', () => {
    expect(r.breakdown.length).toBeGreaterThan(10);
    for (const line of r.breakdown) {
      expect(line.section.length).toBeGreaterThan(0);
      expect(line.text.length).toBeGreaterThan(0);
      if (line.amount !== null) expect(line.amount).toMatch(/^-?\d+\.\d{2}$/);
    }
    const sections = new Set(r.breakdown.map(l => l.section));
    for (const s of ['Inputs', 'Property income', 'Property method', 'Income tax', 'Tax on rental income', 'Self Assessment', 'MTD ITSA']) {
      expect(sections.has(s)).toBe(true);
    }
  });

  it('always carries the estimate-not-advice disclaimer', () => {
    expect(r.disclaimer).toContain('not tax advice');
  });
});

describe('computeOwnerTax: pension treatment and the personal-allowance taper', () => {
  // Illustrative full-year owner-share amounts, not a claim that these are
  // complete ledger figures or a confirmed tax year for any live user.
  const property = [flat(13200, 776.51, 8375.20, 'BTL illustration')];

  it('preserves the remaining £820 allowance at £123,500 and includes taper in incremental BTL tax', () => {
    const employmentOnly = run([], { employmentIncome: 123500 });
    expect(employmentOnly.incomeTax.personalAllowance.effective).toBe('820.00');
    const r = run(property, { employmentIncome: 123500 });
    expect(r.income.total).toBe('135923.49');
    expect(r.financeCosts.reducer).toBe('1675.04');
    expect(r.taxOnRentalIncome).toEqual({
      amount: '4161.53', liabilityWithProperty: '45693.53', liabilityWithoutProperty: '41532.00',
    });
    // £12,423.49 × 45% − £1,675.04 would omit £246 of allowance-taper tax.
    expect(r.taxOnRentalIncome.amount).not.toBe('3915.53');
  });

  it.each(['net_pay', 'salary_sacrifice'] as const)('deducts a confirmed %s employee amount once from gross employment', pensionMethod => {
    const r = run(property, {
      employmentIncome: 123500, pensionAnnualAmount: 7600,
      pensionMethod, employmentIncomeBasis: 'gross_before_pension',
    });
    expect(r.income.nonSavings).toBe('115900.00');
    expect(r.income.adjustedNetIncome).toBe('128323.49');
    expect(r.pension).toMatchObject({ applied: true, employmentDeduction: '7600.00', reliefAtSourceGross: '0.00' });
    expect(r.taxOnRentalIncome).toEqual({
      amount: '5301.53', liabilityWithProperty: '42273.53', liabilityWithoutProperty: '36972.00',
    });
    // Total tax falls, although more rental profit now crosses the effective
    // 60% allowance-taper band, increasing the incremental rental figure.
    expect(Number(r.incomeTax.liability)).toBeLessThan(45693.53);
  });

  it('does not deduct pension again from P60 taxable pay', () => {
    const r = run(property, {
      employmentIncome: 115900, pensionAnnualAmount: 7600,
      pensionMethod: 'net_pay', employmentIncomeBasis: 'taxable_pay_after_pension',
    });
    expect(r.income.nonSavings).toBe('115900.00');
    expect(r.pension?.employmentDeduction).toBe('0.00');
    expect(r.incomeTax.liability).toBe('42273.53');
  });

  it('treats relief at source as ANI relief and band extension, without subtracting it from employment', () => {
    const r = run(property, {
      employmentIncome: 123500, pensionAnnualAmount: 7600,
      pensionMethod: 'relief_at_source', employmentIncomeBasis: 'gross_before_pension',
    });
    expect(r.income.nonSavings).toBe('123500.00');
    expect(r.income.total).toBe('135923.49');
    expect(r.income.adjustedNetIncome).toBe('128323.49');
    expect(r.pension).toMatchObject({ employmentDeduction: '0.00', reliefAtSourceGross: '7600.00', applied: true });
    expect(r.taxOnRentalIncome).toEqual({
      amount: '5301.53', liabilityWithProperty: '43793.53', liabilityWithoutProperty: '38492.00',
    });
  });

  it('restores £4,620 of allowance at £115,900 ANI before property income', () => {
    const r = run([], {
      employmentIncome: 123500, pensionAnnualAmount: 7600,
      pensionMethod: 'net_pay', employmentIncomeBasis: 'gross_before_pension',
    });
    expect(r.income.adjustedNetIncome).toBe('115900.00');
    expect(r.incomeTax.personalAllowance.effective).toBe('4620.00');
  });

  it.each([
    { pensionMethod: 'unknown' as const, employmentIncomeBasis: 'gross_before_pension' as const },
    { pensionMethod: 'net_pay' as const, employmentIncomeBasis: 'unknown' as const },
  ])('keeps pension relief unknown when its method or income basis is missing: %j', pensionFacts => {
    const r = run(property, { employmentIncome: 123500, pensionAnnualAmount: 7600, ...pensionFacts });
    expect(r.pension?.applied).toBe(false);
    expect(r.income.nonSavings).toBe('123500.00');
    expect(r.taxOnRentalIncome.amount).toBe('4161.53');
    expect(r.warnings.some(warning => warning.includes('Pension relief has not been assumed'))).toBe(true);
  });

  it('does not derive a pension amount without an annual employee figure', () => {
    const r = run(property, { employmentIncome: 123500, pensionMethod: 'net_pay', employmentIncomeBasis: 'gross_before_pension' });
    expect(r.pension?.annualEmployeeAmount).toBeNull();
    expect(r.pension?.applied).toBe(false);
    expect(r.warnings.some(warning => warning.includes('No annual employee pension amount is confirmed'))).toBe(true);
  });

  it('rejects an employee deduction larger than gross employment instead of offsetting other income', () => {
    expect(() => run([], {
      employmentIncome: 1000, otherIncome: 50000, pensionAnnualAmount: 2000,
      pensionMethod: 'salary_sacrifice', employmentIncomeBasis: 'gross_before_pension',
    })).toThrow(ClientError);
  });

  it('recomputes the S.24 adjusted-income cap and carry-forward after net-pay deductions', () => {
    const r = run([flat(10000, 2000, 8000)], {
      employmentIncome: 20000, pensionAnnualAmount: 10000,
      pensionMethod: 'net_pay', employmentIncomeBasis: 'gross_before_pension',
    });
    // After pension: £10,000 employment + £8,000 property − £12,570 PA.
    // S.24 can relieve only £5,430, retaining £2,570 for a later year.
    expect(r.financeCosts.limitedBy).toBe('adjusted_total_income');
    expect(r.financeCosts.relieved).toBe('5430.00');
    expect(r.financeCosts.reducer).toBe('1086.00');
    expect(r.financeCosts.carriedForward).toBe('2570.00');
    expect(r.incomeTax.liability).toBe('0.00');
  });
});
