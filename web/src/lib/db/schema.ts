import {
  pgTable,
  pgEnum,
  serial,
  text,
  integer,
  boolean,
  numeric,
  timestamp,
  unique,
  type AnyPgColumn,
} from 'drizzle-orm/pg-core';

// Enums
export const accountTypeEnum = pgEnum('account_type', ['ASSET', 'LIABILITY', 'EQUITY', 'INCOME', 'EXPENSE']);
export const matchTypeEnum = pgEnum('match_type', ['contains', 'startswith', 'exact', 'regex']);
export const ruleSourceEnum = pgEnum('rule_source', ['user', 'ai', 'system']);
export const messageRoleEnum = pgEnum('message_role', ['user', 'assistant', 'system']);

// Tables
export const accounts = pgTable('accounts', {
  id: serial('id').primaryKey(),
  name: text('name').notNull().unique(),
  accountType: accountTypeEnum('account_type').notNull(),
  parentId: integer('parent_id').references((): AnyPgColumn => accounts.id),
  description: text('description'),
  isSystem: boolean('is_system').notNull().default(false),
  createdAt: timestamp('created_at').notNull().defaultNow(),
});

export const categories = pgTable('categories', {
  id: serial('id').primaryKey(),
  name: text('name').notNull(),
  parentId: integer('parent_id').references((): AnyPgColumn => categories.id),
  isSystem: boolean('is_system').notNull().default(false),
  createdAt: timestamp('created_at').notNull().defaultNow(),
}, (table) => [
  unique('categories_name_parent_id_key').on(table.name, table.parentId),
]);

