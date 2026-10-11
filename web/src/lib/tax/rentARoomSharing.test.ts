import { describe, it, expect } from 'vitest';
import { otherOwnersReceiveIncome } from './rentARoomSharing';

describe('otherOwnersReceiveIncome', () => {
  it('is true for a couple with an explicit split (65.08 / 34.92)', () => {
    expect(
      otherOwnersReceiveIncome({
        ownerId: 1,
        ownerIds: [1, 2],
        allocations: [
          { ownerId: 1, allocationPct: '65.0800' },
          { ownerId: 2, allocationPct: '34.9200' },
        ],
      }),
    ).toBe(true);
  });

  it('is true for co-owners with no rules (equal split)', () => {
    expect(otherOwnersReceiveIncome({ ownerId: 1, ownerIds: [1, 2], allocations: [] })).toBe(true);
  });

  it('is false for a sole owner', () => {
    expect(otherOwnersReceiveIncome({ ownerId: 1, ownerIds: [1], allocations: [] })).toBe(false);
  });

  it('is false when the other owner is allocated 0%', () => {
    expect(
      otherOwnersReceiveIncome({
        ownerId: 1,
        ownerIds: [1, 2],
        allocations: [
          { ownerId: 1, allocationPct: '100' },
          { ownerId: 2, allocationPct: '0' },
        ],
      }),
    ).toBe(false);
  });
});
