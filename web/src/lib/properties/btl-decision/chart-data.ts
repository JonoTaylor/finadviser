import Decimal from 'decimal.js';
import type { ComparisonCell, ScenarioKey } from './scenarios';
import type { MortgageProduct, ErcTier } from './mortgage-product';

/**
 * Pure functions that translate the scenario-comparison output into
 * chart-ready data. Kept separate from the React layer so they can be
 * unit-tested without rendering and re-used by export / print views.
 */

export interface StackedCostSeries {
  scenarioKey: ScenarioKey;
  scenarioLabel: string;
  productName: string;
  mortgageInterestEx: number;
  erc: number;
  voidCost: number;
  epc: number;
  netRentalCredit: number;
  total: number;
}

/**
 * Per-scenario stacked-cost series, picking the LEADING (lowest-carry)
 * product for each scenario. The Cost Breakdown chart in the brief
 * compares apples-to-apples across scenarios rather than mixing every
 * combination, so we pre-select winners here.
 */
export function buildStackedCostSeries(cells: ComparisonCell[]): StackedCostSeries[] {
  const byScenario = new Map<ScenarioKey, ComparisonCell[]>();
  for (const cell of cells) {
    const list = byScenario.get(cell.scenarioKey) ?? [];
    list.push(cell);
    byScenario.set(cell.scenarioKey, list);
  }
  const out: StackedCostSeries[] = [];
  for (const [key, list] of byScenario) {
    const leader = list.reduce((best, current) =>
      current.result.totalCarryCost.lt(best.result.totalCarryCost) ? current : best,
    );
    const r = leader.result;
    out.push({
      scenarioKey: key,
      scenarioLabel: leader.scenarioLabel,
      productName: leader.productName,
      // mortgageInterestEx = mortgageCost minus erc (which we stack separately).
      mortgageInterestEx: r.mortgageCost.minus(r.ercCost).toNumber(),
      erc: r.ercCost.toNumber(),
      voidCost: r.voidCost.toNumber(),
      epc: r.epcCost.toNumber(),
      // netRental is a CREDIT against carry cost; chart it as negative so
      // the stack reads as cost in / rental out.
      netRentalCredit: r.netRentalAfterTax.negated().toNumber(),
      total: r.totalCarryCost.toNumber(),
    });
  }
  // Order: cost-ascending by total carry, so the best scenario is leftmost.
  return out.sort((a, b) => a.total - b.total);
}

export interface BreakEvenSeriesPoint {
  monthsHeld: number;
  cumulativeCost: number;
}

export interface BreakEvenSeries {
  productId: string;
  productName: string;
  points: BreakEvenSeriesPoint[];
  /** Month at which the ERC tier steps down OR expires entirely. */
  ercStepMonths: number[];
}

/**
 * Cumulative cost curve per product across a holding period of
 * `maxMonths` months, used by the Break-Even line chart. The curve is
 * sampled monthly and reflects the headline-rate monthly payment plus
 * cumulative ERC IF redemption happened at THIS month. Useful for
 * spotting when extending the hold tips above the ERC saving.
 */
export function buildBreakEvenSeries(
  products: MortgageProduct[],
  balanceAtRedemption: Decimal,
  maxMonths: number,
): BreakEvenSeries[] {
  return products.map(product => {
    const monthly = new Decimal(product.monthlyPayment || '0');
    const fee = new Decimal(product.productFee || '0');
    const exit = new Decimal(product.exitFee || '0');
    const points: BreakEvenSeriesPoint[] = [];
    for (let m = 0; m <= maxMonths; m++) {
      const erc = ercAt(m, balanceAtRedemption, product.ercSchedule);
      const total = monthly.mul(m).plus(fee).plus(exit).plus(erc);
      points.push({ monthsHeld: m, cumulativeCost: total.toNumber() });
    }
    return {
      productId: product.id,
      productName: product.name,
      points,
      ercStepMonths: deriveErcStepMonths(product.ercSchedule),
    };
  });
}

function ercAt(monthsHeld: number, balance: Decimal, schedule: ErcTier[]): Decimal {
  if (monthsHeld < 0) return new Decimal(0);
  for (const tier of schedule) {
    if (monthsHeld <= tier.untilMonth) return balance.mul(tier.pct).div(100);
  }
  return new Decimal(0);
}

function deriveErcStepMonths(schedule: ErcTier[]): number[] {
  // Mark the END of each tier (i.e. the step-down month) plus the
  // expiry of the last tier so the chart can drop vertical markers.
  return schedule.map(t => t.untilMonth);
}

export interface DecisionMatrixCell {
  timingConfidence: 'low' | 'medium' | 'high';
  tenantCooperation: 'low' | 'medium' | 'high';
  recommendedProductId: string | null;
  recommendedProductName: string;
  reason: string;
}

