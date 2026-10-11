import { describe, expect, it } from 'vitest';
import { activeNavigationItem, navigationContext } from './navigation';

describe('navigation route selection', () => {
  it('only selects the dashboard at the root', () => {
    expect(activeNavigationItem('/')?.href).toBe('/');
    expect(activeNavigationItem('/unknown')).toBeUndefined();
  });

  it('keeps nested financial pages in the relevant section', () => {
    expect(activeNavigationItem('/properties/operations')?.href).toBe('/properties');
    expect(activeNavigationItem('/properties/17')?.href).toBe('/properties');
    expect(activeNavigationItem('/pensions/records')?.href).toBe('/pensions');
  });

  it('matches segment boundaries rather than similar path names', () => {
    expect(activeNavigationItem('/planning')).toBeUndefined();
    expect(activeNavigationItem('/properties-old')).toBeUndefined();
    expect(activeNavigationItem('/settings-backup')).toBeUndefined();
  });

  it('selects only the most specific item if routes overlap', () => {
    expect(activeNavigationItem('/properties/operations/123', [
      { label: 'Properties', href: '/properties' },
      { label: 'Operations', href: '/properties/operations' },
    ])?.href).toBe('/properties/operations');
  });

  it('provides context for nested records and account pages', () => {
    expect(navigationContext('/pensions/records')).toEqual({ section: 'Wealth', title: 'Pension records' });
    expect(navigationContext('/profile')).toEqual({ section: 'Your workspace', title: 'My context' });
  });
});
