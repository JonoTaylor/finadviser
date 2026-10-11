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
 * Read side of the loader: schema check and one-pass state load. Every
 * query here is a SELECT with bound parameters; nothing in this module can
 * write. Dry-run and snapshot additionally run inside BEGIN READ ONLY.
 */

/** Columns the loader (and the tax report it mirrors) needs. */
export const REQUIRED_SCHEMA: Record<string, string[]> = {
  properties: ['id', 'name', 'letting_type'],
  owners: ['id', 'name'],
  property_ownership: ['property_id', 'owner_id', 'capital_account_id'],
  expense_allocation_rules: ['property_id', 'owner_id', 'allocation_pct', 'expense_type'],
  tenancies: ['id', 'property_id', 'tenant_name', 'start_date', 'end_date', 'rent_amount', 'rent_frequency', 'deposit_amount', 'notes'],
  mortgages: ['id', 'property_id', 'lender', 'interest_only'],
  accounts: ['id', 'name', 'account_type', 'is_system', 'owner_id'],
  categories: ['id', 'name', 'parent_id'],
  journal_entries: ['id', 'date', 'description', 'reference', 'category_id', 'property_id', 'is_transfer'],
  book_entries: ['id', 'journal_entry_id', 'account_id', 'amount'],
  owner_tax_profiles: ['id', 'owner_id', 'tax_year', ...Object.values(PROFILE_FIELD_COLUMNS), 'notes', 'updated_at'],
};

type Row = Record<string, unknown>;

function placeholders(count: number, start = 1, cast = ''): string {
  return Array.from({ length: count }, (_, i) => `$${start + i}${cast}`).join(', ');
}

