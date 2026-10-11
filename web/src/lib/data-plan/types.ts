import type { LettingType } from '@/lib/db/schema';
import type { PlanRentFrequency, TaxProfileField } from './schema';

/**
 * Plain-data shapes shared by the planner, the totals calculation and the
 * SQL layer. Money is always a decimal string; dates are YYYY-MM-DD text
 * (the schema stores them as TEXT).
 */

export type AccountType = 'ASSET' | 'LIABILITY' | 'EQUITY' | 'INCOME' | 'EXPENSE';

export interface OwnerRow {
  id: number;
  name: string;
}

export interface PropertyRow {
  id: number;
  name: string;
  lettingType: LettingType;
}

export interface OwnershipRow {
  propertyId: number;
  ownerId: number;
  ownerName: string;
  capitalAccount: string;
}

export interface AllocationRuleRow {
  propertyId: number;
  ownerId: number;
  allocationPct: string;
  expenseType: string;
}

export interface TenancyRow {
  id: number;
  propertyId: number;
  tenantName: string;
  startDate: string;
  endDate: string | null;
  rentAmount: string;
  rentFrequency: PlanRentFrequency;
  depositAmount: string | null;
  notes: string | null;
}

export interface MortgageRow {
  id: number;
  propertyId: number;
  lender: string;
  interestOnly: boolean;
}

export interface AccountRow {
  id: number;
  name: string;
  accountType: AccountType;
  isSystem: boolean;
  ownerId: number | null;
}

export interface CategoryRow {
  id: number;
  name: string;
  parentId: number | null;
}

/**
 * One book entry on an INCOME or EXPENSE account, joined to its journal.
 * This is exactly the row shape rental-report.repo.ts reads, so the same
 * arithmetic can be run over it.
 */
export interface LedgerLine {
  bookEntryId: number;
  journalId: number;
  date: string;
  description: string;
  reference: string | null;
  categoryId: number | null;
  propertyId: number | null;
  isTransfer: boolean;
  accountId: number;
  accountName: string;
  accountType: 'INCOME' | 'EXPENSE';
  accountIsSystem: boolean;
  /** Signed ledger amount (debit positive, credit negative). */
  amount: string;
}

/** A journal that already carries a `plan:<planId>:%` reference. */
export interface ReferencedJournal {
  journalId: number;
  reference: string;
  date: string;
  description: string;
  propertyId: number | null;
  /** Signed amount of its INCOME/EXPENSE leg(s), summed; null when it has none. */
  amount: string | null;
  accountName: string | null;
}

export interface TaxProfileRow {
  ownerId: number;
  taxYear: string;
  values: Record<TaxProfileField, string>;
  notes: string | null;
}

/** Everything the planner needs from the database, read in one pass. */
export interface DbState {
  owners: OwnerRow[];
  properties: PropertyRow[];
  ownership: OwnershipRow[];
  allocationRules: AllocationRuleRow[];
  tenancies: TenancyRow[];
  mortgages: MortgageRow[];
  accounts: AccountRow[];
  categories: CategoryRow[];
  /** INCOME/EXPENSE lines on journals tagged to a property of interest. */
  taggedLines: LedgerLine[];
  /** INCOME/EXPENSE lines with a plan-relevant amount on untagged / other-property journals. */
  candidateLines: LedgerLine[];
  referencedJournals: ReferencedJournal[];
  taxProfile: TaxProfileRow | null;
}

export type JournalKind = 'income' | 'expense' | 'mortgage_interest';

export interface Leg {
  accountId: number;
  accountName: string;
  /** Signed amount, debit positive. */
  amount: string;
}

export interface TenancyValues {
  tenantName: string;
  startDate: string;
  endDate: string | null;
  rentAmount: string;
  rentFrequency: PlanRentFrequency;
  depositAmount: string | null;
  notes: string | null;
}

export type TenancyUpdatable = Exclude<keyof TenancyValues, 'startDate'>;

export interface FieldDiff {
  field: TenancyUpdatable;
  current: string | null;
  planned: string | null;
  /** True when the plan marks this field `update: true` (so it WILL be written). */
  willUpdate: boolean;
}

export type Change =
  | {
      type: 'letting_type';
      itemId: string;
      propertyId: number;
      propertyName: string;
      from: LettingType;
      to: LettingType;
    }
  | {
      type: 'tenancy_create';
      itemId: string;
      propertyId: number;
      propertyName: string;
      values: TenancyValues;
    }
  | {
      type: 'tenancy_update';
      itemId: string;
      propertyId: number;
      propertyName: string;
      tenancyId: number;
      startDate: string;
      /** Only the fields marked update:true that actually differ. */
      set: Partial<Omit<TenancyValues, 'startDate'>>;
      /** Every difference found, including ones the plan does not allow updating. */
      diffs: FieldDiff[];
    }
  | {
      type: 'journal_create';
      itemId: string;
      kind: JournalKind;
      propertyId: number;
      propertyName: string;
      date: string;
      description: string;
      reference: string;
      categoryId: number | null;
      categoryName: string | null;
      amount: string;
      legs: Leg[];
    }
  | {
      type: 'journal_tag';
      itemId: string;
      kind: JournalKind;
      propertyId: number;
      propertyName: string;
      journalId: number;
      date: string;
      description: string;
      accountName: string;
      amount: string;
      /** Set only if the journal currently has no category. */
      setCategoryId: number | null;
      setCategoryName: string | null;
    }
  | {
      type: 'tax_profile';
      itemIds: string[];
      ownerId: number;
      ownerName: string;
      taxYear: string;
      existed: boolean;
      set: Partial<Record<TaxProfileField, string>>;
      /** Previous values of the fields in `set` (null when the row did not exist). */
      previous: Partial<Record<TaxProfileField, string>> | null;
      /** Full notes text to write, when the plan contributes a notes block. */
      notes: string | null;
      previousNotes: string | null;
    };

export type SkipReason =
  | 'excluded'
  | 'already_loaded'
  | 'duplicate_tagged'
  | 'duplicate_untagged'
  | 'alternate_amount'
  | 'different_amount'
  | 'unchanged'
  | 'no_updates_allowed';

export interface Skip {
  itemId: string;
  label: string;
  reason: SkipReason;
  detail: string;
}

export interface Blocked {
  itemId: string;
  label: string;
  reason: string;
}

export interface PlanResult {
  /** Preconditions that stop the whole run (owner / property missing, ...). */
  refusals: string[];
  changes: Change[];
  skips: Skip[];
  blocked: Blocked[];
  warnings: string[];
}

export interface Totals {
  grossIncome: string;
  totalExpenses: string;
  mortgageInterest: string;
  netBeforeMortgageRelief: string;
}

export interface PropertyTotals extends Totals {
  propertyId: number;
  propertyName: string;
  allocationPct: string;
  /** Split of grossIncome, for the diff display. */
  scheduledRent: string;
  otherIncome: string;
  scheduledRentLines: number;
}

export interface OwnerTotals {
  ownerId: number;
  ownerName: string;
  taxYear: string;
  startDate: string;
  endDate: string;
  properties: PropertyTotals[];
  combined: Totals;
}
