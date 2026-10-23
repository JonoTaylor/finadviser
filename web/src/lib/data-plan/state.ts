import { PROFILE_FIELD_COLUMNS, TAX_PROFILE_FIELDS, type Plan, type PlanRentFrequency } from './schema';
import { addDays } from './matching';
import type { Queryable } from './statements';
import type {
  AccountRow,
  AccountType,
  AllocationRuleRow,
  CategoryRow,
  DbState,
  LedgerLine,
  MortgageRow,
  OwnershipRow,
  OwnerRow,
  PropertyRow,
  ReferencedJournal,
  TaxProfileRow,
  TenancyRow,
} from './types';
import type { LettingType } from '@/lib/db/schema';
import { taxYearRange } from '@/lib/tax/ukTaxYear';

/**
 * Read side of the loader: schema check and state load. Every query here is
 * a SELECT with bound parameters; nothing in this module can write. Dry-run
 * and snapshot additionally run inside a READ ONLY transaction.
 *
 * The state is described as a list of INDEPENDENT queries (buildStateQueries):
 * none needs the result of another, because the properties of interest are
 * found with a sub-select on the plan's property names and the owner's
 * ownership rows. That is what lets the HTTP driver run the whole read as one
 * REPEATABLE READ batch with a single, consistent snapshot, while the pg /
 * WebSocket drivers simply run the same list one after another inside their
 * own read-only transaction.
 */

/** Tables/columns every database needs for the loader, whether or not the newest migration has run. */
export const BASE_SCHEMA: Record<string, string[]> = {
  properties: ['id', 'name'],
  owners: ['id', 'name'],
  property_ownership: ['property_id', 'owner_id', 'capital_account_id'],
  expense_allocation_rules: ['property_id', 'owner_id', 'allocation_pct', 'expense_type'],
  tenancies: ['id', 'property_id', 'tenant_name', 'start_date', 'end_date', 'rent_amount', 'rent_frequency', 'deposit_amount', 'notes'],
  mortgages: ['id', 'property_id', 'lender', 'interest_only'],
  accounts: ['id', 'name', 'account_type', 'is_system', 'owner_id'],
  categories: ['id', 'name', 'parent_id'],
  journal_entries: ['id', 'date', 'description', 'reference', 'category_id', 'property_id', 'is_transfer'],
  book_entries: ['id', 'journal_entry_id', 'account_id', 'amount'],
};

/**
 * What src/lib/db/migration.sql adds for the owner tax computation. Production
 * may not have it when the plan is first reviewed (the migration runs on the
 * next deploy), so its absence is reported as "pending migration" rather
 * than as a broken database.
 */
export const MIGRATION_SCHEMA: Record<string, string[]> = {
  properties: ['letting_type'],
  owner_tax_profiles: ['id', 'owner_id', 'tax_year', ...Object.values(PROFILE_FIELD_COLUMNS), 'notes', 'updated_at', 'revision', 'known_fields', 'field_sources', 'facts'],
};

/** Everything the apply path needs. */
export const REQUIRED_SCHEMA: Record<string, string[]> = Object.fromEntries(
  [...Object.keys(BASE_SCHEMA), ...Object.keys(MIGRATION_SCHEMA)].map(t => [t, [...(BASE_SCHEMA[t] ?? []), ...(MIGRATION_SCHEMA[t] ?? [])]]),
);

export interface SchemaReport {
  /** Problems no migration explains (not an app database, or an old one). Always a refusal. */
  blocking: string[];
  /** Missing pieces the pending migration creates. Dry run and snapshot carry on; apply refuses. */
  pendingMigration: string[];
  /** properties.letting_type exists. */
  lettingType: boolean;
  /** owner_tax_profiles exists with every column the loader uses. */
  taxProfiles: boolean;
}

type Row = Record<string, unknown>;

function placeholders(count: number, start = 1, cast = ''): string {
  return Array.from({ length: count }, (_, i) => `$${start + i}${cast}`).join(', ');
}

export function schemaColumnsQuery(): { text: string; params: unknown[] } {
  const tables = Object.keys(REQUIRED_SCHEMA);
  return {
    text: `SELECT table_name::text AS table_name, column_name::text AS column_name
       FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name IN (${placeholders(tables.length)})`,
    params: tables,
  };
}