/** Returns a list of human-readable schema problems; empty when the schema is ready. */
export async function checkSchema(q: Queryable): Promise<string[]> {
  const tables = Object.keys(REQUIRED_SCHEMA);
  const r = await q.query<{ table_name: string; column_name: string }>(
    `SELECT table_name::text AS table_name, column_name::text AS column_name
       FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name IN (${placeholders(tables.length)})`,
    tables,
  );
  const present = new Map<string, Set<string>>();
  for (const row of r.rows) {
    const set = present.get(row.table_name) ?? new Set<string>();
    set.add(row.column_name);
    present.set(row.table_name, set);
  }

  const problems: string[] = [];
  for (const [table, columns] of Object.entries(REQUIRED_SCHEMA)) {
    const have = present.get(table);
    if (!have) {
      problems.push(`table ${table} is missing`);
      continue;
    }
    const missing = columns.filter(c => !have.has(c));
    if (missing.length > 0) problems.push(`${table} is missing column${missing.length > 1 ? 's' : ''} ${missing.join(', ')}`);
  }
  return problems;
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

export async function loadState(q: Queryable, plan: Plan): Promise<DbState> {
  const owners = (await q.query<Row>(`SELECT id, name FROM owners ORDER BY name`)).rows.map(
    (r): OwnerRow => ({ id: Number(r.id), name: String(r.name) }),
  );

  const properties = (await q.query<Row>(`SELECT id, name, letting_type FROM properties ORDER BY name`)).rows.map(
    (r): PropertyRow => ({
      id: Number(r.id),
      name: String(r.name),
      lettingType: (r.letting_type === 'rent_a_room' ? 'rent_a_room' : 'standard') as LettingType,
    }),
  );

  const ownership = (
    await q.query<Row>(
      `SELECT po.property_id, po.owner_id, o.name AS owner_name, a.name AS capital_account
         FROM property_ownership po
         JOIN owners o   ON o.id = po.owner_id
         JOIN accounts a ON a.id = po.capital_account_id
        ORDER BY po.property_id, o.name`,
    )
  ).rows.map(
    (r): OwnershipRow => ({
      propertyId: Number(r.property_id),
      ownerId: Number(r.owner_id),
      ownerName: String(r.owner_name),
      capitalAccount: String(r.capital_account),
    }),
  );

  const allocationRules = (
    await q.query<Row>(
      `SELECT property_id, owner_id, allocation_pct::text AS allocation_pct, expense_type
         FROM expense_allocation_rules ORDER BY property_id, owner_id, expense_type`,
    )
  ).rows.map(
    (r): AllocationRuleRow => ({
      propertyId: Number(r.property_id),
      ownerId: Number(r.owner_id),
      allocationPct: String(r.allocation_pct),
      expenseType: String(r.expense_type),
    }),
  );

  const accounts = (
    await q.query<Row>(`SELECT id, name, account_type::text AS account_type, is_system, owner_id FROM accounts ORDER BY name`)
  ).rows.map(
    (r): AccountRow => ({
      id: Number(r.id),
      name: String(r.name),
      accountType: String(r.account_type) as AccountType,
      isSystem: Boolean(r.is_system),
      ownerId: r.owner_id === null ? null : Number(r.owner_id),
    }),
  );

  const categories = (await q.query<Row>(`SELECT id, name, parent_id FROM categories ORDER BY id`)).rows.map(
    (r): CategoryRow => ({
      id: Number(r.id),
      name: String(r.name),
      parentId: r.parent_id === null ? null : Number(r.parent_id),
    }),
  );

  // Properties whose ledger we need: the plan's, plus everything the owner
  // has a stake in, so the owner-level totals are complete.
  const owner = owners.find(o => o.name === plan.owner);
  const planPropertyIds = plan.properties
    .map(s => properties.find(p => p.name === s.name)?.id)
    .filter((id): id is number => id !== undefined);
  const ownedIds = owner ? ownership.filter(o => o.ownerId === owner.id).map(o => o.propertyId) : [];
  const propertyIds = [...new Set([...planPropertyIds, ...ownedIds])].sort((a, b) => a - b);

  let tenancies: TenancyRow[] = [];
  let mortgages: MortgageRow[] = [];
  let taggedLines: LedgerLine[] = [];
  let candidateLines: LedgerLine[] = [];

  const windowDays = plan.dedupe.windowDays;
  const range = taxYearRange(plan.taxYear);

  if (propertyIds.length > 0) {
    tenancies = (
      await q.query<Row>(
        `SELECT id, property_id, tenant_name, start_date, end_date, rent_amount::text AS rent_amount,
                rent_frequency::text AS rent_frequency, deposit_amount::text AS deposit_amount, notes
           FROM tenancies
          WHERE property_id IN (${placeholders(propertyIds.length)})
          ORDER BY property_id, start_date, id`,
        propertyIds,
      )
    ).rows.map(
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

    mortgages = (
      await q.query<Row>(
        `SELECT id, property_id, lender, interest_only FROM mortgages
          WHERE property_id IN (${placeholders(propertyIds.length)}) ORDER BY property_id, id`,
        propertyIds,
      )
    ).rows.map(
      (r): MortgageRow => ({
        id: Number(r.id),
        propertyId: Number(r.property_id),
        lender: String(r.lender),
        interestOnly: Boolean(r.interest_only),
      }),
    );

    // Tagged ledger lines for the year, widened by the dedupe window so
    // items near the year boundary still see their neighbours.
    taggedLines = (
      await q.query<Row>(
        `${LINE_SELECT}
          WHERE je.property_id IN (${placeholders(propertyIds.length)})
            AND je.date >= $${propertyIds.length + 1}::text AND je.date <= $${propertyIds.length + 2}::text
            AND a.account_type IN ('INCOME', 'EXPENSE')
          ORDER BY je.date, je.id, be.id`,
        [...propertyIds, addDays(range.startDate, -windowDays), addDays(range.endDate, windowDays)],
      )
    ).rows.map(mapLine);

    // Untagged / other-property lines that could be the same real-world
    // payment as a plan item: matched in SQL on amount and date window so we
    // never pull a whole year of unrelated transactions.
    const journalItems = plan.properties.flatMap(s => [...s.income, ...s.expenses, ...s.mortgageInterest]).filter(i => i.include);
    if (journalItems.length > 0) {
      const amounts = [
        ...new Set(
          journalItems.flatMap(i => [i.amount as string, ...('alternateAmounts' in i ? i.alternateAmounts : [])]),
        ),
      ];
      const dates = journalItems.map(i => i.date).sort();
      const from = addDays(dates[0], -windowDays);
      const to = addDays(dates[dates.length - 1], windowDays);
      const params: unknown[] = [from, to, ...propertyIds, ...amounts];
      const propPlaceholders = placeholders(propertyIds.length, 3);
      const amountPlaceholders = placeholders(amounts.length, 3 + propertyIds.length, '::numeric');
      candidateLines = (
        await q.query<Row>(
          `${LINE_SELECT}
            WHERE (je.property_id IS NULL OR je.property_id NOT IN (${propPlaceholders}))
              AND je.date >= $1::text AND je.date <= $2::text
              AND a.account_type IN ('INCOME', 'EXPENSE')
              AND ABS(be.amount::numeric) IN (${amountPlaceholders})
            ORDER BY je.date, je.id, be.id`,
          params,
        )
      ).rows.map(mapLine);
    }
  }

  const referencedJournals = (
    await q.query<Row>(
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
    )
  ).rows.map(
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

  let taxProfile: TaxProfileRow | null = null;
  if (owner) {
    const cols = TAX_PROFILE_FIELDS.map(f => `${PROFILE_FIELD_COLUMNS[f]}::text AS ${PROFILE_FIELD_COLUMNS[f]}`).join(', ');
    const rows = (
      await q.query<Row>(
        `SELECT ${cols}, notes FROM owner_tax_profiles WHERE owner_id = $1::integer AND tax_year = $2::text`,
        [owner.id, plan.taxYear],
      )
    ).rows;
    if (rows[0]) {
      const values = {} as TaxProfileRow['values'];
      for (const f of TAX_PROFILE_FIELDS) values[f] = String(rows[0][PROFILE_FIELD_COLUMNS[f]]);
      taxProfile = {
        ownerId: owner.id,
        taxYear: plan.taxYear,
        values,
        notes: rows[0].notes === null ? null : String(rows[0].notes),
      };
    }
  }

  return {
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
}
