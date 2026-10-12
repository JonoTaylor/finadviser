import { describe, expect, it } from 'vitest';
import { buildCategoryLabels } from './categoryLabels';

describe('review category labels', () => {
  it('distinguishes the same expense name in personal and property trees', () => {
    const labels = buildCategoryLabels([{ id: 1, name: 'Personal' }, { id: 2, name: 'Property' }, { id: 3, name: 'Insurance', parentId: 1 }, { id: 4, name: 'Insurance', parentId: 2 }]);
    expect(labels.get(3)).toBe('Personal / Insurance');
    expect(labels.get(4)).toBe('Property / Insurance');
  });
  it('disambiguates legacy equal paths without changing IDs', () => {
    const labels = buildCategoryLabels([{ id: 1, name: 'Groceries' }, { id: 2, name: 'Groceries' }]);
    expect(labels.get(1)).toBe('Groceries · ID 1');
    expect(labels.get(2)).toBe('Groceries · ID 2');
  });
  it('terminates for malformed cycles and missing parents', () => {
    const labels = buildCategoryLabels([{ id: 1, name: 'A', parentId: 2 }, { id: 2, name: 'B', parentId: 1 }, { id: 3, name: 'C', parentId: 99 }]);
    expect(labels.get(1)).toBe('B / A');
    expect(labels.get(2)).toBe('A / B');
    expect(labels.get(3)).toBe('C');
  });
});
