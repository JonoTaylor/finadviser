import { NextRequest, NextResponse } from 'next/server';
import Decimal from 'decimal.js';
import { propertyRepo } from '@/lib/repos';
import {
  computeInterestForRange,
  monthlyBreakdown,
  nextDay,
} from '@/lib/properties/mortgage-interest';
import { taxYearRange } from '@/lib/tax/ukTaxYear';

/**
 * Returns the computed mortgage interest for a given UK tax year, broken
 * down by rate sub-period and by month. Used by the S.24 card to show
 * "Computed: £X" alongside the journal-recorded value.
 *
 * Query params:
 * - year: tax-year label (e.g. "2026-27"). Required.
 *
 * For interest-only mortgages the principal is `original_amount`. For
 * non-interest-only mortgages we currently fall back to the same value
 * — repayment-mortgage amortisation is out of scope of this endpoint
 * and the response flags the assumption with `principalAssumption`.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const mortgageId = parseInt(id, 10);
    if (Number.isNaN(mortgageId)) return NextResponse.json({ error: 'Invalid mortgage id' }, { status: 400 });

    const yearLabel = request.nextUrl.searchParams.get('year');
    if (!yearLabel) return NextResponse.json({ error: 'year is required' }, { status: 400 });

    const taxYear = taxYearRange(yearLabel);

    const mortgage = await propertyRepo.getMortgage(mortgageId);
    if (!mortgage) return NextResponse.json({ error: 'Mortgage not found' }, { status: 404 });
    const rates = await propertyRepo.getMortgageRates(mortgageId);

    // Clip the calculation range to [max(taxYearStart, mortgageStart), taxYearEndExclusive)
    // so we don't pretend the mortgage was outstanding before it began.
    const rangeFrom = taxYear.startDate > mortgage.startDate ? taxYear.startDate : mortgage.startDate;
    const rangeTo = nextDay(taxYear.endDate);

    const calc = computeInterestForRange({
      principal: mortgage.originalAmount,
      rangeFrom,
      rangeTo,
      rateHistory: rates.map(r => ({ rate: r.rate, effectiveDate: r.effectiveDate })),
    });

    const months = monthlyBreakdown(calc);

    // S.24 basic-rate credit is 20% of the interest paid in the year.
    const credit = new Decimal(calc.totalInterest).mul('0.20').toFixed(2);

    return NextResponse.json({
      taxYear: taxYear.label,
      taxYearStart: taxYear.startDate,
      taxYearEnd: taxYear.endDate,
      interestOnly: mortgage.interestOnly,
      principalAssumption: mortgage.interestOnly
        ? 'interest-only: principal held at original_amount throughout the range'
        : 'amortisation not implemented — using original_amount as a placeholder',
      principalUsed: mortgage.originalAmount,
      ...calc,
      months,
      basicRateCredit: credit,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to compute interest';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
