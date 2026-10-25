import { describe, expect, it, vi } from 'vitest';
import { saveCategoryWithPropertyLink } from './save-category';

type Reply = Response | 'network';
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

/** Answers each request in turn from `replies` (default: success) and records it. */
function server(replies: Record<string, Reply | Reply[]> = {}) {
  const calls: Array<{ method: string; url: string; body?: unknown }> = [];
  const fetchImpl = vi.fn(async (url: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET';
    calls.push({ method, url, body: init?.body ? JSON.parse(String(init.body)) : undefined });
    const key = `${method} ${url}`;
    const queue = replies[key];
    const reply = Array.isArray(queue) ? queue.shift() : queue;
    if (reply === 'network') throw new TypeError('Failed to fetch');
    return reply ?? json({ ok: true });
  });
  return { calls, fetchImpl, steps: () => calls.map(call => `${call.method} ${call.url}`) };
}

const TAG = 'POST /api/properties/journal/41/tag';
const UNTAG = 'POST /api/properties/journal/41/untag';
const CATEGORY = 'PATCH /api/journal/41';
const READ = 'GET /api/journal/41';
const base = { journalId: 41, categoryId: 2, currentCategoryId: 3, createRule: true, description: 'Plumber callout', currentPropertyId: null };

describe('saving a category with a property link', () => {
  it('links the property before saving the category, so a remembered category learns the final property', async () => {
    const { calls, fetchImpl, steps } = server();
    await saveCategoryWithPropertyLink({ ...base, propertyId: 8 }, fetchImpl);
    expect(steps()).toEqual([TAG, CATEGORY]);
    expect(calls[0].body).toEqual({ propertyId: 8 });
    expect(calls[1].body).toEqual({ categoryId: 2, createRule: true, description: 'Plumber callout' });
  });

  it('unlinks first when the user removes a link', async () => {
    const { fetchImpl, steps } = server();
    await saveCategoryWithPropertyLink({ ...base, currentPropertyId: 7, propertyId: null }, fetchImpl);
    expect(steps()).toEqual([UNTAG, CATEGORY]);
  });

  it('only saves the category when the link is unchanged or not offered', async () => {
    for (const propertyId of [undefined, 7]) {
      const { fetchImpl, steps } = server();
      await saveCategoryWithPropertyLink({ ...base, currentPropertyId: 7, propertyId }, fetchImpl);
      expect(steps()).toEqual([CATEGORY]);
    }
  });

  it('changes nothing when the link is refused', async () => {
    const { fetchImpl, steps } = server({ [TAG]: json({ error: 'Property 8 not found' }, 404) });
    await expect(saveCategoryWithPropertyLink({ ...base, propertyId: 8 }, fetchImpl)).rejects.toThrow('nothing was changed. Property 8 not found');
    expect(steps()).toEqual([TAG]);
  });

  it('puts the previous link back when the category is refused', async () => {
    const { calls, fetchImpl, steps } = server({ [CATEGORY]: json({ error: 'Reload the latest transaction details.' }, 409) });
    await expect(saveCategoryWithPropertyLink({ ...base, currentPropertyId: 7, propertyId: 8 }, fetchImpl)).rejects.toThrow('property link was left as it was');
    expect(steps()).toEqual([TAG, CATEGORY, TAG]);
    expect(calls[2].body).toEqual({ propertyId: 7 });
  });

  it('says so plainly if the previous link cannot be put back', async () => {
    const { fetchImpl, steps } = server({ [CATEGORY]: json({ error: 'Conflict' }, 409), [UNTAG]: json({ error: 'down' }, 503) });
    await expect(saveCategoryWithPropertyLink({ ...base, propertyId: 8 }, fetchImpl)).rejects.toThrow('could not be put back');
    expect(steps()).toEqual([TAG, CATEGORY, UNTAG]);
  });

  it('keeps the link when an unconfirmed category save actually landed', async () => {
    const { fetchImpl, steps } = server({ [CATEGORY]: 'network', [READ]: json({ id: 41, categoryId: 2 }) });
    await expect(saveCategoryWithPropertyLink({ ...base, propertyId: 8 }, fetchImpl)).resolves.toBeUndefined();
    expect(steps()).toEqual([TAG, CATEGORY, READ]);
  });

  it('puts the link back when an unconfirmed category save did not land', async () => {
    const { fetchImpl, steps } = server({ [CATEGORY]: json({ error: 'The category save could not be confirmed.' }, 503), [READ]: json({ id: 41, categoryId: 3 }) });
    await expect(saveCategoryWithPropertyLink({ ...base, propertyId: 8 }, fetchImpl)).rejects.toThrow('property link was left as it was');
    expect(steps()).toEqual([TAG, CATEGORY, READ, UNTAG]);
  });

  it('touches nothing more when the outcome cannot be checked', async () => {
    const unreadable = server({ [CATEGORY]: 'network', [READ]: 'network' });
    await expect(saveCategoryWithPropertyLink({ ...base, propertyId: 8 }, unreadable.fetchImpl)).rejects.toThrow('could not be confirmed');
    expect(unreadable.steps()).toEqual([TAG, CATEGORY, READ]);
    // Re-saving the same category cannot show whether this save landed.
    const unchanged = server({ [CATEGORY]: 'network' });
    await expect(saveCategoryWithPropertyLink({ ...base, currentCategoryId: 2, propertyId: 8 }, unchanged.fetchImpl)).rejects.toThrow('could not be confirmed');
    expect(unchanged.steps()).toEqual([TAG, CATEGORY]);
  });

  it('does not claim nothing changed when the link outcome is unknown', async () => {
    const { fetchImpl, steps } = server({ [TAG]: 'network' });
    await expect(saveCategoryWithPropertyLink({ ...base, propertyId: 8 }, fetchImpl)).rejects.toThrow('could not be confirmed, so the category was not saved');
    expect(steps()).toEqual([TAG]);
  });
});
