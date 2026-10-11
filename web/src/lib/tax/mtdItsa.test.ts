import { describe, it, expect } from 'vitest';
import { ClientError } from '@/lib/errors';
import { computeMtdItsaStatus } from './mtdItsa';

const status = (taxYear: string, property: number | string, selfEmployment: number | string = 0) =>
  computeMtdItsaStatus({ taxYear, propertyReceipts: property, selfEmploymentReceipts: selfEmployment });

describe('computeMtdItsaStatus', () => {
  it('uses £50,000 for 2024-25 income, mandatory from 6 April 2026, and needs MORE than the threshold', () => {
    const over = status('2024-25', '50000.01');
    expect(over.scope).toBe('in_scope');
    expect(over.threshold).toBe('50000.00');
    expect(over.mandatoryFrom).toBe('2026-04-06');
    // Exactly £50,000 is not "over" £50,000.
    expect(status('2024-25', 50000).scope).toBe('below_threshold');
  });

  it('uses £30,000 for 2025-26 income, mandatory from 6 April 2027', () => {
    const under = status('2025-26', 10000);
    expect(under.scope).toBe('below_threshold');
    expect(under.threshold).toBe('30000.00');
    expect(under.mandatoryFrom).toBe('2027-04-06');
    expect(under.headroom).toBe('20000.00');
    expect(status('2025-26', 30000.01).scope).toBe('in_scope');
  });

  it('uses £20,000 for 2026-27 income, mandatory from 6 April 2028', () => {
    const r = status('2026-27', 25000);
    expect(r.scope).toBe('in_scope');
    expect(r.threshold).toBe('20000.00');
    expect(r.mandatoryFrom).toBe('2028-04-06');
    expect(r.headroom).toBe('-5000.00');
  });

  it('adds property receipts and self-employment receipts', () => {
    // 10,000 + 25,000 = 35,000 is over the £30,000 threshold.
    const r = status('2025-26', 10000, 25000);
    expect(r.qualifyingIncome).toBe('35000.00');
    expect(r.propertyReceipts).toBe('10000.00');
    expect(r.selfEmploymentReceipts).toBe('25000.00');
    expect(r.scope).toBe('in_scope');
  });

  it('has no phase for years before 2024-25', () => {
    const r = status('2023-24', 100000);
    expect(r.scope).toBe('no_phase');
    expect(r.threshold).toBeNull();
    expect(r.mandatoryFrom).toBeNull();
  });

  it('compares later years with the lowest announced threshold and says so', () => {
    const r = status('2028-29', 21000);
    expect(r.thresholdAssumed).toBe(true);
    expect(r.threshold).toBe('20000.00');
    expect(r.scope).toBe('in_scope');
    expect(r.summary).toContain('No MTD ITSA phase has been announced');
  });

  it('flags only the announced years as non-assumed', () => {
    expect(status('2025-26', 1).thresholdAssumed).toBe(false);
  });

  it('rejects bad labels and negative amounts', () => {
    expect(() => status('2025', 1)).toThrow(ClientError);
    expect(() => status('2025-26', -1)).toThrow(ClientError);
  });
});
