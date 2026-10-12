import type { FinancialContext, ContextLookup } from '@/lib/finance-context/schema';
import type { PlanningProfile } from '@/lib/planning/types';
import type { DebtRecord } from '@/lib/debts/types';
import type { PortfolioData } from '@/lib/portfolio/schema';
import type { PensionRecord } from '@/lib/pension-records/schema';
import type { PropertyOperationsData } from '@/lib/property-operations/types';

export type DataDomain = 'transactions' | 'context' | 'planning' | 'debts' | 'portfolio' | 'pensions' | 'properties';
export type DataAvailability<T> = { status: 'ready'; data: T } | { status: 'unavailable' };
export interface LedgerCoverage {
  totalCount: number;
  uncategorisedCount: number;
  /** Pending category decisions. Null means that this queue could not be read. */
  reviewNeededCount: number | null;
  eligibleCount: number | null;
  unprocessedCount: number | null;
  transferReviewCount: number;
  latestDate: string | null;
  /** Only completed months containing a non-transfer income/expense posting. */
  recentMonths: string[];
}
export interface PropertyCoverageRecord {
  id: number;
  name: string;
  valuationDate: string | null;
  activeTenancyCount: number;
  ownershipCount: number;
}
export interface DataIntelligenceInput {
  asOf: string;
  ledger: DataAvailability<LedgerCoverage>;
  context: DataAvailability<{ data: FinancialContext; saved: boolean; lookup: ContextLookup }>;
  planning: DataAvailability<{ profile: PlanningProfile; saved: boolean }>;
  debts: DataAvailability<{ records: DebtRecord[]; lookup: ContextLookup }>;
  portfolio: DataAvailability<{ data: PortfolioData; lookup: ContextLookup }>;
  pensions: DataAvailability<{ records: PensionRecord[]; lookup: ContextLookup }>;
  properties: DataAvailability<{ records: PropertyCoverageRecord[]; data: PropertyOperationsData }>;
}
export interface DataCoverage {
  domain: DataDomain;
  label: string;
  source: string;
  status: 'empty' | 'incomplete' | 'stale' | 'recorded' | 'unavailable';
  recordCount: number | null;
  evidence: string[];
}
export interface DataGap {
  id: string;
  domain: DataDomain;
  source: string;
  priority: 'high' | 'medium' | 'low';
  status: 'missing' | 'incomplete' | 'stale' | 'unavailable';
  title: string;
  reason: string;
  evidence: string[];
  affectedCount: number | null;
  action: { label: string; href: string; kind: 'upload' | 'review' | 'confirm' };
}
export interface DataIntelligenceReport {
  version: 1;
  asOf: string;
  scope: 'household';
  status: 'ready' | 'partial' | 'unavailable';
  coverage: DataCoverage[];
  transactions: {
    status: 'ready' | 'unavailable';
    totalCount: number | null;
    uncategorisedCount: number | null;
    reviewNeededCount: number | null;
    eligibleCount: number | null;
    unprocessedCount: number | null;
    transferReviewCount: number | null;
    latestDate: string | null;
    recentMonths: string[];
    missingRecentMonths: string[];
  };
  processing: { modelAvailable: boolean; reviewUrl: '/data' };
  gaps: DataGap[];
  warnings: string[];
}
