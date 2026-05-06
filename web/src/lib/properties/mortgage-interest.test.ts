/**
 * Tests for the mortgage-interest calculator after the balance-schedule
 * extension. The calculator is pure (no DB, no I/O), so these tests
 * exercise the full code path including period stitching across rate
 * changes + principal changes.
 *
 * Day-count convention: Act/365. Each assertion is computed by hand
 * with the same formula `principal × rate% × days / 365` so a future
 * change in the calculator that shifts day-count semantics will
 * surface here as a clear numeric delta.
 */

import { describe, it, expect } from 'vitest';
import Decimal from 'decimal.js';
import { computeInterestForRange, monthlyBreakdown } from './mortgage-interest';

const ANNUAL = 365;

/**
 * Per-slice interest as a Decimal (NOT rounded). The calculator
 * sums un-rounded period interest then rounds once at the end, so
 * pre-rounding here would introduce off-by-a-penny mismatches.
 * Use `sumExpected([...])` to add slices and then round to 2dp.
 */
function sliceInterest(principal: number, ratePct: number, days: number): Decimal {
  return new Decimal(principal).mul(ratePct).div(100).mul(days).div(ANNUAL);
}

function expectedInterest(principal: number, ratePct: number, days: number): string {
  return sliceInterest(principal, ratePct, days).toFixed(2);
}

function sumExpected(slices: Decimal[]): string {
  return slices.reduce((acc, s) => acc.plus(s), new Decimal(0)).toFixed(2);
}

describe('computeInterestForRange — interest-only mortgage (fixed principal)', () => {
  it('computes a flat-principal year using the legacy `principal` argument', () => {
    const calc = computeInterestForRange({
      principal: '100000',
      rangeFrom: '2024-04-06',
      rangeTo: '2025-04-06', // 365 days, ends inclusive 5 Apr 2025
      rateHistory: [{ rate: '5.25', effectiveDate: '2020-01-01' }],
    });
    expect(calc.totalDays).toBe(365);
    expect(calc.uncoveredDays).toBe(0);
    expect(calc.totalInterest).toBe(expectedInterest(100000, 5.25, 365));
    // One sub-period when there are no rate or balance breakpoints.
    expect(calc.periods).toHaveLength(1);
    expect(calc.periods[0].principal).toBe('100000.00');
    expect(calc.periods[0].rate).toBe('5.25');
  });

  it('splits at rate-change boundaries with unchanged principal', () => {
    const calc = computeInterestForRange({
      principal: '100000',
      rangeFrom: '2024-04-06',
      rangeTo: '2025-04-06',
      rateHistory: [
        { rate: '5.00', effectiveDate: '2024-04-06' },
        { rate: '5.50', effectiveDate: '2024-10-06' }, // 6-month split
      ],
    });
    expect(calc.periods).toHaveLength(2);
    // Apr 6 - Oct 6 = 183 days; Oct 6 - Apr 6 = 182 days
    expect(calc.periods[0].days).toBe(183);
    expect(calc.periods[1].days).toBe(182);
    expect(calc.totalInterest).toBe(
      sumExpected([
        sliceInterest(100000, 5, 183),
        sliceInterest(100000, 5.5, 182),
      ]),
    );
  });
});

describe('computeInterestForRange — repayment mortgage with dated balance reductions', () => {
  it('uses the in-effect principal at the start of each sub-period', () => {
    // £100k at 5%, paid down to £80k on Oct 6 2024, then £60k on Jan 6 2025.
    const calc = computeInterestForRange({
      balanceSchedule: [
        { effectiveDate: '2024-04-06', principal: '100000' },
        { effectiveDate: '2024-10-06', principal: '80000' },
        { effectiveDate: '2025-01-06', principal: '60000' },
      ],
      rangeFrom: '2024-04-06',
      rangeTo: '2025-04-06',
      rateHistory: [{ rate: '5.00', effectiveDate: '2024-04-06' }],
    });
    // Three sub-periods: Apr-Oct (183d @ £100k), Oct-Jan (92d @ £80k),
    // Jan-Apr (90d @ £60k).
    expect(calc.periods).toHaveLength(3);
    expect(calc.periods[0]).toMatchObject({ days: 183, principal: '100000.00' });
    expect(calc.periods[1]).toMatchObject({ days: 92, principal: '80000.00' });
    expect(calc.periods[2]).toMatchObject({ days: 90, principal: '60000.00' });
    expect(calc.totalInterest).toBe(
      sumExpected([
        sliceInterest(100000, 5, 183),
        sliceInterest(80000, 5, 92),
        sliceInterest(60000, 5, 90),
      ]),
    );
  });

  it('ignores schedule entries before rangeFrom (uses last-applicable)', () => {
    // Prior to the year, balance dropped from 100k to 90k. During the
    // year, no reductions. Calculator should use 90k throughout.
    const calc = computeInterestForRange({
      balanceSchedule: [
        { effectiveDate: '2020-01-01', principal: '100000' },
        { effectiveDate: '2023-06-01', principal: '90000' },
      ],
      rangeFrom: '2024-04-06',
      rangeTo: '2025-04-06',
      rateHistory: [{ rate: '5.00', effectiveDate: '2020-01-01' }],
    });
    expect(calc.periods).toHaveLength(1);
    expect(calc.periods[0].principal).toBe('90000.00');
    expect(calc.totalInterest).toBe(expectedInterest(90000, 5, 365));
  });
});

