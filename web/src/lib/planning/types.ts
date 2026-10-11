import type { RetirementInput } from '@/lib/retirement/projection';

/** GBP amounts. Inputs are validated and calculations use decimal arithmetic. */
export interface PlanningTransaction {
  id: number | string;
  date: string;
  description: string;
  merchant?: string | null;
  category: string;
  categoryId?: number | null;
  /** Category ancestry supports budgets set on a parent category. */
  categoryAncestorIds?: number[];
  /** Money received is positive; money paid is negative. */
  amount: number;
  isTransfer?: boolean;
  propertyId?: number | null;
  /** Explicit ledger classification prevents refunds being counted as income. */
  cashflowType?: 'income' | 'expense' | 'refund';
}

export interface PlanningAccount {
  id: number;
  name: string;
  /** Signed ledger balance: assets normally positive, liabilities normally negative. */
  balance: number;
  accountType: 'ASSET' | 'LIABILITY' | 'EQUITY' | 'INCOME' | 'EXPENSE';
  isInvestment?: boolean;
  investmentKind?: string | null;
  ownerId?: number | null;
  /** Bank/cash/savings classification; input.cashAccessibility discloses inference. */
  isLiquidCash?: boolean;
}

export interface PlanningProperty {
  id: number;
  name: string;
  value: number | null;
  debt: number;
  /** Monthly rent/cost inputs are estimates, not promises of cashflow. */
  monthlyRent: number | null;
  monthlyCosts: number | null;
}

export interface PlanningBudget {
  category: string;
  categoryId?: number;
  monthlyLimit: number;
}

export interface PlanningProfile {
  retirementScenario?: RetirementInput | null;
  essentialMonthlySpending?: number | null;
  emergencyFundMonths?: number | null;
  monthlySavingsTarget?: number | null;
  investmentHorizonYears?: number | null;
  riskTolerance?: 'low' | 'medium' | 'high' | null;
  currentAge?: number | null;
  retirementAge?: number | null;
  monthlyPensionContribution?: number | null;
  targetRetirementIncome?: number | null;
  statePensionAnnual?: number | null;
}

export interface PlanningInput {
  /** ISO calendar date; the current month is excluded from trend calculations. */
  asOf: string;
  /** Defaults to confirmed for callers explicitly classifying account liquidity. */
  cashAccessibility?: 'inferred' | 'confirmed';
  transactions: PlanningTransaction[];
  /** Exclude property assets/mortgages represented by properties to avoid double counting. */
  accounts: PlanningAccount[];
  properties: PlanningProperty[];
  budgets: PlanningBudget[];
  profile?: PlanningProfile | null;
}

export interface PlanningPeriod {
  start: string;
  end: string;
  months: string[];
}

export interface PlanningCoverage {
  status: 'empty' | 'limited' | 'represented';
  recentMonthsWithData: number;
  previousMonthsWithData: number;
  recentTransactionCount: number;
  previousTransactionCount: number;
  excludedTransfers: number;
  ignoredFutureTransactions: number;
  firstTransactionDate: string | null;
  lastTransactionDate: string | null;
  missingRecentMonths: string[];
  warnings: string[];
}

export interface CashflowTotals {
  income: number;
  spending: number;
  net: number;
  personalSpending: number;
  propertySpending: number;
  transactionCount: number;
}

export interface MonthlyCashflow {
  month: string;
  totals: CashflowTotals | null;
}

export interface CashflowSummary {
  recentPeriod: PlanningPeriod;
  previousPeriod: PlanningPeriod;
  recent: CashflowTotals | null;
  previous: CashflowTotals | null;
  /** Only supplied when each month in the period has observed activity. */
  monthlyIncome: number | null;
  monthlySpending: number | null;
  monthlyPersonalSpending: number | null;
  monthlyPropertySpending: number | null;
  monthlySurplus: number | null;
  savingsRate: number | null;
  monthlySpendingChange: number | null;
  monthlySpendingChangePercent: number | null;
  months: MonthlyCashflow[];
}