/** Pure half of the schema check: information_schema rows in, report out. */
export function evaluateSchema(rows: ReadonlyArray<{ table_name: string; column_name: string }>): SchemaReport {
  const present = new Map<string, Set<string>>();
  for (const row of rows) {
    const set = present.get(row.table_name) ?? new Set<string>();
    set.add(row.column_name);
    present.set(row.table_name, set);
  }

  const problemsFor = (required: Record<string, string[]>): Map<string, string[]> => {
    const out = new Map<string, string[]>();
    for (const [table, columns] of Object.entries(required)) {
      const have = present.get(table);
      if (!have) {
        out.set(table, [`table ${table} is missing`]);
        continue;
      }
      const missing = columns.filter(c => !have.has(c));
      if (missing.length > 0) out.set(table, [`${table} is missing column${missing.length > 1 ? 's' : ''} ${missing.join(', ')}`]);
    }
    return out;
  };

  const blocking = [...problemsFor(BASE_SCHEMA).values()].flat();
  const pending = problemsFor(MIGRATION_SCHEMA);
  // 'properties' appears in both lists: a missing properties table is already
  // blocking, so only report letting_type as pending when the table is there.
  if (!present.has('properties')) pending.delete('properties');
  return {
    blocking,
    pendingMigration: [...pending.values()].flat(),
    lettingType: present.get('properties')?.has('letting_type') ?? false,
    taxProfiles: !pending.has('owner_tax_profiles'),
  };
}

export async function checkSchema(q: Queryable): Promise<SchemaReport> {
  const { text, params } = schemaColumnsQuery();
  const r = await q.query<{ table_name: string; column_name: string }>(text, params);
  return evaluateSchema(r.rows);
}

/** True when the loader may write: nothing blocking and nothing pending. */
export function schemaReady(report: SchemaReport): boolean {
  return report.blocking.length === 0 && report.pendingMigration.length === 0;
}

function mapLine(r: Row): LedgerLine {
  return {
    bookEntryId: Number(r.book_entry_id),
    journalId: Number(r.journal_id),
    date: String(r.date),
    description: String(r.description),
    reference: r.reference === null ? null : String(r.reference),
    categoryId: r.category_id === null ? null : Number(r.category_id),
    propertyId: r.property_id === null ? null : Number(r.property_id),
    isTransfer: Boolean(r.is_transfer),
    accountId: Number(r.account_id),
    accountName: String(r.account_name),
    accountType: String(r.account_type) as 'INCOME' | 'EXPENSE',
    accountIsSystem: Boolean(r.account_is_system),
    amount: String(r.amount),
  };
}

const LINE_SELECT = `
  SELECT be.id               AS book_entry_id,
         je.id               AS journal_id,
         je.date             AS date,
         je.description      AS description,
         je.reference        AS reference,
         je.category_id      AS category_id,
         je.property_id      AS property_id,
         COALESCE(je.is_transfer, FALSE) AS is_transfer,
         a.id                AS account_id,
         a.name              AS account_name,
         a.account_type::text AS account_type,
         a.is_system         AS account_is_system,
         be.amount::text     AS amount
    FROM journal_entries je
    JOIN book_entries be ON be.journal_entry_id = je.id
    JOIN accounts a      ON a.id = be.account_id`;

export type StateQueryKey =
  | 'owners'
  | 'properties'
  | 'ownership'
  | 'allocationRules'
  | 'accounts'
  | 'categories'
  | 'tenancies'
  | 'mortgages'
  | 'taggedLines'
  | 'candidateLines'
  | 'referencedJournals'
  | 'taxProfile';

export interface StateQuery {
  key: StateQueryKey;
  text: string;
  params: unknown[];
}

/**
 * Properties whose ledger we need: the plan's own, plus everything the plan's
 * owner has a stake in, so the owner-level totals are complete. Expressed as
 * a sub-select ($1 = property names, $2 = owner name) so no query depends on
 * another query's result.
 */
const PLAN_PROPERTY_IDS = `SELECT p.id FROM properties p WHERE p.name = ANY($1::text[])
     UNION
     SELECT po.property_id FROM property_ownership po JOIN owners o ON o.id = po.owner_id WHERE o.name = $2::text`;

/**
 * Every query that makes up the state, in a fixed order, each independent of
 * the others' results. `schema` says which migration-added pieces exist; the
 * queries for the missing ones are left out (and assembleState reports them
 * as pending).
 */
