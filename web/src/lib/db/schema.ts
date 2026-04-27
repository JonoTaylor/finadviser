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
  customType,
  jsonb,
  type AnyPgColumn,
} from 'drizzle-orm/pg-core';

// Custom Postgres BYTEA mapped to Buffer in/out. Drizzle pg-core doesn't
// ship a binary type and Neon's HTTP driver serialises parameters as
// JSON, so we explicitly convert Buffer ↔ Postgres hex format ('\xHEX')
// instead of trusting the driver's binary encoding.
const bytea = customType<{ data: Buffer; default: false }>({
  dataType() {
    return 'bytea';
  },
  toDriver(value: Buffer): string {
    return '\\x' + value.toString('hex');
  },
  fromDriver(value: unknown): Buffer {
    if (Buffer.isBuffer(value)) return value;
    if (value instanceof Uint8Array) return Buffer.from(value);
    if (typeof value === 'string') {
      // Postgres returns BYTEA in hex format prefixed with '\x'.
      const hex = value.startsWith('\\x') ? value.slice(2) : value;
      return Buffer.from(hex, 'hex');
    }
    throw new Error(`Unsupported BYTEA driver value type: ${typeof value}`);
  },
});

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
  // Investment tagging — pension / S&S ISA / LISA / savings / crypto
  // / other. is_investment splits asset accounts that grow via market
  // value (manual balance updates) from cash/operational ones. owner_id
  // attributes the account to a specific person; null means shared
  // and excluded from per-owner net-worth calcs by default.
  isInvestment: boolean('is_investment').notNull().default(false),
  investmentKind: text('investment_kind'), // 'pension' | 'isa' | 'lisa' | 'savings' | 'crypto' | 'other' | null
  ownerId: integer('owner_id').references((): AnyPgColumn => owners.id),
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
  propertyId: integer('property_id').references((): AnyPgColumn => properties.id),
  // Set when this row was created by a banking-aggregator sync.
  // UNIQUE (partial index where NOT NULL) is the dedup primitive on
  // re-sync: the same aggregator txn ID lands in the same row idempotently.
  providerTxnId: text('provider_txn_id'),
  syncRunId: integer('sync_run_id').references((): AnyPgColumn => syncRuns.id, { onDelete: 'set null' }),
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

