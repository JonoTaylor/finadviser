import { sql, type SQL } from 'drizzle-orm';
import { BANK_PAYEE_PATTERN } from './matching';

function alias(value: string): SQL {
  if (!/^[a-z][a-z0-9_]*$/.test(value)) throw new Error('Invalid payee SQL alias.');
  return sql.raw(value);
}
export function normalizedPayeeSql(value: SQL): SQL {
  return sql`lower(btrim(regexp_replace(normalize(${value}, NFKC), '\\s+', ' ', 'g')))`;
}

/** Shared SQL/JS identity rules; an active matching alias is never a substring. */
export function payeeCandidateMatchSql(memoryAlias = 'pm', journalAlias = 'je'): SQL {
  const memory = alias(memoryAlias), journal = alias(journalAlias);
  const identity = sql`CASE ${memory}.identity_kind
    WHEN 'merchant' THEN (SELECT merchant_name FROM transaction_metadata WHERE journal_entry_id = ${journal}.id)
    WHEN 'description' THEN CASE WHEN char_length(${journal}.description) <= 200 THEN ${journal}.description ELSE NULL END
    WHEN 'bank_payee' THEN CASE WHEN lower(btrim(regexp_replace(COALESCE((SELECT transaction_type FROM transaction_metadata WHERE journal_entry_id = ${journal}.id), ''), '[_-]+', ' ', 'g')))
      IN ('bank transfer', 'faster payment', 'faster payments', 'bacs', 'standing order', 'payment')
      AND (SELECT count(*) FROM regexp_matches(${journal}.description, '\\mREF(?:ERENCE)?[.:]?(?=\\s)', 'gi')) = 1
      THEN (regexp_match(btrim(${journal}.description), ${BANK_PAYEE_PATTERN}, 'i'))[1] ELSE NULL END
    ELSE NULL END`;
  // accounts.account_type is a native enum; the saved scope stores text.
  return sql`${memory}.status = 'active'
    AND ${journal}.property_id IS NOT DISTINCT FROM ${memory}.property_id
    AND upper(NULLIF(btrim((SELECT currency FROM transaction_metadata WHERE journal_entry_id = ${journal}.id)), '')) IS NOT DISTINCT FROM ${memory}.currency
    AND (SELECT count(*) FROM book_entries pbe JOIN accounts pa ON pa.id = pbe.account_id
      WHERE pbe.journal_entry_id = ${journal}.id AND pa.account_type IN ('ASSET', 'LIABILITY')) = 1
    AND EXISTS (SELECT 1 FROM book_entries pbe JOIN accounts pa ON pa.id = pbe.account_id
      WHERE pbe.journal_entry_id = ${journal}.id AND pa.id = ${memory}.account_id
        AND pa.account_type::text = ${memory}.account_type AND pa.owner_id IS NOT DISTINCT FROM ${memory}.owner_id
        AND sign(pbe.amount) = ${memory}.direction AND pbe.amount <> 0)
    AND EXISTS (SELECT 1 FROM categorization_payee_aliases p_alias WHERE p_alias.memory_id = ${memory}.id
      AND p_alias.active = TRUE AND p_alias.identity_kind = ${memory}.identity_kind
      AND p_alias.normalized_alias = ${normalizedPayeeSql(identity)})`;
}

/** A later changed confirmation, transfer link or source scope invalidates reuse. */
export function payeeSourceValiditySql(memoryAlias = 'pm'): SQL {
  const memory = alias(memoryAlias);
  return sql`EXISTS (SELECT 1 FROM journal_entries payee_source
    WHERE payee_source.id = ${memory}.source_journal_id AND payee_source.category_id = ${memory}.category_id
      AND COALESCE(payee_source.is_transfer, FALSE) = FALSE
      AND payee_source.transfer_group_id IS NULL AND payee_source.transfer_partner_journal_id IS NULL
      AND ${payeeCandidateMatchSql(memoryAlias, 'payee_source')})`;
}
