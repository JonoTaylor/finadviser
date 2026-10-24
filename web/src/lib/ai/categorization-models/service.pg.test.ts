import { randomBytes } from 'node:crypto';
import { Client, Pool } from 'pg';
import { PgDialect } from 'drizzle-orm/pg-core';
import type { SQL } from 'drizzle-orm';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CatalogModel, GatewayCatalog } from './types';

const mocks = vi.hoisted(() => ({ execute: vi.fn(), get: vi.fn(), catalog: vi.fn(), configured: vi.fn(), evaluate: vi.fn() }));
vi.mock('@/lib/db', async () => ({ getDb: () => ({ execute: mocks.execute }), schema: await import('@/lib/db/schema') }));
vi.mock('@/lib/repos/app-settings.repo', () => ({ appSettingsRepo: { get: mocks.get } }));
vi.mock('./catalog', () => ({
  gatewayEvaluationConfigured: mocks.configured, getEvaluationCatalog: mocks.catalog,
  defaultEvaluationCandidates: (catalog: GatewayCatalog) => catalog.models.map(model => model.id),
}));
vi.mock('./runner', async original => ({ ...await original<typeof import('./runner')>(), evaluateCatalogModel: mocks.evaluate }));
import { CATEGORIZATION_MODEL_POLICY_KEY, maybeEvaluateCategorizationModels } from './service';
import { BENCHMARK_VERSION } from './fixtures';
import { modelEvaluationStateSchema } from './types';

const url = process.env.DATA_PLAN_TEST_PG_URL;
const modelIds = ['openai/gpt-4.1-mini', 'google/gemini-3-flash', 'anthropic/claude-haiku-4.5'];

// Two real database sessions race the workspace claim. Provider calls use
// synthetic completed results so this never needs a Gateway key or user data.
describe.skipIf(!url)('model evaluation claims in disposable PostgreSQL', () => {
  const namespace = `model_evaluation_${randomBytes(8).toString('hex')}`;
  let fixture: Client;
  let pool: Pool;
  let readCount = 0;
  let releases: (() => void)[] = [];
  let barriers: Promise<void>[] = [];

  beforeAll(async () => {
    fixture = new Client({ connectionString: url });
    await fixture.connect();
    await fixture.query(`CREATE SCHEMA "${namespace}"`);
    await fixture.query(`SET search_path TO "${namespace}", public`);
    await fixture.query('CREATE TABLE app_settings (key text PRIMARY KEY, value text NOT NULL, updated_at timestamptz NOT NULL DEFAULT now())');
    pool = new Pool({ connectionString: url, max: 4, options: `-c search_path=${namespace},public` });
    const dialect = new PgDialect();
    mocks.execute.mockImplementation((statement: SQL) => {
      const rendered = dialect.sqlToQuery(statement);
      return pool.query(rendered.sql, rendered.params);
    });
    mocks.get.mockImplementation(async (key: string) => {
      const value = (await pool.query('SELECT value FROM app_settings WHERE key=$1', [key])).rows[0]?.value ?? null;
      if (key === CATEGORIZATION_MODEL_POLICY_KEY && readCount < 4) {
        // Both initial reads, then both writeWorkspace preflight reads, see
        // the same absent row. Only PostgreSQL's CAS can decide the winner.
        const group = Math.floor(readCount / 2);
        readCount++;
        if (readCount % 2 === 0) releases[group]();
        await barriers[group];
      }
      return value;
    });
  });

  beforeEach(async () => {
    vi.clearAllMocks();
    vi.stubEnv('CATEGORIZATION_MODEL_ID', '');
    readCount = 0;
    releases = [];
    barriers = [0, 1].map(() => new Promise<void>(resolve => { releases.push(resolve); }));
    await fixture.query('TRUNCATE app_settings');
    mocks.configured.mockReturnValue(true);
    mocks.catalog.mockResolvedValue({
      status: 'available', observedAt: new Date().toISOString(),
      models: modelIds.map((id, index) => ({ id, name: `Synthetic candidate ${index + 1}`, inputUsdPerMillion: index + 1, outputUsdPerMillion: index + 2 })),
    });
    mocks.evaluate.mockImplementation(async (model: CatalogModel) => ({
      modelId: model.id, status: 'complete', qualified: true, correct: 10, total: 10, unsafeAutoApplied: 0,
      invalidBatches: 0, reviewCount: 5, completedBatches: 2, totalBatches: 2,
      meanLatencyMs: 50, maxLatencyMs: 70, estimatedCostUsd: (modelIds.indexOf(model.id) + 1) / 1000,
    }));
  });

  afterEach(() => vi.unstubAllEnvs());
  afterAll(async () => {
    for (const release of releases) release();
    await pool?.end();
    if (fixture) { await fixture.query(`DROP SCHEMA IF EXISTS "${namespace}" CASCADE`); await fixture.end(); }
  });

  it('evaluates one three-model comparison under concurrent autoruns and reuses the persisted cooldown', async () => {
    const outcomes = await Promise.all([maybeEvaluateCategorizationModels(), maybeEvaluateCategorizationModels()]);
    expect(outcomes.filter(outcome => outcome.status === 'complete')).toHaveLength(1);
    expect(outcomes.filter(outcome => ['running', 'skipped'].includes(outcome.status))).toHaveLength(1);
    expect(mocks.evaluate).toHaveBeenCalledTimes(3);
    expect(new Set(mocks.evaluate.mock.calls.map(call => call[0].id))).toEqual(new Set(modelIds));

    const rows = (await fixture.query('SELECT key,value FROM app_settings')).rows;
    expect(rows).toHaveLength(1);
    expect(rows[0].key).toBe(CATEGORIZATION_MODEL_POLICY_KEY);
    const envelope = JSON.parse(rows[0].value);
    const state = modelEvaluationStateSchema.parse(envelope.data);
    expect(envelope.revision).toBe(2);
    expect(state.running).toBeNull();
    expect(state.selection).toMatchObject({ modelId: modelIds[0], benchmarkVersion: BENCHMARK_VERSION });
    expect(state.lastReport).toMatchObject({ status: 'complete', applied: true, recommendedModelId: modelIds[0] });

    const next = await maybeEvaluateCategorizationModels();
    expect(next.status).toBe('skipped');
    expect(next.report?.id).toBe(state.lastReport?.id);
    expect(mocks.evaluate).toHaveBeenCalledTimes(3);
    expect(JSON.parse((await fixture.query('SELECT value FROM app_settings')).rows[0].value).revision).toBe(2);
  });
});
