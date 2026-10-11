import { describe, it, expect } from 'vitest';
import { ClientError } from '@/lib/errors';
import {
  computeOwnerTax,
  type OwnerTaxProfileInput,
  type PropertyLetting,
} from './ownerTaxComputation';

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
    expect(r.property.rentARoom[0]).toMatchObject({ outcome: 'exempt', limit: '3750.00', taxable: '0.00' });
    expect(r.incomeTax.liability).toBe('0.00');
    expect(r.taxOnRentalIncome.amount).toBe('0.00');
  });

  it('taxes only the excess over the shared limit by the alternative method', () => {
    // Her 65.08% share of 8,000 of rent = 5,206.40; limit 3,750; taxable 1,456.40 x 20% = 291.28.
    const r = run([home(5206.4)], { employmentIncome: 12570 });
    expect(r.property.rentARoom[0]).toMatchObject({ outcome: 'alternative', taxable: '1456.40' });
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
