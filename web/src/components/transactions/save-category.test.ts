import { describe, expect, it, vi } from 'vitest';
import { saveCategoryWithPropertyLink } from './save-category';

function recorder(fail: (url: string, call: number) => boolean = () => false) {
  const calls: Array<{ url: string; body?: unknown }> = [];
  const request = vi.fn(async (url: string, init?: RequestInit) => {
    calls.push({ url, body: init?.body ? JSON.parse(String(init.body)) : undefined });
    if (fail(url, calls.length)) throw new Error(`refused ${url}`);
    return { ok: true };
  });
  return { calls, request };
}

const base = { journalId: 41, categoryId: 2, createRule: true, description: 'Plumber callout', currentPropertyId: null };

describe('saving a category with a property link', () => {
  it('links the property before saving the category, so a remembered category learns the final property', async () => {
    const { calls, request } = recorder();
    await saveCategoryWithPropertyLink({ ...base, propertyId: 8 }, request);
    expect(calls.map(call => call.url)).toEqual(['/api/properties/journal/41/tag', '/api/journal/41']);
    expect(calls[0].body).toEqual({ propertyId: 8 });
    expect(calls[1].body).toEqual({ categoryId: 2, createRule: true, description: 'Plumber callout' });
  });

  it('unlinks first when the user removes a link', async () => {
    const { calls, request } = recorder();
    await saveCategoryWithPropertyLink({ ...base, currentPropertyId: 7, propertyId: null }, request);
    expect(calls.map(call => call.url)).toEqual(['/api/properties/journal/41/untag', '/api/journal/41']);
  });

  it('only saves the category when the link is unchanged or not offered', async () => {
    for (const propertyId of [undefined, 7]) {
      const { calls, request } = recorder();
      await saveCategoryWithPropertyLink({ ...base, currentPropertyId: 7, propertyId }, request);
      expect(calls.map(call => call.url)).toEqual(['/api/journal/41']);
    }
  });

  it('changes nothing when the link fails', async () => {
    const { calls, request } = recorder(url => url.endsWith('/tag'));
    await expect(saveCategoryWithPropertyLink({ ...base, propertyId: 8 }, request)).rejects.toThrow('nothing was changed');
    expect(calls.map(call => call.url)).toEqual(['/api/properties/journal/41/tag']);
  });

  it('puts the previous link back when the category fails', async () => {
    const { calls, request } = recorder(url => url === '/api/journal/41');
    await expect(saveCategoryWithPropertyLink({ ...base, currentPropertyId: 7, propertyId: 8 }, request)).rejects.toThrow('property link was left as it was');
    expect(calls.map(call => call.url)).toEqual(['/api/properties/journal/41/tag', '/api/journal/41', '/api/properties/journal/41/tag']);
    expect(calls[2].body).toEqual({ propertyId: 7 });
  });

  it('says so plainly if the previous link cannot be put back', async () => {
    const { request } = recorder((url, call) => url === '/api/journal/41' || call === 3);
    await expect(saveCategoryWithPropertyLink({ ...base, propertyId: 8 }, request)).rejects.toThrow('could not be put back');
  });
});