export interface SpendingComparison {
  name: string;
  categoryId?: number | null;
  recentTotal: number;
  previousTotal: number | null;
  monthlyAverage: number | null;
  previousMonthlyAverage: number | null;
  monthlyChange: number | null;
  changePercent: number | null;
  transactionCount: number;
  sharePercent: number | null;
  personalTotal: number;
  propertyTotal: number;
}

export interface RecurringCandidate {
  merchant: string;
  category: string;
  cadence: 'monthly';
  confidence: 'medium' | 'high';
  typicalPayment: number;
  observedTotal: number;
  paymentCount: number;
  dates: string[];
  amountRange: { min: number; max: number };
  evidence: string;
  /** Candidate only: merchant frequency cannot establish a cancellable subscription. */
  needsConfirmation: true;
}

export interface PlanningBalanceSheet {
  cash: number | null;
  investments: number | null;
  pensions: number | null;
  propertyValue: number | null;
  propertyDebt: number | null;
  propertyEquity: number | null;
  otherDebt: number | null;
  totalDebt: number | null;
  /** Sum of known recorded values only; missing valuations are disclosed below. */
  netWorth: number | null;
  knownAssets: number | null;
  propertySharePercent: number | null;
  missingPropertyValuations: number;
  unclassifiedAssets: number;
}

export interface EmergencyFundSummary {
  cashAccessibility: 'inferred' | 'confirmed';
  /** True when cash classification comes from account-name/tag heuristics. */
  isEstimate: boolean;
  cashAvailable: number | null;
  essentialMonthlySpending: number | null;
  targetMonths: number;
  targetAmount: number | null;
  coverageMonths: number | null;
  shortfall: number | null;
  status: 'unknown' | 'below-target' | 'on-target';
  basis: string;
}

export interface PropertyPlan {
  id: number;
  name: string;
  value: number | null;
  debt: number;
  equity: number | null;
  loanToValuePercent: number | null;
  monthlyRent: number | null;
  monthlyCosts: number | null;
  monthlyOperatingSurplus: number | null;
  grossYieldPercent: number | null;
  /** A simple three-month cash reserve on entered costs, not a full stress test. */
  threeMonthCostReserve: number | null;
  observedIncome: number | null;
  observedSpending: number | null;
  warnings: string[];
  href: string;
}

export interface BudgetProgress {
  category: string;
  categoryId?: number;
  monthlyLimit: number;
  observedMonthlySpending: number | null;
  remaining: number | null;
  utilisationPercent: number | null;
  status: 'unknown' | 'within-budget' | 'over-budget';
}

export interface PlanningReference {
  label: string;
  url: string;
}

export interface PlanningAction {
  id: string;
  priority: 'high' | 'medium' | 'low';
  topic: 'data' | 'debt' | 'emergency' | 'spending' | 'investing' | 'property' | 'retirement';
  title: string;
  detail: string;
  evidence: string;
  href: string;
  actionLabel: string;
  references: PlanningReference[];
  /** Recorded budget gap or observed spending to review, never a promised saving. */
  amount: number | null;
}

export interface RetirementSummary {
  /** Whole recorded household, potentially including multiple owners. */
  pensionValue: number | null;
  /** User-entered personal scenario pot; never inferred from household balances. */
  scenarioPot: number | null;
  projectionScope: 'personal-scenario' | 'unavailable';
  currentAge: number | null;
  retirementAge: number | null;
  yearsToRetirement: number | null;
  monthlyContribution: number | null;
  targetAnnualIncome: number | null;
  statePensionAnnual: number | null;
  /** Saved personal scenario pot plus its entered contributions; no return assumed. */
  contributionsOnlyAtRetirement: number | null;
  basis: string;
}

export interface FinancialPlan {
  asOf: string;
  currency: 'GBP';
  coverage: PlanningCoverage;
  cashflow: CashflowSummary;
  spending: { categories: SpendingComparison[]; merchants: SpendingComparison[] };
  recurring: RecurringCandidate[];
  balanceSheet: PlanningBalanceSheet;
  emergencyFund: EmergencyFundSummary;
  properties: PropertyPlan[];
  budgets: BudgetProgress[];
  retirement: RetirementSummary;
  actions: PlanningAction[];
  methodology: string[];
}
