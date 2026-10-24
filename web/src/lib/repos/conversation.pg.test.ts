import { Client } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AdviserMessageMetadata } from '@/lib/ai/specialists/contracts';

const state = vi.hoisted(() => ({ db: null as unknown }));
vi.mock('@/lib/db', async () => ({ getDb: () => state.db, schema: await import('@/lib/db/schema') }));
vi.mock('@/lib/repos', async () => ({ conversationRepo: (await import('./conversation.repo')).conversationRepo }));
import { conversationRepo } from './conversation.repo';
import { addAssistantMessage, getHistory, getOrCreateConversation } from '@/lib/ai/conversation-manager';

const metadata: AdviserMessageMetadata = {
  version: 1, specialistMode: 'tax', status: 'complete', specialistResults: [{
    specialistId: 'tax', name: 'Tax specialist', status: 'complete', scope: 'read_only', durationMs: 250,
    modelId: 'fixture-model', promptVersion: '1', message: null,
    sources: [{ id: 'tax-1', tool: 'get_owner_tax_profile', observedAt: '2026-10-24T10:00:00.000Z',
      status: 'available', truncated: false, parameters: { owner_id: 2, tax_year: '2026-27' } }],
    report: { summary: 'The saved profile still needs payroll evidence.', findings: [{ title: 'PAYE missing',
      detail: 'Confirm income tax already deducted before estimating the balance still owed.', priority: 'high', evidenceIds: ['tax-1'] }],
    gaps: [{ field: 'PAYE', why: 'The profile has no confirmed amount paid.' }], actions: [], assumptions: [], warnings: [] },
  }],
};

