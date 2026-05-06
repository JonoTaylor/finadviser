import Decimal from 'decimal.js';
import { sql } from 'drizzle-orm';
import { getDb } from '@/lib/db';
import { ClientError } from '@/lib/errors';
import { propertyRepo, rentalReportRepo, accountRepo } from '@/lib/repos';

export interface BtlTaxAssumptions {
  /** Marginal income-tax rate applied to taxable rental profit. */
  incomeTaxRatePct: string;
  /** UK S.24 basic-rate mortgage-interest tax credit assumption. */
  mortgageInterestReliefRatePct: string;
  /** True when callers did not provide a user-specific marginal rate. */
  usingDefaultIncomeTaxRate: boolean;
  /** True when callers did not provide a relief-rate assumption. */
  usingDefaultMortgageInterestReliefRate: boolean;
}

export interface BtlTaxProfitEstimate {
  rentIncome: string;
  otherIncome: string;
  grossIncome: string;
  deductibleExpenses: string;
  taxableRentalProfit: string;
  mortgageInterestForRelief: string;
  incomeTaxBeforeMortgageRelief: string;
  mortgageInterestRelief: string;
  estimatedTaxDue: string;
  assumptions: BtlTaxAssumptions;
}

export interface BtlCashFlowSection {
  annual: string;
  monthly: string;
}

export interface BtlCashFlowBeforeTax extends BtlCashFlowSection {
  grossIncome: string;
  deductibleExpenses: string;
  mortgagePayments: string;
}

export interface BtlCashFlowAfterTax extends BtlCashFlowSection {
  estimatedTaxDue: string;
}

export interface BtlEquityReturn {
  propertyValue: string;
  mortgageBalance: string;
  equity: string;
  annualCashFlowAfterTax: string;
  returnOnEquityPct: string | null;
  netYieldPct: string | null;
}

export interface BtlStressTestResult {
  label: string;
  annualCashFlowAfterTax: string;
  monthlyCashFlowAfterTax: string;
}

export interface BtlStressTests {
  vacancyOneMonth: BtlStressTestResult;
  mortgagePaymentsUp10Pct: BtlStressTestResult | null;
}

export type BtlProfitabilityWarningCode =
  | 'missing_mortgage_payments'
  | 'missing_tax_assumptions'
  | 'missing_property_value'
  | 'missing_equity';

export interface BtlProfitabilityWarning {
  code: BtlProfitabilityWarningCode;
  message: string;
}

export interface BtlProfitabilityResult {
  propertyId: number;
  startDate: string;
  endDate: string;
  taxProfitEstimate: BtlTaxProfitEstimate;
  cashFlowBeforeTax: BtlCashFlowBeforeTax;
  cashFlowAfterTax: BtlCashFlowAfterTax;
  equityReturn: BtlEquityReturn;
  stressTests: BtlStressTests;
  warnings: BtlProfitabilityWarning[];
}

export interface BtlProfitabilityParams {
  propertyId: number;
  startDate: string;
  endDate: string;
  incomeTaxRatePct?: string | number | null;
  mortgageInterestReliefRatePct?: string | number | null;
}

const DEFAULT_INCOME_TAX_RATE_PCT = '20';
const DEFAULT_MORTGAGE_INTEREST_RELIEF_RATE_PCT = '20';

/**
 * Build a BTL decision snapshot with deliberately separate concepts:
 * tax reporting profit, real bank cash flow, equity return and simple
 * stress tests. Tax profit preserves the tax-year report treatment by
 * excluding mortgage interest from deductible expenses and showing it
 * separately for S.24 relief assumptions; cash flow subtracts the full
 * mortgage payment amount when those payment journals are available.
 */
