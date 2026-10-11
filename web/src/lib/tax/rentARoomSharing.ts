import Decimal from 'decimal.js';

/**
 * Does anyone besides `ownerId` also receive income from this property?
 * Rent-a-room halves its limit (£7,500 to £3,750) when they do.
 *
 * Mirrors the allocation fallback in rental-report's resolveAllocationPct:
 * an owner with no explicit 'all' rule gets an equal share, so a co-owner
 * with no rule counts as a recipient. A co-owner whose rule is 0% does not.
 */
export function otherOwnersReceiveIncome(params: {
  ownerId: number;
  /** Every owner of the property. */
  ownerIds: number[];
  /** The property's 'all' allocation rules, by owner. */
  allocations: Array<{ ownerId: number; allocationPct: Decimal.Value }>;
}): boolean {
  const { ownerId, ownerIds, allocations } = params;
  const equalShare = ownerIds.length > 0 ? new Decimal(100).div(ownerIds.length) : new Decimal(0);
  return ownerIds
    .filter(id => id !== ownerId)
    .some(id => {
      const rule = allocations.find(a => a.ownerId === id);
      const share = rule ? new Decimal(rule.allocationPct) : equalShare;
      return share.gt(0);
    });
}
