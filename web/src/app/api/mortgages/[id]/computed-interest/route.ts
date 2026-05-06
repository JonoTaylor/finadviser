import { NextRequest, NextResponse } from 'next/server';
import Decimal from 'decimal.js';
import { propertyRepo } from '@/lib/repos';
import {
  computeInterestForRange,
  determinePrincipalSource,
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
 * Principal source:
 * - For repayment mortgages with at least one recorded principal
 *   payment, we reconstruct a dated balance schedule from the
 *   liability-account book_entries and feed it to the calculator so
 *   each sub-period uses the outstanding balance in effect.
 * - For interest-only mortgages we hold principal at `original_amount`
 *   throughout the range (the actual semantic — there is no
 *   amortisation).
 * - For repayment mortgages with NO recorded principal payments we
 *   fall back to `original_amount` as a placeholder and flag it
 *   explicitly via `principalSource`.
 *
 * The response always includes `principalSource` so callers can
 * distinguish between an authoritative calculation and a fallback.
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

    // Decide the principal source. Interest-only short-circuits to the
    // original-amount fixed path. Repayment uses the recorded balance
    // schedule when at least one principal payment exists; otherwise
    // the fallback (also fixed at original_amount, but flagged so the
    // caller knows the figure is approximate).
    const balanceSchedule = mortgage.interestOnly
      ? null
      : await propertyRepo.getMortgageBalanceSchedule(mortgageId);
    const hasRecordedPrincipalPayments =
      balanceSchedule !== null && balanceSchedule.length > 1;
    const { source: principalSource, assumption: principalAssumption } =
      determinePrincipalSource({
        interestOnly: mortgage.interestOnly,
        hasRecordedPrincipalPayments,
      });
    const calcParams: Parameters<typeof computeInterestForRange>[0] = {
      rangeFrom,
      rangeTo,
      rateHistory: rates.map(r => ({ rate: r.rate, effectiveDate: r.effectiveDate })),
    };
    if (principalSource === 'recorded_balances') {
      calcParams.balanceSchedule = balanceSchedule!;
    } else {
      calcParams.principal = mortgage.originalAmount;
    }
    const calc = computeInterestForRange(calcParams);

    const months = monthlyBreakdown(calc);

    // S.24 basic-rate credit is 20% of the interest paid in the year.
    const credit = new Decimal(calc.totalInterest).mul('0.20').toFixed(2);

    return NextResponse.json({
      taxYear: taxYear.label,
      taxYearStart: taxYear.startDate,
      taxYearEnd: taxYear.endDate,
      interestOnly: mortgage.interestOnly,
      principalSource,
      principalAssumption,
      // For interest-only / fallback this matches mortgage.originalAmount.
      // For recorded_balances it's the OUTSTANDING principal at the
      // start of the first computed period - the most useful single
      // figure when the schedule varies across the range. The full
      // schedule is implicit in `periods[].principal` and the
      // monthly breakdown.
      originalAmount: mortgage.originalAmount,
      principalAtRangeStart: calc.periods[0]?.principal ?? mortgage.originalAmount,
      ...calc,
      months,
      basicRateCredit: credit,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to compute interest';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
