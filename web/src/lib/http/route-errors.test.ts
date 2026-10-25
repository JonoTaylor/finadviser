import { afterEach, describe, expect, it, vi } from 'vitest';
import { ClientError, NotFoundError } from '@/lib/errors';
import { parseId, readJsonBody, routeErrorResponse } from './route-errors';

afterEach(() => vi.restoreAllMocks());

function drizzleFailure(): Error {
  const cause = Object.assign(new Error('duplicate key value violates unique constraint "accounts_name_key"'), { code: '23505' });
  return new Error('Failed query: insert into "accounts" ("name") values ($1)\nparams: Joint Current Account,1234.56', { cause });
}

describe('route error responses', () => {
  it('keeps the status and message of caller mistakes without logging them as server faults', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    const bad = routeErrorResponse(new ClientError('Invalid tax year label: 2024'), 'Failed to load report');
    expect(bad.status).toBe(400);
    expect(await bad.json()).toEqual({ error: 'Invalid tax year label: 2024' });
    const missing = routeErrorResponse(new NotFoundError('Owner 9 not found'), 'Failed to load report');
    expect(missing.status).toBe(404);
    expect(log).not.toHaveBeenCalled();
  });

  it('logs unexpected failures and answers with the route fallback by default', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    const response = routeErrorResponse(new Error('connection reset'), 'Failed to fetch properties');
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: 'Failed to fetch properties' });
    expect(log).toHaveBeenCalledWith('[api] Failed to fetch properties', expect.objectContaining({ name: 'Error', message: 'connection reset' }));
  });

  it('can keep showing the underlying message where a route already did', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const response = routeErrorResponse(new Error('Tenancy dates overlap'), 'Failed to create tenancy', { exposeMessage: true });
    expect(await response.json()).toEqual({ error: 'Tenancy dates overlap' });
  });

  it('never puts query parameters, which can be financial records, in the logs or the response', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    const response = routeErrorResponse(drizzleFailure(), 'Failed to create account', { exposeMessage: true });
    const body = await response.json();
    expect(body).toEqual({ error: 'duplicate key value violates unique constraint "accounts_name_key"' });
    const logged = JSON.stringify(log.mock.calls);
    expect(logged).toContain('23505');
    expect(logged).not.toContain('1234.56');
    expect(logged).not.toContain('Joint Current Account');
  });
});

describe('request helpers', () => {
  it('treats a malformed JSON body as a 400 caller mistake', async () => {
    const request = new Request('https://fixture.test/api/owners', { method: 'POST', body: '{"name":' });
    await expect(readJsonBody(request)).rejects.toBeInstanceOf(ClientError);
  });

  it('returns a well-formed JSON body unchanged', async () => {
    const request = new Request('https://fixture.test/api/owners', { method: 'POST', body: '{"name":"Alex"}' });
    await expect(readJsonBody(request)).resolves.toEqual({ name: 'Alex' });
  });

  it('accepts only positive integer ids', () => {
    expect(parseId('42', 'property id')).toBe(42);
    for (const value of ['0', '-1', '1.5', '12abc', 'abc', '', null, undefined, '99999999999999999999']) {
      expect(() => parseId(value, 'property id')).toThrow('Invalid property id');
    }
  });
});
