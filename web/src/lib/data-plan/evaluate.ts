import { planChanges } from './planner';
import type { Plan } from './schema';
import { simulateChanges } from './simulate';
import { computeOwnerTotals } from './totals';
import type { DbState, OwnerTotals, PlanResult } from './types';

/** One plan against one database state: what would change, and the owner's totals before and after. */
export interface Evaluation {
  state: DbState;
  result: PlanResult;
  before: OwnerTotals | null;
  after: OwnerTotals | null;
}

/**
 * Pure: plan + state in, evaluation out. `before`/`after` are null when the
 * plan was refused (owner or property missing, ...), because the totals need
 * the owner and their properties to exist.
 */
export function evaluatePlan(plan: Plan, state: DbState): Evaluation {
  const result = planChanges(plan, state);
  if (result.refusals.length > 0) return { state, result, before: null, after: null };
  const owner = state.owners.find(o => o.name === plan.owner)!;
  const before = computeOwnerTotals({ ownerId: owner.id, taxYear: plan.taxYear, state });
  const after = computeOwnerTotals({ ownerId: owner.id, taxYear: plan.taxYear, state: simulateChanges(state, result.changes) });
  return { state, result, before, after };
}
