import { PROFILE_FIELD_COLUMNS, type TaxProfileField } from './schema';
import type { Change, TenancyUpdatable } from './types';

/**
 * The only SQL the loader writes. Every statement is an INSERT or an UPDATE
 * guarded so a re-run (or a concurrent writer) cannot create a duplicate or
 * silently overwrite something unexpected. There is deliberately no DELETE,
 * TRUNCATE or DROP anywhere in this module; a unit test enforces that.
 *
 * Parameters are always passed separately from the SQL text and cast
 * explicitly (`$1::integer`) so the statements type-check the same way
 * under the pg and Neon drivers.
 */

export interface QueryResult<R> {
  rows: R[];
  rowCount: number | null;
}

/** The tiny driver interface both pg and the Neon client are wrapped to. */
export interface Queryable {
  query<R extends object = Record<string, unknown>>(text: string, params?: unknown[]): Promise<QueryResult<R>>;
}

export const TENANCY_COLUMNS: Record<TenancyUpdatable, { column: string; cast: string }> = {
  tenantName: { column: 'tenant_name', cast: 'text' },
  endDate: { column: 'end_date', cast: 'text' },
  rentAmount: { column: 'rent_amount', cast: 'numeric' },
  rentFrequency: { column: 'rent_frequency', cast: 'rent_frequency' },
  depositAmount: { column: 'deposit_amount', cast: 'numeric' },
  notes: { column: 'notes', cast: 'text' },
};

function expectOne(rows: unknown[], what: string): void {
  if (rows.length !== 1) {
    throw new Error(`${what}: expected exactly one row to change, got ${rows.length}. Nothing has been committed.`);
  }
}

export async function applyChange(q: Queryable, change: Change): Promise<void> {
  switch (change.type) {
    case 'letting_type': {
      const r = await q.query(
        `UPDATE properties SET letting_type = $1::text
          WHERE id = $2::integer AND letting_type = $3::text
          RETURNING id`,
        [change.to, change.propertyId, change.from],
      );
      expectOne(r.rows, `letting_type of ${change.propertyName}`);
      return;
    }

    case 'tenancy_create': {
      const v = change.values;
      const r = await q.query(
        `INSERT INTO tenancies
           (property_id, tenant_name, start_date, end_date, rent_amount, rent_frequency, deposit_amount, notes)
         SELECT $1::integer, $2::text, $3::text, $4::text, $5::numeric, $6::rent_frequency, $7::numeric, $8::text
          WHERE NOT EXISTS (SELECT 1 FROM tenancies WHERE property_id = $1::integer AND start_date = $3::text)
         RETURNING id`,
        [change.propertyId, v.tenantName, v.startDate, v.endDate, v.rentAmount, v.rentFrequency, v.depositAmount, v.notes],
      );
      expectOne(r.rows, `tenancy starting ${v.startDate} at ${change.propertyName}`);
      return;
    }

    case 'tenancy_update': {
      const fields = Object.keys(change.set) as TenancyUpdatable[];
      if (fields.length === 0) return;
      const params: unknown[] = [];
      const assignments = fields.map(f => {
        const col = TENANCY_COLUMNS[f];
        params.push(change.set[f] ?? null);
        return `${col.column} = $${params.length}::${col.cast}`;
      });
      params.push(change.tenancyId, change.propertyId, change.startDate);
      const n = params.length;
      const r = await q.query(
        `UPDATE tenancies SET ${assignments.join(', ')}
          WHERE id = $${n - 2}::integer AND property_id = $${n - 1}::integer AND start_date = $${n}::text
          RETURNING id`,
        params,
      );
      expectOne(r.rows, `tenancy #${change.tenancyId}`);
      return;
    }

    case 'journal_create': {
      const inserted = await q.query<{ id: number }>(
        `INSERT INTO journal_entries (date, description, reference, category_id, property_id)
         SELECT $1::text, $2::text, $3::text, $4::integer, $5::integer
          WHERE NOT EXISTS (SELECT 1 FROM journal_entries WHERE reference = $3::text)
         RETURNING id`,
        [change.date, change.description, change.reference, change.categoryId, change.propertyId],
      );
      expectOne(inserted.rows, `journal ${change.reference} (reference already exists?)`);
      const journalId = inserted.rows[0].id;
      for (const leg of change.legs) {
        await q.query(
          `INSERT INTO book_entries (journal_entry_id, account_id, amount)
           VALUES ($1::integer, $2::integer, $3::numeric)`,
          [journalId, leg.accountId, leg.amount],
        );
      }
      return;
    }

    case 'journal_tag': {
      const r = await q.query(
        `UPDATE journal_entries
            SET property_id = $1::integer,
                category_id = COALESCE(category_id, $2::integer)
          WHERE id = $3::integer AND property_id IS NULL
          RETURNING id`,
        [change.propertyId, change.setCategoryId, change.journalId],
      );
      expectOne(r.rows, `tag journal #${change.journalId} (already tagged by someone else?)`);
      return;
    }

    case 'tax_profile': {
      const fields = Object.keys(change.set) as TaxProfileField[];
      const columns: string[] = ['owner_id', 'tax_year'];
      const params: unknown[] = [change.ownerId, change.taxYear];
      const casts: string[] = ['integer', 'text'];
      const updates: string[] = [];
      for (const f of fields) {
        const column = PROFILE_FIELD_COLUMNS[f];
        columns.push(column);
        params.push(change.set[f]);
        casts.push('numeric');
        updates.push(`${column} = EXCLUDED.${column}`);
      }
      if (change.notes !== null) {
        columns.push('notes');
        params.push(change.notes);
        casts.push('text');
        updates.push('notes = EXCLUDED.notes');
      }
      updates.push('updated_at = now()');
      const values = params.map((_, i) => `$${i + 1}::${casts[i]}`).join(', ');
      const r = await q.query(
        `INSERT INTO owner_tax_profiles (${columns.join(', ')})
         VALUES (${values})
         ON CONFLICT (owner_id, tax_year) DO UPDATE SET ${updates.join(', ')}
         RETURNING id`,
        params,
      );
      expectOne(r.rows, `owner tax profile ${change.taxYear}`);
      return;
    }
  }
}

/** Stable application order: letting types, tenancies, then journals by date, then the profile. */
export function orderForApply(changes: readonly Change[]): Change[] {
  const rank: Record<Change['type'], number> = {
    letting_type: 0,
    tenancy_create: 1,
    tenancy_update: 1,
    journal_tag: 2,
    journal_create: 3,
    tax_profile: 4,
  };
  return [...changes].sort((a, b) => {
    if (rank[a.type] !== rank[b.type]) return rank[a.type] - rank[b.type];
    const da = 'date' in a ? a.date : '';
    const db = 'date' in b ? b.date : '';
    if (da !== db) return da < db ? -1 : 1;
    const ia = 'itemId' in a ? a.itemId : a.itemIds.join(',');
    const ib = 'itemId' in b ? b.itemId : b.itemIds.join(',');
    return ia < ib ? -1 : ia > ib ? 1 : 0;
  });
}