export async function calculateBtlProfitability(
  params: BtlProfitabilityParams,
): Promise<BtlProfitabilityResult> {
  const { propertyId, startDate, endDate } = params;
  const report = await rentalReportRepo.getTaxYearReport({ propertyId, startDate, endDate });
  const property = await propertyRepo.getProperty(propertyId);
  if (!property) throw new Error(`Property ${propertyId} not found`);

  const warnings: BtlProfitabilityWarning[] = [];
  const usingDefaultIncomeTaxRate = params.incomeTaxRatePct == null || params.incomeTaxRatePct === '';
  const usingDefaultMortgageInterestReliefRate =
    params.mortgageInterestReliefRatePct == null || params.mortgageInterestReliefRatePct === '';
  const incomeTaxRatePct = parsePercentageAssumption(
    usingDefaultIncomeTaxRate ? DEFAULT_INCOME_TAX_RATE_PCT : params.incomeTaxRatePct!.toString(),
    'incomeTaxRatePct',
  );
  const mortgageInterestReliefRatePct = parsePercentageAssumption(
    usingDefaultMortgageInterestReliefRate
      ? DEFAULT_MORTGAGE_INTEREST_RELIEF_RATE_PCT
      : params.mortgageInterestReliefRatePct!.toString(),
    'mortgageInterestReliefRatePct',
  );

  if (usingDefaultIncomeTaxRate || usingDefaultMortgageInterestReliefRate) {
    warnings.push({
      code: 'missing_tax_assumptions',
      message: 'Using default tax assumptions. Add a marginal tax rate to make the after-tax cash-flow estimate personal.',
    });
  }

  const rentIncome = sumAmounts(report.income);
  const otherIncome = sumAmounts(report.otherIncome);
  const grossIncome = rentIncome.plus(otherIncome);
  const deductibleExpenses = new Decimal(report.totals.totalExpenses);
  const mortgageInterestForRelief = new Decimal(report.totals.mortgageInterest);
  const taxableRentalProfit = grossIncome.minus(deductibleExpenses);
  const taxableProfitForTax = Decimal.max(taxableRentalProfit, 0);
  const incomeTaxBeforeMortgageRelief = taxableProfitForTax.mul(incomeTaxRatePct).div(100);
  const mortgageInterestRelief = mortgageInterestForRelief.mul(mortgageInterestReliefRatePct).div(100);
  const estimatedTaxDue = Decimal.max(incomeTaxBeforeMortgageRelief.minus(mortgageInterestRelief), 0);

  const mortgages = await propertyRepo.getMortgages(propertyId);
  const mortgagePayments = await fetchRecordedMortgagePayments(propertyId, startDate, endDate);
  if (mortgages.length > 0 && mortgagePayments.isZero()) {
    warnings.push({
      code: 'missing_mortgage_payments',
      message: 'No recorded full mortgage payments were found for this period. Cash-flow figures may be overstated.',
    });
  }

  const cashFlowBeforeTaxAnnual = grossIncome.minus(deductibleExpenses).minus(mortgagePayments);
  const cashFlowAfterTaxAnnual = cashFlowBeforeTaxAnnual.minus(estimatedTaxDue);

  const latestValuation = await propertyRepo.getLatestValuation(propertyId);
  const fallbackValue = property.purchasePrice ? new Decimal(property.purchasePrice) : new Decimal(0);
  const propertyValue = latestValuation ? new Decimal(latestValuation.valuation) : fallbackValue;
  if (propertyValue.lte(0)) {
    warnings.push({
      code: 'missing_property_value',
      message: 'No valuation or purchase price is available, so yield and equity-return percentages cannot be calculated.',
    });
  }

  const mortgageBalance = await fetchTotalMortgageBalance(propertyId);
  const equity = propertyValue.minus(mortgageBalance);
  if (equity.lte(0)) {
    warnings.push({
      code: 'missing_equity',
      message: 'Equity is zero or negative, so return on equity cannot be calculated reliably.',
    });
  }

  const netYieldPct = propertyValue.gt(0)
    ? grossIncome.minus(deductibleExpenses).div(propertyValue).mul(100).toFixed(2)
    : null;
  const returnOnEquityPct = equity.gt(0)
    ? cashFlowAfterTaxAnnual.div(equity).mul(100).toFixed(2)
    : null;

  // Stress tests model after-tax cash impact, not just gross. Both
  // shocks change the tax bill (less rent -> less taxable profit;
  // more interest -> more S.24 relief), so subtracting the gross
  // figure overstates the cash hit at higher marginal rates.
  //
  // Vacancy: drop one month's rent from gross, recompute taxable
  // rental profit (floored at 0), recompute tax due, and subtract
  // the net (gross loss minus the resulting tax saving).
  const vacancyOneMonthGrossLost = rentIncome.div(12);
  const vacancyTaxableProfitForTax = Decimal.max(
    taxableRentalProfit.minus(vacancyOneMonthGrossLost),
    0,
  );
  const vacancyIncomeTaxBeforeMortgageRelief = vacancyTaxableProfitForTax
    .mul(incomeTaxRatePct)
    .div(100);
  const vacancyEstimatedTaxDue = Decimal.max(
    vacancyIncomeTaxBeforeMortgageRelief.minus(mortgageInterestRelief),
    0,
  );
  const vacancyTaxSaving = estimatedTaxDue.minus(vacancyEstimatedTaxDue);
  const vacancyAfterTaxLoss = vacancyOneMonthGrossLost.minus(vacancyTaxSaving);
  const vacancyOneMonthAnnual = cashFlowAfterTaxAnnual.minus(vacancyAfterTaxLoss);

  // Mortgage payments 10% higher: the +10% reflects a rate-rise
  // scenario, so the increase IS interest and therefore S.24-
  // deductible. More interest -> more relief -> partially offsets
  // the cash hit. (For repayment mortgages where only the interest
  // portion is rate-sensitive, treating the full +10% as additional
  // interest slightly overstates the deductible amount; for
  // interest-only it's exact. Conservative on the after-tax cost
  // side either way.)
  let mortgagePaymentsUp10Pct: Decimal | null = null;
  if (mortgagePayments.gt(0)) {
    const additionalMortgage = mortgagePayments.mul(0.10);
    const additionalRelief = additionalMortgage.mul(mortgageInterestReliefRatePct).div(100);
    const stressedTaxDue = Decimal.max(estimatedTaxDue.minus(additionalRelief), 0);
    const taxSaving = estimatedTaxDue.minus(stressedTaxDue);
    const additionalAfterTaxCost = additionalMortgage.minus(taxSaving);
    mortgagePaymentsUp10Pct = cashFlowAfterTaxAnnual.minus(additionalAfterTaxCost);
  }

  return {
    propertyId,
    startDate,
    endDate,
    taxProfitEstimate: {
      rentIncome: money(rentIncome),
      otherIncome: money(otherIncome),
      grossIncome: money(grossIncome),
      deductibleExpenses: money(deductibleExpenses),
      taxableRentalProfit: money(taxableRentalProfit),
      mortgageInterestForRelief: money(mortgageInterestForRelief),
      incomeTaxBeforeMortgageRelief: money(incomeTaxBeforeMortgageRelief),
      mortgageInterestRelief: money(mortgageInterestRelief),
      estimatedTaxDue: money(estimatedTaxDue),
      assumptions: {
        incomeTaxRatePct: incomeTaxRatePct.toFixed(2),
        mortgageInterestReliefRatePct: mortgageInterestReliefRatePct.toFixed(2),
        usingDefaultIncomeTaxRate,
        usingDefaultMortgageInterestReliefRate,
      },
    },
    cashFlowBeforeTax: {
      grossIncome: money(grossIncome),
      deductibleExpenses: money(deductibleExpenses),
      mortgagePayments: money(mortgagePayments),
      annual: money(cashFlowBeforeTaxAnnual),
      monthly: money(cashFlowBeforeTaxAnnual.div(12)),
    },
    cashFlowAfterTax: {
      estimatedTaxDue: money(estimatedTaxDue),
      annual: money(cashFlowAfterTaxAnnual),
      monthly: money(cashFlowAfterTaxAnnual.div(12)),
    },
    equityReturn: {
      propertyValue: money(propertyValue),
      mortgageBalance: money(mortgageBalance),
      equity: money(equity),
      annualCashFlowAfterTax: money(cashFlowAfterTaxAnnual),
      returnOnEquityPct,
      netYieldPct,
    },
    stressTests: {
      vacancyOneMonth: {
        label: 'One month without rent',
        annualCashFlowAfterTax: money(vacancyOneMonthAnnual),
        monthlyCashFlowAfterTax: money(vacancyOneMonthAnnual.div(12)),
      },
      mortgagePaymentsUp10Pct: mortgagePaymentsUp10Pct
        ? {
            label: 'Mortgage payments 10% higher',
            annualCashFlowAfterTax: money(mortgagePaymentsUp10Pct),
            monthlyCashFlowAfterTax: money(mortgagePaymentsUp10Pct.div(12)),
          }
        : null,
    },
    warnings,
  };
}