export function buildStateQueries(plan: Plan, schema: Pick<SchemaReport, 'lettingType' | 'taxProfiles'>): StateQuery[] {
  const queries: StateQuery[] = [];
  const add = (key: StateQueryKey, text: string, params: unknown[] = []) => queries.push({ key, text, params });

  add('owners', `SELECT id, name FROM owners ORDER BY name, id`);
  add(
    'properties',
    schema.lettingType
      ? `SELECT id, name, letting_type FROM properties ORDER BY name, id`
      : `SELECT id, name FROM properties ORDER BY name, id`,
  );
  add(
    'ownership',
    `SELECT po.property_id, po.owner_id, o.name AS owner_name, a.name AS capital_account
       FROM property_ownership po
       JOIN owners o   ON o.id = po.owner_id
       JOIN accounts a ON a.id = po.capital_account_id
      ORDER BY po.property_id, o.name`,
  );
  add(
    'allocationRules',
    `SELECT property_id, owner_id, allocation_pct::text AS allocation_pct, expense_type
       FROM expense_allocation_rules ORDER BY property_id, owner_id, expense_type`,
  );
  add('accounts', `SELECT id, name, account_type::text AS account_type, is_system, owner_id FROM accounts ORDER BY name, id`);
  add('categories', `SELECT id, name, parent_id FROM categories ORDER BY id`);

  const scope = [plan.properties.map(s => s.name), plan.owner];
  const windowDays = plan.dedupe.windowDays;
  const range = taxYearRange(plan.taxYear);
  const from = addDays(range.startDate, -windowDays);
  const to = addDays(range.endDate, windowDays);

  add(
    'tenancies',
    `SELECT id, property_id, tenant_name, start_date, end_date, rent_amount::text AS rent_amount,
            rent_frequency::text AS rent_frequency, deposit_amount::text AS deposit_amount, notes
       FROM tenancies
      WHERE property_id IN (${PLAN_PROPERTY_IDS})
      ORDER BY property_id, start_date, id`,
    scope,
  );
  add(
    'mortgages',
    `SELECT id, property_id, lender, interest_only FROM mortgages
      WHERE property_id IN (${PLAN_PROPERTY_IDS}) ORDER BY property_id, id`,
    scope,
  );
  // Tagged ledger lines for the year, widened by the dedupe window so items
  // near the year boundary still see their neighbours.
  add(
    'taggedLines',
    `${LINE_SELECT}
      WHERE je.property_id IN (${PLAN_PROPERTY_IDS})
        AND je.date >= $3::text AND je.date <= $4::text
        AND a.account_type IN ('INCOME', 'EXPENSE')
      ORDER BY je.date, je.id, be.id`,
    [...scope, from, to],
  );

  // Untagged / other-property lines that could be the same real-world payment
  // as a plan item: matched in SQL on amount and date window so we never pull
  // a whole year of unrelated transactions.
  const journalItems = plan.properties.flatMap(s => [...s.income, ...s.expenses, ...s.mortgageInterest]).filter(i => i.include);
  if (journalItems.length > 0) {
    const amounts = [
      ...new Set(journalItems.flatMap(i => [i.amount as string, ...('alternateAmounts' in i ? i.alternateAmounts : [])])),
    ];
    const dates = journalItems.map(i => i.date).sort();
    add(
      'candidateLines',
      `${LINE_SELECT}
        WHERE (je.property_id IS NULL OR je.property_id NOT IN (${PLAN_PROPERTY_IDS}))
          AND je.date >= $3::text AND je.date <= $4::text
          AND a.account_type IN ('INCOME', 'EXPENSE')
          AND ABS(be.amount::numeric) IN (${placeholders(amounts.length, 5, '::numeric')})
        ORDER BY je.date, je.id, be.id`,
      [...scope, addDays(dates[0], -windowDays), addDays(dates[dates.length - 1], windowDays), ...amounts],
    );
  }

  add(
    'referencedJournals',
    `SELECT je.id AS journal_id, je.reference, je.date, je.description, je.property_id,
            (SELECT SUM(be.amount::numeric)::text
               FROM book_entries be JOIN accounts a ON a.id = be.account_id
              WHERE be.journal_entry_id = je.id AND a.account_type IN ('INCOME', 'EXPENSE')) AS amount,
            (SELECT a.name
               FROM book_entries be JOIN accounts a ON a.id = be.account_id
              WHERE be.journal_entry_id = je.id AND a.account_type IN ('INCOME', 'EXPENSE')
              ORDER BY be.id LIMIT 1) AS account_name
       FROM journal_entries je
      WHERE starts_with(je.reference, $1::text)
      ORDER BY je.id`,
    [`plan:${plan.planId}:`],
  );

  if (schema.taxProfiles) {
    const cols = TAX_PROFILE_FIELDS.map(f => `${PROFILE_FIELD_COLUMNS[f]}::text AS ${PROFILE_FIELD_COLUMNS[f]}`).join(', ');
    add(
      'taxProfile',
      `SELECT ${cols}, notes, revision, known_fields FROM owner_tax_profiles
        WHERE owner_id = (SELECT id FROM owners WHERE name = $1::text ORDER BY id LIMIT 1) AND tax_year = $2::text`,
      [plan.owner, plan.taxYear],
    );
  }
  return queries;
}

