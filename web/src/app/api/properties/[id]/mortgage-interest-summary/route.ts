import { NextRequest, NextResponse } from 'next/server';
import Decimal from 'decimal.js';
import { propertyRepo } from '@/lib/repos';
import {
  computeInterestForRange,
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

    let totalInterest = new Decimal(0);
    let totalDays = 0;
    let uncoveredDays = 0;
    const perMortgage: Array<{
      mortgageId: number;
      lender: string;
      interestOnly: boolean;
      principalUsed: string;
      totalInterest: string;
      totalDays: number;
      uncoveredDays: number;
      principalAssumption: string;
    }> = [];

    for (const m of mortgages) {
      const rates = ratesByMortgage.get(m.id) ?? [];
      const rangeFrom = taxYear.startDate > m.startDate ? taxYear.startDate : m.startDate;
      const calc = computeInterestForRange({
        principal: m.originalAmount,
        rangeFrom,
        rangeTo: taxYearEndExclusive,
        rateHistory: rates,
      });
      totalInterest = totalInterest.plus(calc.totalInterest);
      totalDays += calc.totalDays;
      uncoveredDays += calc.uncoveredDays;
      perMortgage.push({
        mortgageId: m.id,
        lender: m.lender,
        interestOnly: m.interestOnly,
        principalUsed: m.originalAmount,
        totalInterest: calc.totalInterest,
        totalDays: calc.totalDays,
        uncoveredDays: calc.uncoveredDays,
        principalAssumption: m.interestOnly
          ? 'interest-only: principal held at original_amount throughout the range'
          : 'amortisation not implemented — using original_amount as a placeholder',
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
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to compute summary';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
