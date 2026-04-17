import { describe, it, expect } from 'vitest';
import { matchRule } from './categorizer';

type Rule = Parameters<typeof matchRule>[1][number];

function rule(partial: Partial<Rule> & Pick<Rule, 'pattern' | 'categoryId'>): Rule {
  return { matchType: 'contains', ...partial } as Rule;
}

describe('matchRule', () => {
  it('returns the categoryId of the first contains match (case-insensitive)', () => {
    const rules = [
      rule({ pattern: 'TESCO', categoryId: 7 }),
      rule({ pattern: 'Sainsbury', categoryId: 8 }),
    ];
    expect(matchRule('TESCO STORES 4567', rules)).toBe(7);
    expect(matchRule('tesco stores 4567', rules)).toBe(7);
    expect(matchRule('sainsburys local', rules)).toBe(8);
  });

  it('honours startswith', () => {
    const rules = [rule({ pattern: 'DD ', categoryId: 3, matchType: 'startswith' })];
    expect(matchRule('DD Gym membership', rules)).toBe(3);
    expect(matchRule('Payment DD Gym', rules)).toBeNull();
  });

  it('honours exact', () => {
    const rules = [rule({ pattern: 'Salary', categoryId: 10, matchType: 'exact' })];
    expect(matchRule('Salary', rules)).toBe(10);
    expect(matchRule('Salary payment', rules)).toBeNull();
  });

  it('honours regex and is case-insensitive', () => {
    const rules = [rule({ pattern: '^amz\\b', categoryId: 5, matchType: 'regex' })];
    expect(matchRule('AMZ Marketplace', rules)).toBe(5);
    expect(matchRule('Amazon', rules)).toBeNull();
  });

  it('skips dangerous regex patterns (ReDoS heuristic) instead of matching them', () => {
    const rules = [
      rule({ pattern: '(a+)+', categoryId: 99, matchType: 'regex' }),
      rule({ pattern: 'tesco', categoryId: 7 }),
    ];
    // The nested-quantifier rule is skipped, so the next contains rule wins.
    expect(matchRule('aaaaaaa tesco', rules)).toBe(7);
  });

  it('skips invalid regex patterns silently', () => {
    const rules = [
      rule({ pattern: '(unclosed', categoryId: 99, matchType: 'regex' }),
      rule({ pattern: 'tesco', categoryId: 7 }),
    ];
    expect(matchRule('tesco extra', rules)).toBe(7);
  });

  it('returns null when no rule matches', () => {
    expect(matchRule('mystery payment', [rule({ pattern: 'tesco', categoryId: 7 })])).toBeNull();
  });

  it('defaults null matchType to contains', () => {
    const rules = [rule({ pattern: 'tesco', categoryId: 7, matchType: null })];
    expect(matchRule('Tesco', rules)).toBe(7);
  });
});