/** Turn the rows of buildStateQueries' queries into the planner's DbState. */
export function assembleState(
  plan: Plan,
  schema: Pick<SchemaReport, 'lettingType' | 'taxProfiles'>,
  results: Partial<Record<StateQueryKey, Row[]>>,
): DbState {
  const rows = (key: StateQueryKey): Row[] => results[key] ?? [];

  const owners = rows('owners').map((r): OwnerRow => ({ id: Number(r.id), name: String(r.name) }));
  const properties = rows('properties').map(
    (r): PropertyRow => ({
      id: Number(r.id),
      name: String(r.name),
      // Without the column every property is, in effect, 'standard' (the
      // migration's default); the planner reports letting-type items as pending.
      lettingType: (schema.lettingType && r.letting_type === 'rent_a_room' ? 'rent_a_room' : 'standard') as LettingType,
    }),
  );
  const ownership = rows('ownership').map(
    (r): OwnershipRow => ({
      propertyId: Number(r.property_id),
      ownerId: Number(r.owner_id),
      ownerName: String(r.owner_name),
      capitalAccount: String(r.capital_account),
    }),
  );
  const allocationRules = rows('allocationRules').map(
    (r): AllocationRuleRow => ({
      propertyId: Number(r.property_id),
      ownerId: Number(r.owner_id),
      allocationPct: String(r.allocation_pct),
      expenseType: String(r.expense_type),
    }),
  );
  const accounts = rows('accounts').map(
    (r): AccountRow => ({
      id: Number(r.id),
      name: String(r.name),
      accountType: String(r.account_type) as AccountType,
      isSystem: Boolean(r.is_system),
      ownerId: r.owner_id === null ? null : Number(r.owner_id),
    }),
  );
  const categories = rows('categories').map(
    (r): CategoryRow => ({
      id: Number(r.id),
      name: String(r.name),
      parentId: r.parent_id === null ? null : Number(r.parent_id),
    }),
  );
  const tenancies = rows('tenancies').map(
    (r): TenancyRow => ({
      id: Number(r.id),
      propertyId: Number(r.property_id),
      tenantName: String(r.tenant_name),
      startDate: String(r.start_date),
      endDate: r.end_date === null ? null : String(r.end_date),
      rentAmount: String(r.rent_amount),
      rentFrequency: String(r.rent_frequency) as PlanRentFrequency,
      depositAmount: r.deposit_amount === null ? null : String(r.deposit_amount),
      notes: r.notes === null ? null : String(r.notes),
    }),
  );
  const mortgages = rows('mortgages').map(
    (r): MortgageRow => ({
      id: Number(r.id),
      propertyId: Number(r.property_id),
      lender: String(r.lender),
      interestOnly: Boolean(r.interest_only),
    }),
  );
  const taggedLines = rows('taggedLines').map(mapLine);
  const candidateLines = rows('candidateLines').map(mapLine);
  const referencedJournals = rows('referencedJournals').map(
    (r): ReferencedJournal => ({
      journalId: Number(r.journal_id),
      reference: String(r.reference),
      date: String(r.date),
      description: String(r.description),
      propertyId: r.property_id === null ? null : Number(r.property_id),
      amount: r.amount === null ? null : String(r.amount),
      accountName: r.account_name === null ? null : String(r.account_name),
    }),
  );

  const owner = owners.find(o => o.name === plan.owner);
  let taxProfile: TaxProfileRow | null = null;
  const profileRow = rows('taxProfile')[0];
  if (owner && profileRow) {
    const values = {} as TaxProfileRow['values'];
    for (const f of TAX_PROFILE_FIELDS) values[f] = String(profileRow[PROFILE_FIELD_COLUMNS[f]]);
    taxProfile = {
      ownerId: owner.id,
      taxYear: plan.taxYear,
      values,
      notes: profileRow.notes === null ? null : String(profileRow.notes),
      revision: Number(profileRow.revision),
      knownFields: profileRow.known_fields === null ? null : profileRow.known_fields as TaxProfileRow['knownFields'],
    };
  }

  const state: DbState = {
    owners,
    properties,
    ownership,
    allocationRules,
    tenancies,
    mortgages,
    accounts,
    categories,
    taggedLines,
    candidateLines,
    referencedJournals,
    taxProfile,
  };
  if (!schema.lettingType || !schema.taxProfiles) {
    state.pendingMigration = { lettingType: !schema.lettingType, taxProfile: !schema.taxProfiles };
  }
  return state;
}

/** Run the state queries one after another on a connection (pg / Neon WebSocket). */
export async function loadState(q: Queryable, plan: Plan, schema: Pick<SchemaReport, 'lettingType' | 'taxProfiles'>): Promise<DbState> {
  const results: Partial<Record<StateQueryKey, Row[]>> = {};
  for (const query of buildStateQueries(plan, schema)) {
    results[query.key] = (await q.query<Row>(query.text, query.params)).rows;
  }
  return assembleState(plan, schema, results);
}
