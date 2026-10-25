import { describe, expect, it } from 'vitest';
import { ClientError } from '@/lib/errors';
import { validateTenancyFields } from './tenancy.repo';

const valid = { tenantName: 'Sam Lee', startDate: '2025-04-06', endDate: null, rentAmount: '1250.00', rentFrequency: 'monthly' as const };

describe('tenancy field validation', () => {
  it('accepts a well-formed tenancy, with or without an end date', () => {
    expect(() => validateTenancyFields(valid)).not.toThrow();
    expect(() => validateTenancyFields({ ...valid, endDate: '2026-04-05', depositAmount: '1442.30' })).not.toThrow();
  });

  it('refuses dates the rent schedule would compare wrongly', () => {
    for (const startDate of ['06/04/2025', '2025-4-6', '2025-02-30', '']) {
      expect(() => validateTenancyFields({ ...valid, startDate })).toThrow(ClientError);
    }
    expect(() => validateTenancyFields({ ...valid, endDate: '2024-01-01' })).toThrow('cannot be before its start date');
  });

  it('refuses rent that is missing, zero, negative or not a number', () => {
    for (const rentAmount of ['', '0', '-100', 'twelve hundred']) {
      expect(() => validateTenancyFields({ ...valid, rentAmount })).toThrow(ClientError);
    }
  });

  it('checks an edited end date against the saved start date', () => {
    const existing = { startDate: '2025-04-06', endDate: null };
    expect(() => validateTenancyFields({ endDate: '2025-01-01' }, existing)).toThrow('cannot be before its start date');
    expect(() => validateTenancyFields({ endDate: '2026-04-05' }, existing)).not.toThrow();
    expect(() => validateTenancyFields({ notes: 'Renewed' }, existing)).not.toThrow();
  });

  it('refuses an unknown rent frequency or a blank tenant name', () => {
    expect(() => validateTenancyFields({ ...valid, rentFrequency: 'fortnightly' as never })).toThrow('Rent frequency must be one of');
    expect(() => validateTenancyFields({ ...valid, tenantName: '   ' })).toThrow('Enter the tenant name');
  });
});