/**
 * 3x3 matrix recommending a product for each (timing confidence,
 * tenant cooperation) cell. The rule is deterministic:
 *   - LOW timing confidence → pick the no-ERC / lowest-ERC product
 *     regardless of headline rate (optionality wins).
 *   - HIGH timing confidence + HIGH cooperation → pick the lowest
 *     monthly payment (discount/tracker) since ERC won't bite.
 *   - Otherwise → pick the product with the lowest TOTAL carry under
 *     the ride_out scenario.
 */
export function buildDecisionMatrix(params: {
  products: MortgageProduct[];
  cells: ComparisonCell[];
}): DecisionMatrixCell[] {
  const { products, cells } = params;
  const confidences: Array<'low' | 'medium' | 'high'> = ['low', 'medium', 'high'];
  const out: DecisionMatrixCell[] = [];

  // Lowest ERC product: prefer empty schedule, else lowest Y1 pct.
  const noErc = products.find(p => p.ercSchedule.length === 0);
  const lowestErc = noErc ?? products
    .slice()
    .sort((a, b) => {
      const aPct = new Decimal(a.ercSchedule[0]?.pct ?? '0').toNumber();
      const bPct = new Decimal(b.ercSchedule[0]?.pct ?? '0').toNumber();
      return aPct - bPct;
    })[0];

  // Lowest monthly payment.
  const cheapestMonthly = products.slice().sort((a, b) =>
    new Decimal(a.monthlyPayment || '0').minus(new Decimal(b.monthlyPayment || '0')).toNumber(),
  )[0];

  // Lowest ride_out total carry.
  const rideOutCells = cells.filter(c => c.scenarioKey === 'ride_out');
  const rideOutLeader = rideOutCells.length > 0
    ? rideOutCells.reduce((best, c) =>
        c.result.totalCarryCost.lt(best.result.totalCarryCost) ? c : best,
      )
    : null;
  const rideOutLeaderProduct = rideOutLeader
    ? products.find(p => p.id === rideOutLeader.productId)
    : null;

  for (const timing of confidences) {
    for (const coop of confidences) {
      let pick: MortgageProduct | null = null;
      let reason = '';
      if (timing === 'low') {
        pick = lowestErc ?? null;
        reason = 'Timing uncertain — minimise ERC tie-in.';
      } else if (timing === 'high' && coop === 'high') {
        pick = cheapestMonthly ?? null;
        reason = 'Clear runway — lowest monthly payment wins.';
      } else {
        pick = rideOutLeaderProduct ?? lowestErc ?? null;
        reason = 'Balanced — lowest total carry under ride-out.';
      }
      out.push({
        timingConfidence: timing,
        tenantCooperation: coop,
        recommendedProductId: pick?.id ?? null,
        recommendedProductName: pick?.name ?? '—',
        reason,
      });
    }
  }
  return out;
}

export interface KeyInsight {
  scenarioKey: ScenarioKey;
  message: string;
}

/**
 * Auto-generate a one-sentence "why does this scenario win or lose"
 * for each scenario, computed by comparing the leading product's
 * dominant cost driver vs the next-best scenario.
 */
export function buildKeyInsights(cells: ComparisonCell[]): KeyInsight[] {
  const byScenario = new Map<ScenarioKey, ComparisonCell[]>();
  for (const cell of cells) {
    const list = byScenario.get(cell.scenarioKey) ?? [];
    list.push(cell);
    byScenario.set(cell.scenarioKey, list);
  }
  const leaders: Array<{ key: ScenarioKey; leader: ComparisonCell }> = [];
  for (const [key, list] of byScenario) {
    const leader = list.reduce((best, c) =>
      c.result.totalCarryCost.lt(best.result.totalCarryCost) ? c : best,
    );
    leaders.push({ key, leader });
  }
  leaders.sort((a, b) =>
    a.leader.result.totalCarryCost.minus(b.leader.result.totalCarryCost).toNumber(),
  );

  const out: KeyInsight[] = [];
  for (let i = 0; i < leaders.length; i++) {
    const { key, leader } = leaders[i];
    const next = leaders[i + 1];
    const r = leader.result;
    const driverLabel = dominantCostDriver(r);
    if (i === 0 && next) {
      const delta = next.leader.result.totalCarryCost.minus(r.totalCarryCost);
      out.push({
        scenarioKey: key,
        message: `Wins by £${delta.toFixed(0)} thanks to lower ${driverLabel}.`,
      });
    } else if (i === leaders.length - 1) {
      out.push({
        scenarioKey: key,
        message: `Most expensive overall — dominated by ${driverLabel}.`,
      });
    } else {
      out.push({
        scenarioKey: key,
        message: `Middle of the pack — driven mostly by ${driverLabel}.`,
      });
    }
  }
  return out;
}

function dominantCostDriver(result: ComparisonCell['result']): string {
  const candidates: Array<{ label: string; amount: Decimal }> = [
    { label: 'mortgage interest', amount: result.mortgageCost.minus(result.ercCost) },
    { label: 'ERC', amount: result.ercCost },
    { label: 'void cost', amount: result.voidCost },
    { label: 'EPC remediation', amount: result.epcCost },
  ];
  candidates.sort((a, b) => b.amount.minus(a.amount).toNumber());
  return candidates[0].label;
}