describe('computeInterestForRange — rate change AND balance change in the same period', () => {
  it('splits at both breakpoints independently and uses the right principal & rate per slice', () => {
    // Year 2024-25 with:
    //   - rate 5.00 from 6 Apr 2024
    //   - rate change to 6.00 on 1 Aug 2024
    //   - balance drops from 100k to 80k on 1 Oct 2024
    //   - rate change to 5.50 on 1 Jan 2025
    //   - balance drops to 60k on 1 Jan 2025 (same day as a rate change)
    // Expected slices:
    //   Apr 6  - Aug 1  (117d @ 100k & 5.00)
    //   Aug 1  - Oct 1  ( 61d @ 100k & 6.00)
    //   Oct 1  - Jan 1  ( 92d @ 80k  & 6.00)
    //   Jan 1  - Apr 6  ( 95d @ 60k  & 5.50)
    const calc = computeInterestForRange({
      balanceSchedule: [
        { effectiveDate: '2024-04-06', principal: '100000' },
        { effectiveDate: '2024-10-01', principal: '80000' },
        { effectiveDate: '2025-01-01', principal: '60000' },
      ],
      rangeFrom: '2024-04-06',
      rangeTo: '2025-04-06',
      rateHistory: [
        { rate: '5.00', effectiveDate: '2024-04-06' },
        { rate: '6.00', effectiveDate: '2024-08-01' },
        { rate: '5.50', effectiveDate: '2025-01-01' },
      ],
    });

    expect(calc.periods).toHaveLength(4);
    expect(calc.periods[0]).toMatchObject({
      days: 117, principal: '100000.00', rate: '5.00',
    });
    expect(calc.periods[1]).toMatchObject({
      days: 61, principal: '100000.00', rate: '6.00',
    });
    expect(calc.periods[2]).toMatchObject({
      days: 92, principal: '80000.00', rate: '6.00',
    });
    expect(calc.periods[3]).toMatchObject({
      days: 95, principal: '60000.00', rate: '5.50',
    });
    expect(calc.totalInterest).toBe(
      sumExpected([
        sliceInterest(100000, 5, 117),
        sliceInterest(100000, 6, 61),
        sliceInterest(80000, 6, 92),
        sliceInterest(60000, 5.5, 95),
      ]),
    );
  });
});

describe('computeInterestForRange — fallback when balance history is missing', () => {
  it('uses the fixed `principal` when no balanceSchedule is provided', () => {
    const calc = computeInterestForRange({
      principal: '120000',
      rangeFrom: '2024-04-06',
      rangeTo: '2025-04-06',
      rateHistory: [{ rate: '4.50', effectiveDate: '2024-04-06' }],
    });
    expect(calc.periods).toHaveLength(1);
    expect(calc.periods[0].principal).toBe('120000.00');
    expect(calc.totalInterest).toBe(expectedInterest(120000, 4.5, 365));
  });

  it('throws when neither principal nor balanceSchedule is provided', () => {
    expect(() =>
      computeInterestForRange({
        rangeFrom: '2024-04-06',
        rangeTo: '2025-04-06',
        rateHistory: [{ rate: '5.00', effectiveDate: '2024-04-06' }],
      }),
    ).toThrow(/must pass either `principal`/);
  });

  it('treats an empty balanceSchedule the same as missing (requires principal)', () => {
    expect(() =>
      computeInterestForRange({
        balanceSchedule: [],
        rangeFrom: '2024-04-06',
        rangeTo: '2025-04-06',
        rateHistory: [{ rate: '5.00', effectiveDate: '2024-04-06' }],
      }),
    ).toThrow(/must pass either `principal`/);
  });

  it('throws when balanceSchedule does not cover the range start', () => {
    // Schedule starts AFTER rangeFrom; without explicit coverage the
    // calculator silently used the first entry, inventing a balance
    // for an uncovered prefix. Defence-in-depth: throw instead.
    expect(() =>
      computeInterestForRange({
        balanceSchedule: [{ effectiveDate: '2024-06-01', principal: '100000' }],
        rangeFrom: '2024-04-06',
        rangeTo: '2025-04-06',
        rateHistory: [{ rate: '5.00', effectiveDate: '2024-04-06' }],
      }),
    ).toThrow(/balanceSchedule does not cover/);
  });
});

describe('monthlyBreakdown — works with the new period principals', () => {
  it('respects the principal-per-period when slicing into months', () => {
    const calc = computeInterestForRange({
      balanceSchedule: [
        { effectiveDate: '2024-04-06', principal: '100000' },
        { effectiveDate: '2024-07-01', principal: '50000' },
      ],
      rangeFrom: '2024-04-06',
      rangeTo: '2024-08-01',
      rateHistory: [{ rate: '6.00', effectiveDate: '2024-04-06' }],
    });
    const months = monthlyBreakdown(calc);
    // Apr 6 - Aug 1 spans Apr/May/Jun/Jul. The Jul slice should price
    // at the new £50k balance (effective 1 Jul), not the old £100k.
    const jul = months.find(m => m.month === '2024-07');
    expect(jul).toBeDefined();
    // 31 days in July at 50k * 6%/365
    expect(jul!.interest).toBe(expectedInterest(50000, 6, 31));
    const jun = months.find(m => m.month === '2024-06');
    expect(jun).toBeDefined();
    // 30 days in June at 100k * 6%/365
    expect(jun!.interest).toBe(expectedInterest(100000, 6, 30));
  });
});
