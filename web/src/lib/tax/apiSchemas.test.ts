import { describe, it, expect } from 'vitest';
import {
  formatZodIssues,
  ownerTaxProfileBodySchema,
  propertyPatchBodySchema,
} from './apiSchemas';

describe('ownerTaxProfileBodySchema', () => {
  it('normalises numbers and numeric strings to 2dp strings', () => {
    const r = ownerTaxProfileBodySchema.parse({
      employmentIncome: 12570,
      payeTaxPaid: '0',
      dividends: '1500.5',
      notes: '  from payslips  ',
    });
    expect(r.employmentIncome).toBe('12570.00');
    expect(r.payeTaxPaid).toBe('0.00');
    expect(r.dividends).toBe('1500.50');
    expect(r.notes).toBe('from payslips');
    // Omitted fields stay undefined; the route fills them with 0.00.
    expect(r.otherIncome).toBeUndefined();
  });

  it('turns blank notes into null', () => {
    expect(ownerTaxProfileBodySchema.parse({ notes: '   ' }).notes).toBeNull();
    expect(ownerTaxProfileBodySchema.parse({ notes: null }).notes).toBeNull();
  });

  it('rejects negative, malformed, over-precise and oversized amounts', () => {
    for (const bad of [-1, '-5', 'abc', '1.234', '1,000', 1e21, '1000000000000']) {
      const r = ownerTaxProfileBodySchema.safeParse({ dividends: bad });
      expect(r.success, `dividends=${String(bad)}`).toBe(false);
    }
  });

  it('rejects unknown fields', () => {
    expect(ownerTaxProfileBodySchema.safeParse({ salary: 1 }).success).toBe(false);
  });

  it('names the failing field in the message', () => {
    const r = ownerTaxProfileBodySchema.safeParse({ payeTaxPaid: -1 });
    expect(r.success).toBe(false);
    if (!r.success) expect(formatZodIssues(r.error)).toContain('payeTaxPaid');
  });
});

describe('propertyPatchBodySchema', () => {
  it('accepts the two letting types', () => {
    expect(propertyPatchBodySchema.parse({ lettingType: 'standard' }).lettingType).toBe('standard');
    expect(propertyPatchBodySchema.parse({ lettingType: 'rent_a_room' }).lettingType).toBe('rent_a_room');
  });

  it('rejects other values, missing values and extra fields', () => {
    expect(propertyPatchBodySchema.safeParse({ lettingType: 'airbnb' }).success).toBe(false);
    expect(propertyPatchBodySchema.safeParse({}).success).toBe(false);
    expect(propertyPatchBodySchema.safeParse({ lettingType: 'standard', name: 'x' }).success).toBe(false);
  });
});
