import { describe, expect, it } from 'vitest';
import { propertyExpenseCategoryIds } from './CategoryEditDialog';

describe('property expense categories in the category dialog', () => {
  it('includes the top-level "Property expenses" category and everything below it, at any depth', () => {
    const ids = propertyExpenseCategoryIds([
      { id: 5, name: 'Boiler', parentId: 2 },
      { id: 1, name: 'Property expenses', parentId: null },
      { id: 2, name: 'Repairs & maintenance', parentId: 1 },
      { id: 3, name: 'Groceries', parentId: null },
      { id: 4, name: 'Property expenses', parentId: 3 },
      { id: 6, name: 'Under the impostor', parentId: 4 },
    ]);
    expect([...ids].sort()).toEqual([1, 2, 5]);
  });

  it('is empty when the seeded parent category is missing', () => {
    expect(propertyExpenseCategoryIds([{ id: 2, name: 'Repairs & maintenance', parentId: 1 }]).size).toBe(0);
  });
});
