import { z } from 'zod';
import { londonTodayIso } from '@/lib/dates/today';
import { FINANCIAL_CONTEXT_KEY, loadFinancialContext } from '@/lib/finance-context';
import { contextSchema } from '@/lib/finance-context/schema';
import { readWorkspace, WorkspaceStoredDataError, type WorkspaceEnvelope } from '@/lib/finance-workspace/store';
import { DEBT_WORKSPACE_KEY } from '@/lib/debts/load';
import { debtWorkspaceSchema } from '@/lib/debts/types';
import { PORTFOLIO_KEY, portfolioDataSchema, INITIAL_PORTFOLIO } from '@/lib/portfolio/schema';
import { PENSION_RECORDS_KEY, pensionRecordsDataSchema } from '@/lib/pension-records/schema';
import { PROPERTY_OPERATIONS_KEY, propertyOperationsSchema, initialPropertyOperations } from '@/lib/property-operations/types';
import { InvalidPlanningProfileError, loadPlanningProfile, planningProfileSchema, PLANNING_PROFILE_KEY } from '@/lib/planning/load';
import { accountRepo } from '@/lib/repos/account.repo';
import { propertyRepo } from '@/lib/repos/property.repo';
import { savingsGoalRepo } from '@/lib/repos/savings-goal.repo';
import { REVIEWS_KEY, reviewsDataSchema, initialReviews } from './schema';

export interface ExportUnavailableSection {
  status: 'unavailable';
  code: 'WORKSPACE_INVALID' | 'UNAVAILABLE';
  message: string;
}

export type ExportSection<T> = { status: 'available'; data: T } | ExportUnavailableSection;
export type ExportWorkspace<T> = { status: 'available'; key: string; workspace: WorkspaceEnvelope<T> } | ExportUnavailableSection;

export class FinanceExportUnavailableError extends Error {
  constructor(readonly section: 'context' | 'planningProfile', readonly code: 'ESSENTIAL_SECTION_INVALID' | 'ESSENTIAL_SECTION_UNAVAILABLE') {
    super('Your saved financial context or planning profile is unavailable. Check those workspaces and the database connection before exporting.');
    this.name = 'FinanceExportUnavailableError';
  }
}

function unavailable(error: unknown): ExportUnavailableSection {
  if (error instanceof WorkspaceStoredDataError || error instanceof z.ZodError) {
    return { status: 'unavailable', code: 'WORKSPACE_INVALID', message: 'Saved data could not be validated and has been omitted. No replacement data has been exported.' };
  }
  // Database errors can contain connection strings or SQL. Never export their text.
  return { status: 'unavailable', code: 'UNAVAILABLE', message: 'This section could not be read and has been omitted. Retry when it is available.' };
}

function workspaceExport<T>(key: string, workspace: WorkspaceEnvelope<T>): { status: 'available'; key: string; workspace: WorkspaceEnvelope<T> } {
  return { status: 'available', key, workspace: {
    version: workspace.version, revision: workspace.revision, updatedAt: workspace.updatedAt, data: workspace.data,
  } };
}

async function optionalWorkspace<T>(key: string, schema: z.ZodType<T>, initial: T): Promise<ExportWorkspace<T>> {
  try {
    return workspaceExport(key, await readWorkspace(key, schema, initial));
  } catch (error) {
    return unavailable(error);
  }
}

async function optionalSection<T>(load: () => Promise<T>): Promise<ExportSection<T>> {
  try {
    return { status: 'available', data: await load() };
  } catch (error) {
    return unavailable(error);
  }
}

async function essentialContext() {
  try {
    const workspace = await loadFinancialContext();
    return workspaceExport(FINANCIAL_CONTEXT_KEY, { ...workspace, data: contextSchema.parse(workspace.data) });
  } catch (error) {
    throw new FinanceExportUnavailableError('context', error instanceof WorkspaceStoredDataError || error instanceof z.ZodError ? 'ESSENTIAL_SECTION_INVALID' : 'ESSENTIAL_SECTION_UNAVAILABLE');
  }
}

async function essentialProfile() {
  try {
    const { profile, saved } = await loadPlanningProfile();
    return { status: 'available' as const, key: PLANNING_PROFILE_KEY, profile: planningProfileSchema.parse(profile), saved };
  } catch (error) {
    throw new FinanceExportUnavailableError('planningProfile', error instanceof InvalidPlanningProfileError || error instanceof z.ZodError ? 'ESSENTIAL_SECTION_INVALID' : 'ESSENTIAL_SECTION_UNAVAILABLE');
  }
}

function isoTimestamp(value: Date): string {
  return value.toISOString();
}

/**
 * A scoped planning export, not a backup or a restore format. Read only the
 * named workspaces and public planning references; never enumerate settings.
 * Unknown values and unsaved revision-zero workspaces remain distinguishable.
 */
export async function loadFinancePlanningExport(now = new Date()) {
  const [context, planningProfile, debts, portfolio, pensionRecords, propertyOperations, reviews, savingsGoals, references] = await Promise.all([
    essentialContext(),
    essentialProfile(),
    optionalWorkspace(DEBT_WORKSPACE_KEY, debtWorkspaceSchema, { debts: [] }),
    optionalWorkspace(PORTFOLIO_KEY, portfolioDataSchema, INITIAL_PORTFOLIO),
    optionalWorkspace(PENSION_RECORDS_KEY, pensionRecordsDataSchema, []),
    optionalWorkspace(PROPERTY_OPERATIONS_KEY, propertyOperationsSchema, initialPropertyOperations),
    optionalWorkspace(REVIEWS_KEY, reviewsDataSchema, initialReviews),
    optionalSection(async () => (await savingsGoalRepo.getAll()).map(goal => ({
      id: goal.id, name: goal.name, targetAmount: goal.targetAmount, currentAmount: goal.currentAmount,
      targetDate: goal.targetDate, accountId: goal.accountId, status: goal.status,
      createdAt: isoTimestamp(goal.createdAt), updatedAt: isoTimestamp(goal.updatedAt),
    }))),
    optionalSection(async () => {
      const [accounts, owners] = await Promise.all([accountRepo.listAll(), propertyRepo.listOwners()]);
      return {
        accounts: accounts.map(account => ({ id: account.id, name: account.name, accountType: account.accountType, ownerId: account.ownerId })),
        owners: owners.map(owner => ({ id: owner.id, name: owner.name })),
      };
    }),
  ]);

  return {
    schemaVersion: 1 as const,
    exportKind: 'finance-planning' as const,
    exportedAt: now.toISOString(),
    asOf: londonTodayIso(now),
    scope: 'household' as const,
    currency: 'GBP' as const,
    completeBackup: false as const,
    availability: [debts, portfolio, pensionRecords, propertyOperations, reviews, savingsGoals, references].some(section => section.status === 'unavailable')
      ? 'some_sections_unavailable' as const : 'all_sections_available' as const,
    consistency: 'independent_reads' as const,
    limitations: 'Sections are read independently at export time. Account and owner references contain IDs and labels only. This file cannot restore the full app.',
    omitted: ['ledger_rows', 'documents', 'files', 'credentials', 'bank_connections', 'other_settings'] as const,
    workspaces: { context, debts, portfolio, pensionRecords, propertyOperations, reviews },
    planningProfile,
    savingsGoals,
    references,
  };
}

export type FinancePlanningExport = Awaited<ReturnType<typeof loadFinancePlanningExport>>;
