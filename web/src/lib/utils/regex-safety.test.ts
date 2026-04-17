import { describe, it, expect } from 'vitest';
import {
  isSafeRegex,
  capInput,
  MATCH_INPUT_CAP,
  PATTERN_MAX_LENGTH,
} from './regex-safety';

describe('isSafeRegex', () => {
  it('accepts a simple literal', () => {
    expect(isSafeRegex('tesco')).toEqual({ ok: true });
  });

  it('accepts alternation and character classes', () => {
    expect(isSafeRegex('^(tesco|sainsbury) [a-z]+$')).toEqual({ ok: true });
  });

  it('rejects an empty pattern', () => {
    expect(isSafeRegex('')).toMatchObject({ ok: false });
  });

  it('rejects invalid regex syntax', () => {
    const result = isSafeRegex('(unclosed');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/syntax/i);
  });

  it('rejects patterns over the length cap', () => {
    const long = 'a'.repeat(PATTERN_MAX_LENGTH + 1);
    const result = isSafeRegex(long);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/exceeds/);
  });

  it('rejects nested quantifiers (ReDoS shape)', () => {
    for (const bad of ['(a+)+', '(a*)*', '(.+)+', '(ab+)+', '(a{1,3})+']) {
      const result = isSafeRegex(bad);
      expect(result.ok, `expected ${bad} to be rejected`).toBe(false);
      if (!result.ok) expect(result.reason).toMatch(/nested quantifier/i);
    }
  });
});

describe('capInput', () => {
  it('returns the input unchanged if under the cap', () => {
    expect(capInput('hello')).toBe('hello');
  });

  it('truncates inputs over the cap', () => {
    const long = 'x'.repeat(MATCH_INPUT_CAP + 50);
    expect(capInput(long)).toHaveLength(MATCH_INPUT_CAP);
  });
});
