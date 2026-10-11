import { describe, expect, it } from 'vitest';
import {
  expandTenancies,
  expandTenancy,
  totalScheduled,
  type RentFrequency,
  type TenancyForSchedule,
} from './rent-schedule';

function tenancy(over: Partial<TenancyForSchedule> = {}): TenancyForSchedule {
  return {
    id: 1,
    tenantName: 'Pat Tenant',
    startDate: '2024-06-01',
    endDate: null,
    rentAmount: '2200.00',
    rentFrequency: 'monthly',
    ...over,
  };
}

const WIDE_START = '2020-01-01';
const WIDE_END = '2030-12-31';

const dueDates = (lines: { dueDate: string }[]) => lines.map(l => l.dueDate);

describe('expandTenancies: consecutive tenancies sharing a handover day (249 Francis Road)', () => {
  const first = tenancy({ id: 1, tenantName: 'Tenant One', startDate: '2024-06-01', endDate: '2026-02-01' });
  const second = tenancy({ id: 2, tenantName: 'Tenant Two', startDate: '2026-02-01', endDate: '2027-01-31' });

  // Tax year 2025-26
  const schedule = expandTenancies([first, second], '2025-04-06', '2026-04-05');

  it('has 12 dues totalling 26400.00 in 2025-26 (not 13 / 28600.00)', () => {
    expect(schedule).toHaveLength(12);
    expect(totalScheduled(schedule)).toBe('26400.00');
  });

  it('gives tenancy 1 the dues 1 May 2025 to 1 Jan 2026 (9) and tenancy 2 the dues 1 Feb to 1 Apr 2026 (3)', () => {
    expect(dueDates(schedule.filter(l => l.tenancyId === 1))).toEqual([
      '2025-05-01', '2025-06-01', '2025-07-01', '2025-08-01', '2025-09-01',
      '2025-10-01', '2025-11-01', '2025-12-01', '2026-01-01',
    ]);
    expect(dueDates(schedule.filter(l => l.tenancyId === 2))).toEqual(['2026-02-01', '2026-03-01', '2026-04-01']);
  });

  it('has no due from tenancy 1 on the handover day, and exactly one due that day, from tenancy 2', () => {
    expect(schedule.filter(l => l.tenancyId === 1 && l.dueDate === '2026-02-01')).toHaveLength(0);
    const onHandover = schedule.filter(l => l.dueDate === '2026-02-01');
    expect(onHandover).toHaveLength(1);
    expect(onHandover[0].tenancyId).toBe(2);
    expect(onHandover[0].periodStart).toBe('2026-02-01');
    expect(onHandover[0].periodEnd).toBe('2026-02-28');
  });

  it('ends tenancy 1 with a full January period, the day before the handover', () => {
    const last = schedule.filter(l => l.tenancyId === 1).at(-1)!;
    expect(last.dueDate).toBe('2026-01-01');
    expect(last.periodEnd).toBe('2026-01-31');
  });

  it('does not double count in the adjacent tax year either', () => {
    // 2024-25: tenancy 1 only, 1 Jun 2024 ... 1 Apr 2025 = 11 dues
    const prior = expandTenancies([first, second], '2024-04-06', '2025-04-05');
    expect(prior).toHaveLength(11);
    // 2026-27: tenancy 2 only, 1 May 2026 ... 1 Jan 2027 = 9 dues (31 Jan end is mid-period)
    const next = expandTenancies([first, second], '2026-04-06', '2027-04-05');
    expect(next.every(l => l.tenancyId === 2)).toBe(true);
    expect(next).toHaveLength(9);
  });
});

describe('expandTenancy: a tenancy ending on a due day', () => {
  it('drops the due on the end date for weekly rent; the last full period ends the day before', () => {
    const lines = expandTenancy(
      tenancy({ startDate: '2026-01-01', endDate: '2026-01-15', rentAmount: '100.00', rentFrequency: 'weekly' }),
      WIDE_START,
      WIDE_END,
    );
    expect(dueDates(lines)).toEqual(['2026-01-01', '2026-01-08']); // not 2026-01-15
    expect(lines[1].periodEnd).toBe('2026-01-14');
    expect(totalScheduled(lines)).toBe('200.00');
  });

  it('drops the due on the end date for quarterly rent; the last full period ends the day before', () => {
    const lines = expandTenancy(
      tenancy({ startDate: '2025-01-01', endDate: '2025-07-01', rentAmount: '3000.00', rentFrequency: 'quarterly' }),
      WIDE_START,
      WIDE_END,
    );
    expect(dueDates(lines)).toEqual(['2025-01-01', '2025-04-01']); // not 2025-07-01
    expect(lines[1].periodEnd).toBe('2025-06-30');
    expect(totalScheduled(lines)).toBe('6000.00');
  });

  it.each<[RentFrequency, string, string, string[]]>([
    ['monthly', '2025-01-01', '2025-04-01', ['2025-01-01', '2025-02-01', '2025-03-01']],
    ['four_weekly', '2025-01-01', '2025-02-26', ['2025-01-01', '2025-01-29']], // 29 Jan + 28 days = 26 Feb
    ['annual', '2023-03-10', '2025-03-10', ['2023-03-10', '2024-03-10']],
  ])('drops the due on the end date for %s rent', (rentFrequency, startDate, endDate, expected) => {
    const lines = expandTenancy(tenancy({ startDate, endDate, rentFrequency }), WIDE_START, WIDE_END);
    expect(dueDates(lines)).toEqual(expected);
  });

  it('drops a day-of-month-clamped due that lands on the end date', () => {
    // anchored on the 31st, so the February due clamps to 28 Feb, which is the end date
    const lines = expandTenancy(tenancy({ startDate: '2025-01-31', endDate: '2025-02-28' }), WIDE_START, WIDE_END);
    expect(dueDates(lines)).toEqual(['2025-01-31']);
    expect(lines[0].periodEnd).toBe('2025-02-27');
  });

  it('yields nothing for a due that lands on the range start when the tenancy ends that day', () => {
    // The handover day belongs to whoever starts that day, not to the tenancy that ends.
    const lines = expandTenancy(tenancy({ startDate: '2024-06-06', endDate: '2025-04-06' }), '2025-04-06', '2026-04-05');
    expect(lines).toEqual([]);
  });
});

