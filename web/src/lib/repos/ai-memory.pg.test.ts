import { Client } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({ db: null as unknown }));
vi.mock('@/lib/db', async () => ({
  getDb: () => state.db,
  schema: await import('@/lib/db/schema'),
}));
import { aiMemoryRepo } from './ai-memory.repo';

const url = process.env.DATA_PLAN_TEST_PG_URL;
describe.skipIf(!url)('persistent adviser memories in PostgreSQL', () => {
  let client: Client;
  beforeAll(async () => {
    client = new Client({ connectionString: url });
    await client.connect();
    await client.query(`CREATE TEMP TABLE ai_memories (
      id serial PRIMARY KEY, content text NOT NULL, source text NOT NULL,
      created_at timestamp NOT NULL DEFAULT now()
    )`);
    state.db = drizzle(client);
  });
  afterAll(async () => { await client?.end(); });
  beforeEach(async () => { await client.query('TRUNCATE ai_memories RESTART IDENTITY'); });

  it('persists confirmed facts across reads and corrects them without duplicate contradictory memories', async () => {
    const saved = await aiMemoryRepo.add('Employee pension is 8%; employer matches 8%. Method unknown.', 'ai');
    const corrected = await aiMemoryRepo.update(saved.id, 'Employee pension is 10%; employer matches 8%. Method unknown.', saved.content);
    expect(corrected).toMatchObject({ id: saved.id, source: 'user' });
    expect(await aiMemoryRepo.list()).toHaveLength(1);
    expect(await aiMemoryRepo.renderForPrompt()).toContain('Employee pension is 10%');
    expect(await aiMemoryRepo.renderForPrompt()).not.toContain('Employee pension is 8%');
  });

  it('allows only one correction against the same saved content', async () => {
    const saved = await aiMemoryRepo.add('Annual salary is £95,000.', 'ai');
    const results = await Promise.all([
      aiMemoryRepo.update(saved.id, 'Annual salary is £100,000.', saved.content, 'ai'),
      aiMemoryRepo.update(saved.id, 'Annual salary is £105,000.', saved.content, 'ai'),
    ]);
    expect(results.filter(Boolean)).toHaveLength(1);
    expect((await aiMemoryRepo.list())[0].content).toBe('Annual salary is £100,000.');
  });

  it('does not recreate a forgotten fact and rejects empty corrections', async () => {
    const saved = await aiMemoryRepo.add('Bonus is estimated at 30% of base.', 'ai');
    await aiMemoryRepo.delete(saved.id);
    expect(await aiMemoryRepo.update(saved.id, 'Updated bonus.', saved.content)).toBeNull();
    await expect(aiMemoryRepo.update(saved.id, '   ', saved.content)).rejects.toThrow();
    expect(await aiMemoryRepo.list()).toEqual([]);
  });
});