const url = process.env.DATA_PLAN_TEST_PG_URL;
describe.skipIf(!url)('specialist conversation history in PostgreSQL', () => {
  let client: Client;
  beforeAll(async () => {
    client = new Client({ connectionString: url });
    await client.connect();
    await client.query(`
      CREATE TEMP TABLE ai_conversations (id serial PRIMARY KEY, title text,
        created_at timestamp NOT NULL DEFAULT now(), updated_at timestamp NOT NULL DEFAULT now());
      CREATE TEMP TABLE ai_messages (id serial PRIMARY KEY, conversation_id integer NOT NULL REFERENCES ai_conversations(id),
        role text NOT NULL, content text NOT NULL, created_at timestamp NOT NULL DEFAULT now());
    `);
    const migration = readFileSync('src/lib/db/migration.sql', 'utf8').match(/ALTER TABLE ai_messages ADD COLUMN IF NOT EXISTS metadata JSONB;/)?.[0];
    if (!migration) throw new Error('The additive message metadata migration is missing.');
    await client.query("INSERT INTO ai_conversations(title) VALUES ('Legacy conversation')");
    await client.query("INSERT INTO ai_messages(conversation_id,role,content) VALUES (1,'assistant','Legacy response')");
    await client.query(migration);
    await client.query(migration);
    expect((await client.query('SELECT content,metadata FROM ai_messages')).rows).toEqual([{ content: 'Legacy response', metadata: null }]);
    state.db = drizzle(client);
  });
  afterAll(async () => { await client?.end(); });
  beforeEach(async () => {
    await client.query('TRUNCATE ai_messages, ai_conversations RESTART IDENTITY');
  });

  it('keeps existing messages unlabelled and saves new review evidence with the assistant message', async () => {
    const conversation = await conversationRepo.createConversation('Tax question');
    await conversationRepo.addMessage(conversation.id, 'user', 'What information is missing?');
    await conversationRepo.addMessage(conversation.id, 'assistant', 'Legacy answer without specialist review.');
    const saved = await addAssistantMessage(conversation.id, 'Please confirm PAYE for this year.', metadata);
    expect(saved).toMatchObject({ conversationId: conversation.id, role: 'assistant', content: 'Please confirm PAYE for this year.' });
    expect(saved.createdAt).toBeInstanceOf(Date);
    expect(saved.metadata).toEqual(metadata);
    const history = await conversationRepo.getMessages(conversation.id);
    expect(history.map(message => message.metadata)).toEqual([null, null, metadata]);
    expect(history[2].id).toBe(saved.id);
  });

  it('preserves partial and unavailable evidence when a request was interrupted', async () => {
    const conversation = await conversationRepo.createConversation();
    const interrupted: AdviserMessageMetadata = { ...metadata, specialistMode: 'team', status: 'interrupted',
      specialistResults: [{ ...metadata.specialistResults[0], status: 'unavailable', report: null, sources: [], message: 'Specialist review unavailable.' }] };
    await addAssistantMessage(conversation.id, 'The review was interrupted.', interrupted);
    expect((await conversationRepo.getMessages(conversation.id))[0].metadata).toEqual(interrupted);
  });

  it('rolls back the message and metadata if touching the conversation fails, so a retry saves only once', async () => {
    const conversation = await conversationRepo.createConversation();
    await client.query("UPDATE ai_conversations SET updated_at = '2020-01-01T00:00:00' WHERE id = $1", [conversation.id]);
    await client.query(`
      CREATE OR REPLACE FUNCTION pg_temp.reject_conversation_touch() RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN RAISE EXCEPTION 'fixture touch failure'; END;
      $$;
      CREATE TRIGGER fixture_touch_failure BEFORE UPDATE ON ai_conversations
        FOR EACH ROW EXECUTE FUNCTION pg_temp.reject_conversation_touch();
    `);
    try {
      await expect(addAssistantMessage(conversation.id, 'Review awaiting confirmation.', metadata)).rejects.toThrow();
      expect((await client.query('SELECT count(*) AS count FROM ai_messages')).rows[0].count).toBe('0');
      expect((await client.query('SELECT updated_at FROM ai_conversations WHERE id = $1', [conversation.id])).rows[0].updated_at)
        .toEqual(new Date('2020-01-01T00:00:00Z'));
    } finally {
      await client.query('DROP TRIGGER fixture_touch_failure ON ai_conversations');
    }
    const saved = await addAssistantMessage(conversation.id, 'Review awaiting confirmation.', metadata);
    expect(saved.metadata).toEqual(metadata);
    expect((await conversationRepo.getMessages(conversation.id)).map(message => message.id)).toEqual([saved.id]);
  });

  it('rejects malformed metadata and metadata on user/system messages before writing', async () => {
    const conversation = await conversationRepo.createConversation();
    await expect(conversationRepo.addMessage(conversation.id, 'user', 'User text', metadata)).rejects.toThrow('assistant messages');
    await expect(conversationRepo.addMessage(conversation.id, 'system', 'System text', metadata)).rejects.toThrow('assistant messages');
    await expect(conversationRepo.addMessage(conversation.id, 'assistant', 'Assistant text', { ...metadata, specialistMode: 'invented' } as unknown as AdviserMessageMetadata)).rejects.toThrow('metadata is invalid');
    expect(await conversationRepo.getMessages(conversation.id)).toEqual([]);
  });

  it('does not send stored specialist metadata or system messages back as model instructions', async () => {
    const conversation = await conversationRepo.createConversation();
    await conversationRepo.addMessage(conversation.id, 'system', 'Not conversation history.');
    await conversationRepo.addMessage(conversation.id, 'user', 'Question');
    await addAssistantMessage(conversation.id, 'Answer', metadata);
    expect(await getHistory(conversation.id)).toEqual([{ role: 'user', content: 'Question' }, { role: 'assistant', content: 'Answer' }]);
  });

  it('retains only the last twenty user/assistant messages in model history', async () => {
    const conversation = await conversationRepo.createConversation();
    await client.query(`INSERT INTO ai_messages(conversation_id,role,content)
      SELECT $1, CASE WHEN n % 2 = 0 THEN 'assistant' ELSE 'user' END, 'Message ' || n FROM generate_series(1,25) n`, [conversation.id]);
    const history = await getHistory(conversation.id);
    expect(history).toHaveLength(20);
    expect(history[0].content).toBe('Message 6');
    expect(history.at(-1)?.content).toBe('Message 25');
  });

  it('checks an existing conversation before accepting another message', async () => {
    const conversation = await conversationRepo.createConversation();
    expect(await getOrCreateConversation(conversation.id)).toBe(conversation.id);
    await expect(getOrCreateConversation(9999)).rejects.toMatchObject({ status: 404 });
    await expect(getOrCreateConversation(-1)).rejects.toMatchObject({ status: 400 });
    expect((await conversationRepo.listConversations())).toHaveLength(1);
  });
});
