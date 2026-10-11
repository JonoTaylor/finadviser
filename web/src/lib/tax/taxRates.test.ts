import { describe, it, expect } from 'vitest';
import { ClientError } from '@/lib/errors';
import {
  EARLIEST_KNOWN_TAX_YEAR,
  LATEST_KNOWN_TAX_YEAR,
  MTD_ITSA_COHORTS,
  getRatesForTaxYear,
} from './taxRates';

describe('getRatesForTaxYear', () => {
  it('holds a table for each of 2024-25 to 2027-28 and flags none as assumed', () => {
    for (const label of ['2024-25', '2025-26', '2026-27', '2027-28']) {
      const { table, ratesAssumed } = getRatesForTaxYear(label);
      expect(table.taxYear).toBe(label);
      expect(ratesAssumed).toBe(false);
      // Every table must cite at least one GOV.UK page.
      expect(table.sources.length).toBeGreaterThan(0);
      expect(table.sources.every(s => s.startsWith('https://'))).toBe(true);
    }
  });

  it('carries the verified 2025-26 figures', () => {
    const { table } = getRatesForTaxYear('2025-26');
    expect(table.personalAllowance.toString()).toBe('12570');
    expect(table.personalAllowanceTaperThreshold.toString()).toBe('100000');
    expect(table.basicRateLimit.toString()).toBe('37700');
    expect(table.additionalRateThreshold.toString()).toBe('125140');
    expect(table.nonSavingsRates.basic.toString()).toBe('20');
    expect(table.nonSavingsRates.higher.toString()).toBe('40');
    expect(table.nonSavingsRates.additional.toString()).toBe('45');
    expect(table.dividendRates.basic.toString()).toBe('8.75');
    expect(table.dividendRates.higher.toString()).toBe('33.75');
    expect(table.dividendRates.additional.toString()).toBe('39.35');
    expect(table.dividendAllowance.toString()).toBe('500');
    expect(table.startingRateForSavingsLimit.toString()).toBe('5000');
    expect(table.personalSavingsAllowance.basic.toString()).toBe('1000');
    expect(table.personalSavingsAllowance.higher.toString()).toBe('500');
    expect(table.personalSavingsAllowance.additional.toString()).toBe('0');
    expect(table.propertyAllowance.toString()).toBe('1000');
    expect(table.rentARoomLimit.toString()).toBe('7500');
    expect(table.financeCostReliefRatePct.toString()).toBe('20');
  });

  it('raises the dividend ordinary and upper rates from April 2026', () => {
    expect(getRatesForTaxYear('2025-26').table.dividendRates.basic.toString()).toBe('8.75');
    const t = getRatesForTaxYear('2026-27').table;
    expect(t.dividendRates.basic.toString()).toBe('10.75');
    expect(t.dividendRates.higher.toString()).toBe('35.75');
    expect(t.dividendRates.additional.toString()).toBe('39.35');
  });

  it('gives property its own 22/42/47% rates and 22% finance-cost relief from 2027-28 only', () => {
    for (const label of ['2024-25', '2025-26', '2026-27']) {
      const t = getRatesForTaxYear(label).table;
      expect(t.propertyRates.basic.toString()).toBe(t.nonSavingsRates.basic.toString());
      expect(t.financeCostReliefRatePct.toString()).toBe('20');
    }
    const t = getRatesForTaxYear('2027-28').table;
    expect(t.propertyRates.basic.toString()).toBe('22');
    expect(t.propertyRates.higher.toString()).toBe('42');
    expect(t.propertyRates.additional.toString()).toBe('47');
    expect(t.savingsRates.basic.toString()).toBe('22');
    expect(t.nonSavingsRates.basic.toString()).toBe('20');
    expect(t.financeCostReliefRatePct.toString()).toBe('22');
  });

  it('marks 2027-28 provisional and explains why; earlier years are not provisional', () => {
    const t = getRatesForTaxYear('2027-28').table;
    expect(t.provisional).toBe(true);
    expect(t.provisionalNotes.length).toBeGreaterThan(0);
    for (const label of ['2024-25', '2025-26', '2026-27']) {
      expect(getRatesForTaxYear(label).table.provisional).toBe(false);
    }
  });

  it('falls back to the latest table for a later year and flags ratesAssumed', () => {
    const { table, ratesAssumed } = getRatesForTaxYear('2030-31');
    expect(table.taxYear).toBe(LATEST_KNOWN_TAX_YEAR);
    expect(ratesAssumed).toBe(true);
  });

  it('falls back to the earliest table for a year before the first and flags ratesAssumed', () => {
    const { table, ratesAssumed } = getRatesForTaxYear('2020-21');
    expect(table.taxYear).toBe(EARLIEST_KNOWN_TAX_YEAR);
    expect(ratesAssumed).toBe(true);
  });

  it('rejects a malformed label with a ClientError', () => {
    expect(() => getRatesForTaxYear('2025')).toThrow(ClientError);
    expect(() => getRatesForTaxYear('2025-27')).toThrow(ClientError);
  });
});

describe('MTD_ITSA_COHORTS', () => {
  it('holds the three announced phases', () => {
    expect(MTD_ITSA_COHORTS.map(c => [c.basedOnTaxYear, c.threshold.toString(), c.mandatoryFrom])).toEqual([
      ['2024-25', '50000', '2026-04-06'],
      ['2025-26', '30000', '2027-04-06'],
      ['2026-27', '20000', '2028-04-06'],
    ]);
  });
});
