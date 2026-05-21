import { describe, it, expect } from 'vitest';
import Decimal from 'decimal.js';
import { projectGlidePath } from './glide-path';

describe('projectGlidePath', () => {
  it('fills the ISA allowance before deploying to the GIA', () => {
    const result = projectGlidePath({
      initialProceeds: new Decimal(150000), // 2 owners × 20k = 40k ISA cap
      equityReturnPct: new Decimal(6),
      ownerCount: 2,
      yearsToProject: 1,
      giaDragPct: new Decimal(0), // disable drag for the assertion
    });
    expect(result).toHaveLength(1);
    expect(result[0].isaContribution.toString()).toBe('40000');
    expect(result[0].giaContribution.toString()).toBe('110000');
  });

  it('compounds existing balances year over year', () => {
    const result = projectGlidePath({
      initialProceeds: new Decimal(40000),
      equityReturnPct: new Decimal(10),
      ownerCount: 2,
      yearsToProject: 2,
      giaDragPct: new Decimal(0),
    });
    // Y1: 40000 into ISA, grown at 10% at start of next year.
    // Y2: existing 40000 × 1.10 = 44000; no new contribution.
    expect(result[1].isaBalance.toString()).toBe('44000');
    expect(result[1].giaContribution.toString()).toBe('0');
  });

  it('applies the GIA drag only to the GIA balance', () => {
    const noDrag = projectGlidePath({
      initialProceeds: new Decimal(150000),
      equityReturnPct: new Decimal(10),
      ownerCount: 2,
      yearsToProject: 1,
      giaDragPct: new Decimal(0),
    });
    const withDrag = projectGlidePath({
      initialProceeds: new Decimal(150000),
      equityReturnPct: new Decimal(10),
      ownerCount: 2,
      yearsToProject: 1,
      giaDragPct: new Decimal(1),
    });
    // ISA balance unchanged (drag doesn't apply).
    expect(withDrag[0].isaBalance.toString()).toBe(noDrag[0].isaBalance.toString());
    // GIA balance lower under drag (compared YEAR 1 — drag applies to
    // already-deployed GIA balance growth; Y1 deploys but doesn't
    // grow yet, so check Y2 instead).
    const noDrag2 = projectGlidePath({
      initialProceeds: new Decimal(150000),
      equityReturnPct: new Decimal(10),
      ownerCount: 2,
      yearsToProject: 2,
      giaDragPct: new Decimal(0),
    });
    const withDrag2 = projectGlidePath({
      initialProceeds: new Decimal(150000),
      equityReturnPct: new Decimal(10),
      ownerCount: 2,
      yearsToProject: 2,
      giaDragPct: new Decimal(1),
    });
    expect(withDrag2[1].giaBalance.lt(noDrag2[1].giaBalance)).toBe(true);
  });
});
