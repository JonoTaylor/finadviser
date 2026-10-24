import { randomBytes } from 'node:crypto';
import { Client, Pool } from 'pg';
import { PgDialect } from 'drizzle-orm/pg-core';
import type { SQL } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildMerchantResearchQuery } from './privacy';
import type { MerchantResearchQuery, MerchantResearchResult } from './types';

const mocks = vi.hoisted(() => ({ execute: vi.fn() }));
vi.mock('@/lib/db', () => ({ getDb: () => ({ execute: mocks.execute }) }));
import { merchantCacheSlot, merchantResearchRepo } from './repository';

const url = process.env.DATA_PLAN_TEST_PG_URL;
const query = buildMerchantResearchQuery({ merchantName: 'Tesco' })!;
const evidence = (publicQuery: MerchantResearchQuery = query): MerchantResearchResult => ({
  status: 'matched', query: publicQuery.query,
  sources: [{ title: 'Public business directory', url: 'https://www.tesco.com/', snippet: 'Synthetic merchant identity fixture.', retrievedAt: '2026-10-24T12:00:00.000Z' }],
  researchedAt: '2026-10-24T12:00:00.000Z', provider: 'gateway_perplexity', scope: 'merchant_identity_only',
});

describe.skipIf(!url)('public merchant cache in disposable PostgreSQL', () => {
  const schema = `merchant_research_test_${randomBytes(8).toString('hex')}`;
  let fixture: Client;
  let pool: Pool;

  beforeAll(async () => {
    fixture = new Client({ connectionString: url });
    await fixture.connect();
    await fixture.query(`CREATE SCHEMA "${schema}"`);
    await fixture.query(`SET search_path TO "${schema}", public`);
    await fixture.query(`CREATE TABLE merchant_research_cache (
      cache_slot integer PRIMARY KEY CHECK (cache_slot >= 0 AND cache_slot < 2048),
      query_key text NOT NULL, result jsonb NOT NULL, expires_at timestamptz NOT NULL,
      updated_at timestamptz NOT NULL DEFAULT now()
    )`);
    pool = new Pool({ connectionString: url, max: 4, options: `-c search_path=${schema},public` });
    const dialect = new PgDialect();
    mocks.execute.mockImplementation((statement: SQL) => {
      const rendered = dialect.sqlToQuery(statement);
      return pool.query(rendered.sql, rendered.params);
    });
  });

  afterAll(async () => {
    await pool?.end();
    if (fixture) {
      await fixture.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      await fixture.end();
    }
  });
  beforeEach(async () => { await fixture.query('TRUNCATE merchant_research_cache'); });

  it('round trips only public query evidence with its original retrieval time and a finite TTL', async () => {
    expect(await merchantResearchRepo.save(query, evidence())).toBe(true);
    expect(await merchantResearchRepo.find(query)).toEqual(evidence());
    const stored = (await fixture.query('SELECT *, extract(epoch FROM expires_at - now()) AS ttl FROM merchant_research_cache')).rows[0];
    expect(Number(stored.ttl)).toBeGreaterThan(86300);
    expect(Number(stored.ttl)).toBeLessThanOrEqual(86400);
    expect(Object.keys(stored.result).sort()).toEqual(['provider', 'query', 'researchedAt', 'scope', 'sources', 'status']);
  });

  it('does not reuse expired sources', async () => {
    await merchantResearchRepo.save(query, evidence());
    await fixture.query("UPDATE merchant_research_cache SET expires_at = now() - interval '1 second'");
    expect(await merchantResearchRepo.find(query)).toBeNull();
  });

  it('shares merchant casing variants while preserving the actual original search query', async () => {
    await merchantResearchRepo.save(query, evidence());
    const variant = buildMerchantResearchQuery({ merchantName: 'TESCO' })!;
    expect(variant.cacheKey).toBe(query.cacheKey);
    expect(await merchantResearchRepo.find(variant)).toEqual(evidence());
  });

  it('caches no matches briefly and never caches transient provider failures', async () => {
    const missing: MerchantResearchResult = { ...evidence(), status: 'no_matches', sources: [] };
    expect(await merchantResearchRepo.save(query, missing)).toBe(true);
    const ttl = Number((await fixture.query('SELECT extract(epoch FROM expires_at - now()) AS ttl FROM merchant_research_cache')).rows[0].ttl);
    expect(ttl).toBeGreaterThan(850);
    expect(ttl).toBeLessThanOrEqual(900);
    expect(await merchantResearchRepo.save(query, { ...missing, status: 'timed_out' })).toBe(false);
    expect(await merchantResearchRepo.find(query)).toEqual(missing);
  });

  it('rejects mismatched queries and malicious cached URLs on both write and read', async () => {
    expect(await merchantResearchRepo.save(query, { ...evidence(), query: 'Asda business merchant' })).toBe(false);
    expect(await merchantResearchRepo.save({ ...query, query: 'private ref 123456' }, evidence())).toBe(false);
    expect(await merchantResearchRepo.save(query, { ...evidence(), sources: [{ ...evidence().sources[0], url: 'https://127.0.0.1/' }] })).toBe(false);
    await merchantResearchRepo.save(query, evidence());
    await fixture.query(`UPDATE merchant_research_cache SET result = jsonb_set(result, '{sources,0,url}', '"javascript:alert(1)"'::jsonb)`);
    expect(await merchantResearchRepo.find(query)).toBeNull();
  });

  it('handles concurrent slot collisions by eviction without misattributing another merchant', async () => {
    const bySlot = new Map<number, MerchantResearchQuery>();
    let collision: [MerchantResearchQuery, MerchantResearchQuery] | null = null;
    for (let index = 0; index < 4096; index++) {
      const candidate = buildMerchantResearchQuery({ merchantName: `Synthetic Retailer ${index}` })!;
      const slot = merchantCacheSlot(candidate.cacheKey);
      const previous = bySlot.get(slot);
      if (previous) { collision = [previous, candidate]; break; }
      bySlot.set(slot, candidate);
    }
    expect(collision).not.toBeNull();
    const [first, second] = collision!;
    await Promise.all([merchantResearchRepo.save(first, evidence(first)), merchantResearchRepo.save(second, evidence(second))]);
    const reads = await Promise.all([merchantResearchRepo.find(first), merchantResearchRepo.find(second)]);
    expect(reads.filter(Boolean)).toHaveLength(1);
    expect((await fixture.query('SELECT COUNT(*)::integer AS count FROM merchant_research_cache')).rows[0].count).toBe(1);
    expect(reads[0] === null || reads[0].query === first.query).toBe(true);
    expect(reads[1] === null || reads[1].query === second.query).toBe(true);
  });
});