function parsePercentageAssumption(value: string, name: string): Decimal {
  let parsed: Decimal;
  try {
    parsed = new Decimal(value);
  } catch {
    throw new ClientError(`${name} must be a valid percentage`);
  }
  if (!parsed.isFinite() || parsed.lt(0) || parsed.gt(100)) {
    throw new ClientError(`${name} must be between 0 and 100`);
  }
  return parsed;
}

function money(value: Decimal): string {
  return value.toDecimalPlaces(2).toFixed(2);
}

function sumAmounts(lines: Array<{ amount: string }>): Decimal {
  return lines.reduce((acc, line) => acc.plus(line.amount), new Decimal(0));
}

async function fetchRecordedMortgagePayments(
  propertyId: number,
  startDate: string,
  endDate: string,
): Promise<Decimal> {
  const db = getDb();
  const rows = await db.execute(sql`
    SELECT COALESCE(SUM(component_amount), 0)::numeric AS amount
    FROM (
      SELECT je.id,
             SUM(
               CASE
                 WHEN a.account_type = 'EXPENSE' AND a.name = 'Mortgage Interest' AND a.is_system = TRUE
                   THEN GREATEST(be.amount::numeric, 0)
                 WHEN m.liability_account_id IS NOT NULL
                   THEN GREATEST(be.amount::numeric, 0)
                 ELSE 0
               END
             ) AS component_amount
      FROM journal_entries je
      JOIN book_entries be ON be.journal_entry_id = je.id
      JOIN accounts a ON a.id = be.account_id
      LEFT JOIN mortgages m ON m.liability_account_id = be.account_id
                           AND m.property_id = ${propertyId}
      WHERE je.property_id = ${propertyId}
        AND je.date >= ${startDate}
        AND je.date <= ${endDate}
        AND COALESCE(je.is_transfer, FALSE) = FALSE
        AND (je.reference LIKE 'mortgage_payment:%' OR je.description LIKE 'Mortgage payment - %')
      GROUP BY je.id
    ) payment_journals
  `);
  return new Decimal((rows.rows[0]?.amount ?? '0').toString());
}

async function fetchTotalMortgageBalance(propertyId: number): Promise<Decimal> {
  const mortgages = await propertyRepo.getMortgages(propertyId);
  // Dedup first (a property could in principle have two `mortgages`
  // rows pointing to the same liability account), then fetch the
  // balances in parallel rather than serially - one round-trip per
  // distinct mortgage instead of N sequential ones.
  const seen = new Set<number>();
  const uniqueAccountIds: number[] = [];
  for (const mortgage of mortgages) {
    if (seen.has(mortgage.liabilityAccountId)) continue;
    seen.add(mortgage.liabilityAccountId);
    uniqueAccountIds.push(mortgage.liabilityAccountId);
  }
  if (uniqueAccountIds.length === 0) return new Decimal(0);
  const balances = await Promise.all(
    uniqueAccountIds.map(id => accountRepo.getBalance(id)),
  );
  return balances.reduce(
    (acc, balance) => acc.plus(new Decimal(balance).abs()),
    new Decimal(0),
  );
}