export const categorizationRules = pgTable('categorization_rules', {
  id: serial('id').primaryKey(),
  pattern: text('pattern').notNull(),
  categoryId: integer('category_id').notNull().references(() => categories.id),
  matchType: matchTypeEnum('match_type').notNull().default('contains'),
  priority: integer('priority').notNull().default(0),
  source: ruleSourceEnum('source').notNull().default('user'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
});

export const journalEntries = pgTable('journal_entries', {
  id: serial('id').primaryKey(),
  date: text('date').notNull(),
  description: text('description').notNull(),
  reference: text('reference'),
  categoryId: integer('category_id').references(() => categories.id),
  importBatchId: integer('import_batch_id').references((): AnyPgColumn => importBatches.id),
  createdAt: timestamp('created_at').notNull().defaultNow(),
});

export const bookEntries = pgTable('book_entries', {
  id: serial('id').primaryKey(),
  journalEntryId: integer('journal_entry_id').notNull().references(() => journalEntries.id, { onDelete: 'cascade' }),
  accountId: integer('account_id').notNull().references(() => accounts.id),
  amount: numeric('amount', { precision: 14, scale: 2 }).notNull(),
  createdAt: timestamp('created_at').notNull().defaultNow(),
});

export const importBatches = pgTable('import_batches', {
  id: serial('id').primaryKey(),
  filename: text('filename').notNull(),
  bankConfig: text('bank_config').notNull(),
  accountId: integer('account_id').notNull().references(() => accounts.id),
  rowCount: integer('row_count').notNull().default(0),
  importedCount: integer('imported_count').notNull().default(0),
  duplicateCount: integer('duplicate_count').notNull().default(0),
  importedAt: timestamp('imported_at').notNull().defaultNow(),
});

export const transactionFingerprints = pgTable('transaction_fingerprints', {
  id: serial('id').primaryKey(),
  fingerprint: text('fingerprint').notNull(),
  accountId: integer('account_id').notNull().references(() => accounts.id),
  journalEntryId: integer('journal_entry_id').notNull().references(() => journalEntries.id),
  createdAt: timestamp('created_at').notNull().defaultNow(),
}, (table) => [
  unique('fingerprints_fp_account_key').on(table.fingerprint, table.accountId),
]);

export const properties = pgTable('properties', {
  id: serial('id').primaryKey(),
  name: text('name').notNull().unique(),
  address: text('address'),
  purchaseDate: text('purchase_date'),
  purchasePrice: numeric('purchase_price', { precision: 14, scale: 2 }),
  createdAt: timestamp('created_at').notNull().defaultNow(),
});

export const owners = pgTable('owners', {
  id: serial('id').primaryKey(),
  name: text('name').notNull().unique(),
  createdAt: timestamp('created_at').notNull().defaultNow(),
});

export const propertyOwnership = pgTable('property_ownership', {
  id: serial('id').primaryKey(),
  propertyId: integer('property_id').notNull().references(() => properties.id),
  ownerId: integer('owner_id').notNull().references(() => owners.id),
  capitalAccountId: integer('capital_account_id').notNull().references(() => accounts.id),
  createdAt: timestamp('created_at').notNull().defaultNow(),
}, (table) => [
  unique('ownership_property_owner_key').on(table.propertyId, table.ownerId),
]);

export const mortgages = pgTable('mortgages', {
  id: serial('id').primaryKey(),
  propertyId: integer('property_id').notNull().references(() => properties.id),
  lender: text('lender').notNull(),
  originalAmount: numeric('original_amount', { precision: 14, scale: 2 }).notNull(),
  startDate: text('start_date').notNull(),
  termMonths: integer('term_months').notNull(),
  liabilityAccountId: integer('liability_account_id').notNull().references(() => accounts.id),
  createdAt: timestamp('created_at').notNull().defaultNow(),
});

export const mortgageRateHistory = pgTable('mortgage_rate_history', {
  id: serial('id').primaryKey(),
  mortgageId: integer('mortgage_id').notNull().references(() => mortgages.id),
  rate: numeric('rate', { precision: 6, scale: 4 }).notNull(),
  effectiveDate: text('effective_date').notNull(),
  createdAt: timestamp('created_at').notNull().defaultNow(),
});

export const propertyValuations = pgTable('property_valuations', {
  id: serial('id').primaryKey(),
  propertyId: integer('property_id').notNull().references(() => properties.id),
  valuation: numeric('valuation', { precision: 14, scale: 2 }).notNull(),
  valuationDate: text('valuation_date').notNull(),
  source: text('source').default('manual'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
});

export const equitySnapshots = pgTable('equity_snapshots', {
  id: serial('id').primaryKey(),
  propertyId: integer('property_id').notNull().references(() => properties.id),
  ownerId: integer('owner_id').notNull().references(() => owners.id),
  snapshotDate: text('snapshot_date').notNull(),
  equityAmount: numeric('equity_amount', { precision: 14, scale: 2 }).notNull(),
  equityPercentage: numeric('equity_percentage', { precision: 8, scale: 4 }).notNull(),
  createdAt: timestamp('created_at').notNull().defaultNow(),
});

export const propertyTransfers = pgTable('property_transfers', {
  id: serial('id').primaryKey(),
  fromPropertyId: integer('from_property_id').notNull().references(() => properties.id),
  toPropertyId: integer('to_property_id').notNull().references(() => properties.id),
  ownerId: integer('owner_id').notNull().references(() => owners.id),
  amount: numeric('amount', { precision: 14, scale: 2 }).notNull(),
  journalEntryId: integer('journal_entry_id').notNull().references(() => journalEntries.id),
  transferDate: text('transfer_date').notNull(),
  description: text('description'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
});

export const expenseAllocationRules = pgTable('expense_allocation_rules', {
  id: serial('id').primaryKey(),
  propertyId: integer('property_id').notNull().references(() => properties.id),
  ownerId: integer('owner_id').notNull().references(() => owners.id),
  allocationPct: numeric('allocation_pct', { precision: 8, scale: 4 }).notNull(),
  expenseType: text('expense_type').notNull().default('all'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
}, (table) => [
  unique('allocation_property_owner_type_key').on(table.propertyId, table.ownerId, table.expenseType),
]);

export const aiConversations = pgTable('ai_conversations', {
  id: serial('id').primaryKey(),
  title: text('title'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
});

export const aiMessages = pgTable('ai_messages', {
  id: serial('id').primaryKey(),
  conversationId: integer('conversation_id').notNull().references(() => aiConversations.id, { onDelete: 'cascade' }),
  role: messageRoleEnum('role').notNull(),
  content: text('content').notNull(),
  createdAt: timestamp('created_at').notNull().defaultNow(),
});
