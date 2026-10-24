import { sql } from 'drizzle-orm';
import { getDb } from '@/lib/db';
import { buildMerchantResearchQuery } from './privacy';
import { merchantResearchResultSchema } from './schema';
import type { MerchantResearchResult } from './types';

type PublicQuery = NonNullable<ReturnType<typeof buildMerchantResearchQuery>>;
export const MERCHANT_CACHE_SLOTS = 2048;
const MATCHED_TTL_MS = 24 * 60 * 60 * 1000;
const NO_MATCHES_TTL_MS = 15 * 60 * 1000;

function validateQuery(query: PublicQuery): boolean {
  const rebuilt = buildMerchantResearchQuery({ merchantName: query.merchantName, coarseLocation: query.coarseLocation });
  return rebuilt !== null && rebuilt.cacheKey === query.cacheKey && rebuilt.query === query.query;
}

/** Hash collisions evict a cache entry; the full key must still match on reads. */
export function merchantCacheSlot(cacheKey: string): number {
  if (!/^[a-f0-9]{64}$/.test(cacheKey)) throw new Error('Invalid public merchant cache key.');
  return Number.parseInt(cacheKey.slice(0, 8), 16) % MERCHANT_CACHE_SLOTS;
}

export const merchantResearchRepo = {
  async find(query: PublicQuery): Promise<MerchantResearchResult | null> {
    if (!validateQuery(query)) return null;
    const response = await getDb().execute(sql`
      SELECT result FROM merchant_research_cache
      WHERE cache_slot = ${merchantCacheSlot(query.cacheKey)} AND query_key = ${query.cacheKey}
        AND expires_at > now()
    `);
    const parsed = merchantResearchResultSchema.safeParse(response.rows[0]?.result);
    if (!parsed.success || parsed.data.query?.toLocaleLowerCase('en-GB') !== query.query.toLocaleLowerCase('en-GB')
      || !['matched', 'no_matches'].includes(parsed.data.status)) return null;
    return parsed.data;
  },

  async save(query: PublicQuery, result: MerchantResearchResult): Promise<boolean> {
    if (!validateQuery(query)) return false;
    const parsed = merchantResearchResultSchema.safeParse(result);
    if (!parsed.success || parsed.data.query !== query.query
      || !['matched', 'no_matches'].includes(parsed.data.status)) return false;
    const ttl = parsed.data.status === 'matched' ? MATCHED_TTL_MS : NO_MATCHES_TTL_MS;
    // A direct-mapped cache has a strict size limit even under concurrent
    // serverless writes. It contains public search results, never ledger data.
    await getDb().execute(sql`
      INSERT INTO merchant_research_cache (cache_slot, query_key, result, expires_at, updated_at)
      VALUES (${merchantCacheSlot(query.cacheKey)}, ${query.cacheKey}, ${JSON.stringify(parsed.data)}::jsonb,
        now() + (${ttl} * interval '1 millisecond'), now())
      ON CONFLICT (cache_slot) DO UPDATE SET query_key = EXCLUDED.query_key,
        result = EXCLUDED.result, expires_at = EXCLUDED.expires_at, updated_at = now()
    `);
    return true;
  },
};
