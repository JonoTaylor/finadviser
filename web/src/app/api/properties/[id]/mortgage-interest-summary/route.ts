import { NextRequest, NextResponse } from 'next/server';
import Decimal from 'decimal.js';
import { propertyRepo } from '@/lib/repos';
import {
  computeInterestForRange,
  determinePrincipalSource,
  nextDay,
} from '@/lib/properties/mortgage-interest';
import { taxYearRange } from '@/lib/tax/ukTaxYear';

/**
 * Aggregates computed mortgage interest across every mortgage tagged to
 * this property, for a given UK tax year. Used by the S.24 card so it
 * can render a single computed total + 20% basic-rate credit without
 * the client having to call /api/mortgages/[id]/computed-interest in a
 * loop (which would trip Rules of Hooks if the mortgage list ever
 * changed length on a render).
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const propertyId = parseInt(id, 10);
    if (Number.isNaN(propertyId)) return NextResponse.json({ error: 'Invalid property id' }, { status: 400 });

    const yearLabel = request.nextUrl.searchParams.get('year');
    if (!yearLabel) return NextResponse.json({ error: 'year is required' }, { status: 400 });
    const taxYear = taxYearRange(yearLabel);
    const taxYearEndExclusive = nextDay(taxYear.endDate);

    const mortgages = await propertyRepo.getMortgages(propertyId);
    // One DB round-trip for ALL rate histories instead of one per
    // mortgage. Returns a Map keyed by mortgageId with [] for any
    // mortgage that has no rates yet.
    const ratesByMortgage = await propertyRepo.getRatesForMortgages(mortgages.map(m => m.id));

    // For repayment mortgages, fetch balance schedules in parallel so
    // we don't fan out into N sequential round-trips when a property
    // has multiple charges. Interest-only mortgages skip this read
    // entirely - their schedule is conceptually flat at originalAmount.
    const repaymentMortgages = mortgages.filter(m => !m.interestOnly);
    const scheduleEntries = await Promise.all(
      repaymentMortgages.map(m =>
        propertyRepo.getMortgageBalanceSchedule(m.id).then(s => [m.id, s] as const),
      ),
    );
    const scheduleByMortgage = new Map(scheduleEntries);

    let totalInterest = new Decimal(0);
    let totalDays = 0;
    let uncoveredDays = 0;
    const perMortgage: Array<{
      mortgageId: number;
      lender: string;
      interestOnly: boolean;
      originalAmount: string;
      principalAtRangeStart: string;
      principalSource: 'recorded_balances' | 'interest_only_fixed' | 'original_amount_fallback';
      totalInterest: string;
      totalDays: number;
      uncoveredDays: number;
      principalAssumption: string;
    }> = [];
    let usedRecordedBalances = 0;
    let usedInterestOnlyFixed = 0;
    let usedOriginalAmountFallback = 0;

    for (const m of mortgages) {
      const rates = ratesByMortgage.get(m.id) ?? [];
      const rangeFrom = taxYear.startDate > m.startDate ? taxYear.startDate : m.startDate;
      const schedule = scheduleByMortgage.get(m.id);
      const hasRecordedPrincipalPayments = schedule !== undefined && schedule.length > 1;

      const { source: principalSource, assumption: principalAssumption } =
        determinePrincipalSource({
          interestOnly: m.interestOnly,
          hasRecordedPrincipalPayments,
        });
      const calcParams: Parameters<typeof computeInterestForRange>[0] = {
        rangeFrom,
        rangeTo: taxYearEndExclusive,
        rateHistory: rates,
      };
      if (principalSource === 'recorded_balances') {
        calcParams.balanceSchedule = schedule;
        usedRecordedBalances += 1;
      } else {
        calcParams.principal = m.originalAmount;
        if (principalSource === 'interest_only_fixed') usedInterestOnlyFixed += 1;
        else usedOriginalAmountFallback += 1;
      }
      const calc = computeInterestForRange(calcParams);
      totalInterest = totalInterest.plus(calc.totalInterest);
      totalDays += calc.totalDays;
      uncoveredDays += calc.uncoveredDays;
      perMortgage.push({
        mortgageId: m.id,
        lender: m.lender,
        interestOnly: m.interestOnly,
        originalAmount: m.originalAmount,
        // Outstanding principal at the start of the calculated periods.
        // For interest-only / fallback this equals originalAmount;
        // for recorded_balances it reflects the schedule's value at
        // rangeFrom - more useful than originalAmount when the
        // calculation actually used a varying principal.
        principalAtRangeStart: calc.periods[0]?.principal ?? m.originalAmount,
        principalSource,
        totalInterest: calc.totalInterest,
        totalDays: calc.totalDays,
        uncoveredDays: calc.uncoveredDays,
        principalAssumption,
      });
    }

    return NextResponse.json({
      taxYear: taxYear.label,
      taxYearStart: taxYear.startDate,
      taxYearEnd: taxYear.endDate,
      totalInterest: totalInterest.toFixed(2),
      basicRateCredit: totalInterest.mul('0.20').toFixed(2),
      totalDays,
      uncoveredDays,
      perMortgage,
      // Roll-up diagnostics: how many of the property's mortgages used
      // each principal-source path. Lets a UI surface a single
      // "Recorded balances" / "Mixed" / "Fallback" badge.
      principalSourceBreakdown: {
        recordedBalances: usedRecordedBalances,
        interestOnlyFixed: usedInterestOnlyFixed,
        originalAmountFallback: usedOriginalAmountFallback,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to compute summary';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