describe('expandTenancy: a tenancy ending mid-period (unchanged)', () => {
  it('still includes the due and caps the period end, for monthly rent', () => {
    const lines = expandTenancy(
      tenancy({ startDate: '2025-01-01', endDate: '2025-03-15' }),
      WIDE_START,
      WIDE_END,
    );
    expect(dueDates(lines)).toEqual(['2025-01-01', '2025-02-01', '2025-03-01']);
    expect(lines[2].periodStart).toBe('2025-03-01');
    expect(lines[2].periodEnd).toBe('2025-03-15'); // capped at end_date, not 2025-03-31
    expect(lines[2].amount).toBe('2200.00'); // full rent, not pro-rated
  });

  it('still includes the due and caps the period end, for weekly rent', () => {
    const lines = expandTenancy(
      tenancy({ startDate: '2026-01-01', endDate: '2026-01-12', rentAmount: '100.00', rentFrequency: 'weekly' }),
      WIDE_START,
      WIDE_END,
    );
    expect(dueDates(lines)).toEqual(['2026-01-01', '2026-01-08']);
    expect(lines[1].periodEnd).toBe('2026-01-12'); // capped, not 2026-01-14
  });

  it('includes a due one day before the end date', () => {
    const lines = expandTenancy(tenancy({ startDate: '2025-01-01', endDate: '2025-03-02' }), WIDE_START, WIDE_END);
    expect(dueDates(lines)).toEqual(['2025-01-01', '2025-02-01', '2025-03-01']);
    expect(lines[2].periodEnd).toBe('2025-03-02');
  });
});

describe('expandTenancy: a one-day tenancy (start_date = end_date)', () => {
  it('keeps its single due, whatever the frequency', () => {
    const frequencies: RentFrequency[] = ['weekly', 'four_weekly', 'monthly', 'quarterly', 'annual'];
    for (const rentFrequency of frequencies) {
      const lines = expandTenancy(
        tenancy({ startDate: '2026-02-01', endDate: '2026-02-01', rentFrequency }),
        WIDE_START,
        WIDE_END,
      );
      expect(lines, rentFrequency).toHaveLength(1);
      expect(lines[0].dueDate).toBe('2026-02-01');
      expect(lines[0].periodStart).toBe('2026-02-01');
      expect(lines[0].periodEnd).toBe('2026-02-01');
      expect(lines[0].amount).toBe('2200.00');
    }
  });

  it('is only counted in a range that contains its day', () => {
    const t = tenancy({ startDate: '2026-02-01', endDate: '2026-02-01' });
    expect(expandTenancy(t, '2026-02-01', '2026-02-28')).toHaveLength(1);
    expect(expandTenancy(t, '2026-01-01', '2026-02-01')).toHaveLength(1);
    expect(expandTenancy(t, '2026-02-02', '2026-03-31')).toHaveLength(0);
    expect(expandTenancy(t, '2026-01-01', '2026-01-31')).toHaveLength(0);
  });
});

describe('expandTenancy: an open-ended tenancy (unchanged)', () => {
  it('generates a due every month through the range, with a full period each', () => {
    const lines = expandTenancy(tenancy({ endDate: null }), '2025-04-06', '2026-04-05');
    expect(lines).toHaveLength(12);
    expect(lines[0].dueDate).toBe('2025-05-01');
    expect(lines.at(-1)!.dueDate).toBe('2026-04-01');
    expect(lines.at(-1)!.periodEnd).toBe('2026-04-30');
    expect(totalScheduled(lines)).toBe('26400.00');
  });
});

describe('expandTenancy: range handling (unchanged)', () => {
  it('returns nothing when the tenancy is wholly outside the range', () => {
    expect(expandTenancy(tenancy({ endDate: '2025-01-01' }), '2025-04-06', '2026-04-05')).toEqual([]);
    expect(expandTenancy(tenancy({ startDate: '2026-05-01' }), '2025-04-06', '2026-04-05')).toEqual([]);
  });

  it('sorts expandTenancies output by due date across tenancies', () => {
    const a = tenancy({ id: 1, startDate: '2025-01-10', endDate: '2025-03-30' });
    const b = tenancy({ id: 2, startDate: '2025-01-05', endDate: '2025-03-30' });
    const lines = expandTenancies([a, b], WIDE_START, WIDE_END);
    expect(dueDates(lines)).toEqual([
      '2025-01-05', '2025-01-10', '2025-02-05', '2025-02-10', '2025-03-05', '2025-03-10',
    ]);
  });
});
