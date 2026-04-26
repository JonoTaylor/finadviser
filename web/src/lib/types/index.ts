export interface Account {
  id: number;
  name: string;
  accountType: string;
  parentId: number | null;
  description: string | null;
  isSystem: boolean;
  createdAt: Date;
}

export interface Category {
  id: number;
  name: string;
  parentId: number | null;
  isSystem: boolean;
  createdAt: Date;
}

export interface CategorizationRule {
  id: number;
  pattern: string;
  categoryId: number;
  matchType: string;
  priority: number;
  source: string;
  createdAt: Date;
}

export interface JournalEntry {
  id: number;
  date: string;
  description: string;
  reference: string | null;
  categoryId: number | null;
  importBatchId: number | null;
  createdAt: Date;
}

export interface BookEntry {
  id: number;
  journalEntryId: number;
  accountId: number;
  amount: string; // decimal as string
  createdAt: Date;
}

export interface ImportBatch {
  id: number;
  filename: string;
  bankConfig: string;
  accountId: number;
  rowCount: number;
  importedCount: number;
  duplicateCount: number;
  importedAt: Date;
}

export interface TransactionFingerprint {
  id: number;
  fingerprint: string;
  accountId: number;
  journalEntryId: number;
  createdAt: Date;
}

export interface Property {
  id: number;
  name: string;
  address: string | null;
  purchaseDate: string | null;
  purchasePrice: string | null;
  createdAt: Date;
}

export interface Owner {
  id: number;
  name: string;
  createdAt: Date;
}

export interface PropertyOwnership {
  id: number;
  propertyId: number;
  ownerId: number;
  capitalAccountId: number;
  createdAt: Date;
}

export interface Mortgage {
  id: number;
  propertyId: number;
  lender: string;
  originalAmount: string;
  startDate: string;
  termMonths: number;
  liabilityAccountId: number;
  createdAt: Date;
}

export interface MortgageRateHistory {
  id: number;
  mortgageId: number;
  rate: number;
  effectiveDate: string;
  createdAt: Date;
}

export interface PropertyValuation {
  id: number;
  propertyId: number;
  valuation: string;
  valuationDate: string;
  source: string;
  createdAt: Date;
}

export interface EquitySnapshot {
  id: number;
  propertyId: number;
  ownerId: number;
  snapshotDate: string;
  equityAmount: string;
  equityPercentage: number;
  createdAt: Date;
}

export interface PropertyTransfer {
  id: number;
  fromPropertyId: number;
  toPropertyId: number;
  ownerId: number;
  amount: string;
  journalEntryId: number;
  transferDate: string;
  description: string | null;
  createdAt: Date;
}

export interface ExpenseAllocationRule {
  id: number;
  propertyId: number;
  ownerId: number;
  allocationPct: number;
  expenseType: string;
  createdAt: Date;
}

export interface AIConversation {
  id: number;
  title: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface AIMessage {
  id: number;
  conversationId: number;
  role: string;
  content: string;
  createdAt: Date;
}

// Optional per-transaction extras pulled from rich exports (Monzo's
// full CSV being the motivating case). All fields nullable — every
// existing importer can ignore this object and the legacy 4-field
// shape still works.
export interface RawTransactionMetadata {
  externalId?: string | null;       // bank-issued id (e.g. tx_0000... from Monzo) — used for true dedup
  time?: string | null;             // HH:MM:SS, used alongside `date` for ordering within a day
  type?: string | null;             // e.g. "Faster payment", "Card payment", "Direct Debit"
  merchantName?: string | null;     // payee / counterparty name (often cleaner than description)
  merchantEmoji?: string | null;    // Monzo's per-merchant emoji
  bankCategory?: string | null;     // bank's own categorisation (Monzo's Category column)
  currency?: string | null;
  localAmount?: string | null;
  localCurrency?: string | null;
  notes?: string | null;            // user notes / hashtags from the export
  address?: string | null;
  receiptUrl?: string | null;
  raw?: Record<string, unknown> | null; // anything else from the row, future-proof
}

// Transient / derived types
export interface RawTransaction {
  date: string;
  description: string;
  amount: string;
  reference: string | null;
  fingerprint: string;
  isDuplicate: boolean;
  suggestedCategoryId: number | null;
  metadata?: RawTransactionMetadata | null;
}

export interface ImportResult {
  batchId: number;
  importedCount: number;
  duplicateCount: number;
  totalCount: number;
}

export interface AccountBalance {
  accountId: number;
  accountName: string;
  accountType: string;
  balance: string;
}

export interface OwnerEquity {
  propertyId: number;
  propertyName: string;
  ownerId: number;
  ownerName: string;
  capitalBalance: string;
  equityPercentage: number;
  marketEquity: string;
}

export interface JournalEntryWithDetails {
  id: number;
  date: string;
  description: string;
  reference: string | null;
  categoryId: number | null;
  categoryName: string | null;
  entriesSummary: string | null;
}

export interface MonthlySpending {
  month: string;
  categoryName: string | null;
  accountType: string;
  total: string;
}

export * from './enums';
