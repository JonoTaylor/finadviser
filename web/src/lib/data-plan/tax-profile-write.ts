import { PROFILE_FIELD_COLUMNS, TAX_PROFILE_FIELDS, type TaxProfileField } from './schema';
import type { Change, TaxProfileRow } from './types';

/** Legacy non-zero inputs have evidence; legacy zero defaults do not. */
export function knownProfileFields(profile: TaxProfileRow): TaxProfileField[] {
  return profile.knownFields ?? TAX_PROFILE_FIELDS.filter(field => Number(profile.values[field]) !== 0);
}

/** Shared by the interactive and HTTP writers so every profile write obeys CAS. */
export function taxProfileWriteSql(c: Extract<Change, { type: 'tax_profile' }>, p: { add(value: unknown): string }): string {
  const fields = Object.keys(c.set) as TaxProfileField[];
  const columns = ['owner_id', 'tax_year'];
  const values = [`${p.add(c.ownerId)}::integer`, `${p.add(c.taxYear)}::text`];
  const updates: string[] = [];
  for (const field of fields) {
    const column = PROFILE_FIELD_COLUMNS[field];
    columns.push(column);
    values.push(`${p.add(c.set[field])}::numeric`);
    updates.push(`${column} = EXCLUDED.${column}`);
  }
  if (c.notes !== null) {
    columns.push('notes');
    values.push(`${p.add(c.notes)}::text`);
    updates.push('notes = EXCLUDED.notes');
  }
  const revision = c.existed ? p.add(c.expectedRevision) : null;
  const knownFields = `${p.add(JSON.stringify(fields))}::jsonb`;
  const timestamp = `to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`;
  const source = (names: string, origin: 'user' | 'legacy', date = timestamp) =>
    `(SELECT COALESCE(jsonb_object_agg(field, jsonb_build_object('source', '${origin}', 'updatedAt', ${date})), '{}'::jsonb)
        FROM jsonb_array_elements_text(${names}) AS supplied(field))`;
  const legacyKnown = `to_jsonb(array_remove(ARRAY[${TAX_PROFILE_FIELDS.map(field =>
    `CASE WHEN owner_tax_profiles.${PROFILE_FIELD_COLUMNS[field]} <> 0 THEN '${field}'::text END`).join(', ')}], NULL))`;
  columns.push('known_fields', 'field_sources', 'revision');
  values.push(knownFields, source(knownFields, 'user'), '1');
  updates.push(
    `known_fields = (SELECT COALESCE(jsonb_agg(DISTINCT field ORDER BY field), '[]'::jsonb)
      FROM jsonb_array_elements_text(COALESCE(owner_tax_profiles.known_fields, ${legacyKnown}) || EXCLUDED.known_fields) AS known(field))`,
    `field_sources = CASE WHEN owner_tax_profiles.known_fields IS NULL
      THEN ${source(legacyKnown, 'legacy', `to_char(owner_tax_profiles.updated_at, 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`)}
      ELSE '{}'::jsonb END || owner_tax_profiles.field_sources || EXCLUDED.field_sources`,
    'revision = owner_tax_profiles.revision + 1',
    'updated_at = now()',
  );
  if (c.existed) {
    const supplied = Object.fromEntries(columns.map((column, index) => [column, values[index]]));
    return `UPDATE owner_tax_profiles SET ${updates.join(', ').replace(/EXCLUDED\.([a-z_]+)/g, (_, column: string) => supplied[column])}
      WHERE owner_id = ${values[0]} AND tax_year = ${values[1]} AND revision = ${revision}::integer
      RETURNING id`;
  }
  return `INSERT INTO owner_tax_profiles (${columns.join(', ')})
    VALUES (${values.join(', ')})
    ON CONFLICT (owner_id, tax_year) DO NOTHING
    RETURNING id`;
}
