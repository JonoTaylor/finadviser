import { describe, it, expect } from 'vitest';
import Decimal from 'decimal.js';
import { projectGlidePath } from './glide-path';

describe('projectGlidePath', () => {
  it('fills the ISA allowance before deploying to the GIA in year 1', () => {
    const result = projectGlidePath({
      initialProceeds: new Decimal(150000), // 2 owners × 20k = 40k ISA cap
      equityReturnPct: new Decimal(6),
      ownerCount: 2,
      yearsToProject: 1,
      giaDragPct: new Decimal(0),
    });
    expect(result).toHaveLength(1);
    expect(result[0].isaContribution.toString()).toBe('40000');
    expect(result[0].giaContribution.toString()).toBe('110000');
    // Year 1 includes growth on the deployed lump sum (40k × 1.06 = 42400,
    // 110k × 1.06 = 116600), so the year-end total is 159000.
    expect(result[0].totalBalance.toString()).toBe('159000');
  });

  it('bed-and-ISAs from the GIA each subsequent year', () => {
    const result = projectGlidePath({
      initialProceeds: new Decimal(150000), // 40k into ISA, 110k into GIA
      equityReturnPct: new Decimal(0),
      ownerCount: 2,
      yearsToProject: 4,
      giaDragPct: new Decimal(0),
    });
    // With zero growth + zero drag, every year moves 40k from GIA into ISA
    // until the GIA is empty. Y1: ISA 40k / GIA 110k. Y2: ISA 80k / GIA 70k.
    // Y3: ISA 120k / GIA 30k. Y4: ISA 150k / GIA 0k.
    expect(result[0].isaBalance.toString()).toBe('40000');
    expect(result[0].giaBalance.toString()).toBe('110000');
    expect(result[1].isaContribution.toString()).toBe('40000');
    expect(result[1].giaContribution.toString()).toBe('-40000');
    expect(result[1].isaBalance.toString()).toBe('80000');
    expect(result[1].giaBalance.toString()).toBe('70000');
    expect(result[3].isaBalance.toString()).toBe('150000');
    expect(result[3].giaBalance.toString()).toBe('0');
  });

  it('caps the bed-and-ISA transfer at the remaining GIA balance', () => {
    const result = projectGlidePath({
      initialProceeds: new Decimal(50000), // 40k ISA / 10k GIA after Y1
      equityReturnPct: new Decimal(0),
      ownerCount: 2,
      yearsToProject: 3,
      giaDragPct: new Decimal(0),
    });
    expect(result[0].giaBalance.toString()).toBe('10000');
    // Y2 only moves the 10k that's actually in the GIA, not the full 40k cap.
    expect(result[1].isaContribution.toString()).toBe('10000');
    expect(result[1].giaBalance.toString()).toBe('0');
    // Y3 has nothing left in the GIA to transfer.
    expect(result[2].isaContribution.toString()).toBe('0');
  });

  it('applies GIA tax drag only to the GIA balance', () => {
    const noDrag = projectGlidePath({
      initialProceeds: new Decimal(150000),
      equityReturnPct: new Decimal(10),
      ownerCount: 2,
      yearsToProject: 2,
      giaDragPct: new Decimal(0),
    });
    const withDrag = projectGlidePath({
      initialProceeds: new Decimal(150000),
      equityReturnPct: new Decimal(10),
      ownerCount: 2,
      yearsToProject: 2,
      giaDragPct: new Decimal(1),
    });
    // ISA balance grows identically under both (drag doesn't apply).
    expect(withDrag[0].isaBalance.toString()).toBe(noDrag[0].isaBalance.toString());
    expect(withDrag[1].isaBalance.toString()).toBe(noDrag[1].isaBalance.toString());
    // GIA balance lower under drag.
    expect(withDrag[1].giaBalance.lt(noDrag[1].giaBalance)).toBe(true);
  });

  it('grows the deployed proceeds in year 1 (no zero-growth lag)', () => {
    const result = projectGlidePath({
      initialProceeds: new Decimal(40000), // entire amount fits in ISA
      equityReturnPct: new Decimal(10),
      ownerCount: 2,
      yearsToProject: 1,
      giaDragPct: new Decimal(0),
    });
    // 40000 × 1.10 = 44000
    expect(result[0].isaBalance.toString()).toBe('44000');
  });
});