// Per-transaction extras pulled from rich exports (Monzo's full CSV
// being the motivating case). Optional 1:1 with journal_entries —
// kept in a sidecar table rather than bloating the journal so legacy
// importers stay simple. `raw` carries any column we didn't promote
// to a typed field, so future banks don't require a schema change.
export const transactionMetadata = pgTable('transaction_metadata', {
  id: serial('id').primaryKey(),
  journalEntryId: integer('journal_entry_id').notNull().references(() => journalEntries.id, { onDelete: 'cascade' }).unique(),
  externalId: text('external_id'),
  transactionTime: text('transaction_time'),
  transactionType: text('transaction_type'),
  merchantName: text('merchant_name'),
  merchantEmoji: text('merchant_emoji'),
  bankCategory: text('bank_category'),
  currency: text('currency'),
  localAmount: text('local_amount'),
  localCurrency: text('local_currency'),
  notes: text('notes'),
  address: text('address'),
  receiptUrl: text('receipt_url'),
  raw: jsonb('raw'),
  // FX preservation for foreign-charged transactions where the booking
  // currency (typically GBP) differs from what was actually spent.
  // Populated by the banking sync when the aggregator returns
  // transactionAmount + currencyExchange data; left null otherwise.
  originalAmount: numeric('original_amount', { precision: 14, scale: 2 }),
  originalCurrency: text('original_currency'),
  fxRate: numeric('fx_rate', { precision: 18, scale: 8 }),
  createdAt: timestamp('created_at').notNull().defaultNow(),
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
  interestOnly: boolean('interest_only').notNull().default(false),
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

export const rentFrequencyEnum = pgEnum('rent_frequency', ['monthly', 'weekly', 'four_weekly', 'quarterly', 'annual']);

export const tenancies = pgTable('tenancies', {
  id: serial('id').primaryKey(),
  propertyId: integer('property_id').notNull().references(() => properties.id, { onDelete: 'cascade' }),
  tenantName: text('tenant_name').notNull(),
  startDate: text('start_date').notNull(),
  endDate: text('end_date'),
  rentAmount: numeric('rent_amount', { precision: 14, scale: 2 }).notNull(),
  rentFrequency: rentFrequencyEnum('rent_frequency').notNull().default('monthly'),
  depositAmount: numeric('deposit_amount', { precision: 14, scale: 2 }),
  notes: text('notes'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
});

export const tipTypeEnum = pgEnum('tip_type', ['tip', 'warning', 'insight']);

export const aiMemorySourceEnum = pgEnum('ai_memory_source', ['user', 'ai']);

// Persistent facts the assistant should remember across conversations.
// Discrete rows so the user can audit / delete individual entries.
// Source tracks who created it (user via Settings, AI via remember tool).
export const aiMemories = pgTable('ai_memories', {
  id: serial('id').primaryKey(),
  content: text('content').notNull(),
  source: aiMemorySourceEnum('source').notNull().default('ai'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
});

export const appSettings = pgTable('app_settings', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
});

export const aiTips = pgTable('ai_tips', {
  id: serial('id').primaryKey(),
  content: text('content').notNull(),
  tipType: tipTypeEnum('tip_type').notNull().default('tip'),
  priority: integer('priority').notNull().default(0),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  dismissedAt: timestamp('dismissed_at'),
});

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

export const budgets = pgTable('budgets', {
  id: serial('id').primaryKey(),
  categoryId: integer('category_id').notNull().references(() => categories.id).unique(),
  monthlyLimit: text('monthly_limit').notNull(),
  effectiveFrom: text('effective_from').notNull(),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
});

export const savingsGoalStatusEnum = pgEnum('savings_goal_status', ['active', 'completed', 'cancelled']);

export const documentKindEnum = pgEnum('document_kind', ['tenancy_agreement', 'other']);

// Stores the original PDF (or future binary docs) alongside structured
// metadata. Linked optionally to a property + tenancy so the Documents
// page can group by property and the tenancy view can show its source
// agreement. BYTEA keeps everything in Postgres — fine for the
// expected volume (a handful per tenancy, tens overall) and avoids
// adding a separate object-storage env. Revisit if document count or
// average size grows materially.
export const documents = pgTable('documents', {
  id: serial('id').primaryKey(),
  kind: documentKindEnum('kind').notNull(),
  filename: text('filename').notNull(),
  mimeType: text('mime_type').notNull(),
  sizeBytes: integer('size_bytes').notNull(),
  // Hex-encoded SHA-256 of the file contents — used for dedup on upload.
  sha256: text('sha256').notNull().unique(),
  content: bytea('content').notNull(),
  propertyId: integer('property_id').references(() => properties.id, { onDelete: 'set null' }),
  tenancyId: integer('tenancy_id').references(() => tenancies.id, { onDelete: 'set null' }),
  notes: text('notes'),
  uploadedAt: timestamp('uploaded_at').notNull().defaultNow(),
});

export const savingsGoals = pgTable('savings_goals', {
  id: serial('id').primaryKey(),
  name: text('name').notNull(),
  targetAmount: text('target_amount').notNull(),
  currentAmount: text('current_amount').notNull().default('0'),
  targetDate: text('target_date'),
  accountId: integer('account_id').references(() => accounts.id),
  status: savingsGoalStatusEnum('status').notNull().default('active'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
});

// Banking integration tables. providers is the small catalogue of
// banks the user wants aggregated (Monzo, Barclays, Amex UK, Yonder).
// connections tracks the aggregator-side link state per provider, with
// the PSD2 90-day expiry clock. provider_accounts binds an aggregator
// account to one of our existing `accounts` rows so synced txns flow
// into the existing journal model. sync_runs is per-cron-tick audit.
export const bankingAggregatorEnum = pgEnum('banking_aggregator', ['gocardless_bad', 'truelayer']);
export const connectionStatusEnum = pgEnum('connection_status', ['pending', 'active', 'expiring', 'expired', 'revoked', 'error']);
export const syncRunStatusEnum = pgEnum('sync_run_status', ['running', 'success', 'partial', 'error']);

export const providers = pgTable('providers', {
  id: serial('id').primaryKey(),
  slug: text('slug').notNull().unique(),
  displayName: text('display_name').notNull(),
  aggregator: bankingAggregatorEnum('aggregator').notNull().default('gocardless_bad'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
});

export const connections = pgTable('connections', {
  id: serial('id').primaryKey(),
  providerId: integer('provider_id').notNull().references(() => providers.id),
  ownerId: integer('owner_id').references(() => owners.id),
  aggregatorRef: text('aggregator_ref').notNull().unique(),
  status: connectionStatusEnum('status').notNull().default('pending'),
  consentExpiresAt: timestamp('consent_expires_at'),
  lastSyncedAt: timestamp('last_synced_at'),
  lastError: text('last_error'),
  encryptedSecret: bytea('encrypted_secret'),
  institutionId: text('institution_id').notNull(),
  institutionName: text('institution_name').notNull(),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
});

export const providerAccounts = pgTable('provider_accounts', {
  id: serial('id').primaryKey(),
  connectionId: integer('connection_id').notNull().references(() => connections.id, { onDelete: 'cascade' }),
  accountId: integer('account_id').notNull().references(() => accounts.id),
  aggregatorAccountRef: text('aggregator_account_ref').notNull().unique(),
  iban: text('iban'),
  currency: text('currency').notNull().default('GBP'),
  product: text('product'),
  cutoverDate: text('cutover_date'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
});

export const syncRuns = pgTable('sync_runs', {
  id: serial('id').primaryKey(),
  connectionId: integer('connection_id').notNull().references(() => connections.id, { onDelete: 'cascade' }),
  startedAt: timestamp('started_at').notNull().defaultNow(),
  finishedAt: timestamp('finished_at'),
  status: syncRunStatusEnum('status').notNull().default('running'),
  txnsAdded: integer('txns_added').notNull().default(0),
  txnsUpdated: integer('txns_updated').notNull().default(0),
  errorMessage: text('error_message'),
});
