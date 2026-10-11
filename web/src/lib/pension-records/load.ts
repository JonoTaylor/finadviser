import { sql } from 'drizzle-orm';
import { getDb } from '@/lib/db';
import { accountBalanceAsOf } from '@/lib/db/account-balance-as-of';
import { londonTodayIso } from '@/lib/dates/today';
import { propertyRepo } from '@/lib/repos';
import { readWorkspace } from '@/lib/finance-workspace/store';
import { PENSION_RECORDS_KEY, pensionRecordsDataSchema, type PensionAccount } from './schema';
import { summarizePensionRecords } from './summary';

export async function loadPensionRecordReferences() {
  const asOf = londonTodayIso();
  const [owners, accountRows] = await Promise.all([
    propertyRepo.listOwners(),
    getDb().execute(sql`
      SELECT a.id, a.name, a.owner_id, o.name AS owner_name,
             ${accountBalanceAsOf(asOf)} AS balance
      FROM accounts a
      LEFT JOIN owners o ON o.id = a.owner_id
      LEFT JOIN v_account_balances v ON v.account_id = a.id
      WHERE a.account_type = 'ASSET' AND a.is_investment = true AND a.investment_kind = 'pension'
      ORDER BY a.name
    `),
  ]);
  const pensionAccounts: PensionAccount[] = accountRows.rows.map(row => ({
    id: Number(row.id), name: String(row.name), ownerId: row.owner_id === null ? null : Number(row.owner_id),
    ownerName: row.owner_name === null ? null : String(row.owner_name), balance: String(row.balance), balanceAsOf: asOf,
  }));
  return { owners: owners.map(owner => ({ id: owner.id, name: owner.name })), pensionAccounts };
}

export async function loadPensionRecordsWorkspace() {
  const [workspace, references] = await Promise.all([
    readWorkspace(PENSION_RECORDS_KEY, pensionRecordsDataSchema, []),
    loadPensionRecordReferences(),
  ]);
  return { workspace, ...references, summary: summarizePensionRecords(workspace.data, references.pensionAccounts) };
}

export type PensionRecordsWorkspace = Awaited<ReturnType<typeof loadPensionRecordsWorkspace>>;
