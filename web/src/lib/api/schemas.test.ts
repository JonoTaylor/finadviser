import { describe, it, expect } from 'vitest';
import {
  idString,
  idNumber,
  idParams,
  pagination,
  dateString,
  monthString,
  moneyString,
  accountType,
  matchType,
  ruleSource,
  optionalIntQuery,
} from './schemas';

describe('idString / idNumber', () => {
  it('parses a numeric string into a positive integer', () => {
    expect(idString.parse('42')).toBe(42);
  });

  it('rejects non-numeric strings', () => {
    expect(() => idString.parse('abc')).toThrow();
    expect(() => idString.parse('-3')).toThrow();
    expect(() => idString.parse('3.14')).toThrow();
  });

  it('rejects zero and negative numbers', () => {
    expect(() => idString.parse('0')).toThrow();
    expect(() => idNumber.parse(0)).toThrow();
    expect(() => idNumber.parse(-1)).toThrow();
  });

  it('accepts idNumber for positive integers', () => {
    expect(idNumber.parse(17)).toBe(17);
  });
});

describe('idParams', () => {
  it('parses { id } from path params', () => {
    expect(idParams.parse({ id: '123' })).toEqual({ id: 123 });
  });
});

describe('pagination', () => {
  it('parses limit and offset from strings', () => {
    expect(pagination.parse({ limit: '50', offset: '100' })).toEqual({
      limit: 50,
      offset: 100,
    });
  });

  it('rejects limits over 500', () => {
    expect(() => pagination.parse({ limit: '501' })).toThrow();
  });

  it('rejects offsets over 1,000,000', () => {
    expect(() => pagination.parse({ offset: '1000001' })).toThrow();
  });

  it('allows both fields to be absent', () => {
    expect(pagination.parse({})).toEqual({});
  });
});

describe('dateString', () => {
  it('accepts YYYY-MM-DD', () => {
    expect(dateString.parse('2026-04-17')).toBe('2026-04-17');
  });

  it('rejects other formats', () => {
    expect(() => dateString.parse('17/04/2026')).toThrow();
    expect(() => dateString.parse('2026-4-17')).toThrow();
  });
});

describe('monthString', () => {
  it('accepts YYYY-MM', () => {
    expect(monthString.parse('2026-04')).toBe('2026-04');
  });

  it('rejects full dates', () => {
    expect(() => monthString.parse('2026-04-17')).toThrow();
  });
});

describe('moneyString', () => {
  it('accepts integers, decimals, and negatives', () => {
    expect(moneyString.parse('100')).toBe('100');
    expect(moneyString.parse('-12.34')).toBe('-12.34');
    expect(moneyString.parse('0.01')).toBe('0.01');
  });

  it('rejects more than 2 fractional digits', () => {
    expect(() => moneyString.parse('1.234')).toThrow();
  });

  it('rejects scientific notation and non-numeric', () => {
    expect(() => moneyString.parse('1e5')).toThrow();
    expect(() => moneyString.parse('abc')).toThrow();
    expect(() => moneyString.parse('')).toThrow();
  });
});

describe('enums', () => {
  it('accountType rejects unknown values', () => {
    expect(accountType.parse('ASSET')).toBe('ASSET');
    expect(() => accountType.parse('DERIVATIVE')).toThrow();
  });

  it('matchType and ruleSource work', () => {
    expect(matchType.parse('regex')).toBe('regex');
    expect(ruleSource.parse('ai')).toBe('ai');
    expect(() => matchType.parse('fuzzy')).toThrow();
  });
});

describe('optionalIntQuery', () => {
  it('parses numeric strings to numbers', () => {
    expect(optionalIntQuery.parse('42')).toBe(42);
  });

  it('allows undefined', () => {
    expect(optionalIntQuery.parse(undefined)).toBeUndefined();
  });

  it('rejects non-numeric strings', () => {
    expect(() => optionalIntQuery.parse('abc')).toThrow();
  });
});
