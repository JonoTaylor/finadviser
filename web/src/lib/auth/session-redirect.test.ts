import { describe, expect, it, vi } from 'vitest';
import { installSessionRedirect } from './session-redirect';
import { SESSION_REQUIRED_HEADER, SESSION_REQUIRED_VALUE } from './session';

function browserReturning(response: () => Response, pathname = '/transactions', search = '?page=2') {
  const assign = vi.fn();
  const browser = {
    fetch: vi.fn(async () => response()) as unknown as typeof fetch,
    location: { pathname, search, assign },
  };
  return { browser, assign };
}

const expired = () => new Response('{"error":"Your session has expired."}', {
  status: 401,
  headers: { [SESSION_REQUIRED_HEADER]: SESSION_REQUIRED_VALUE },
});

describe('expired session redirect', () => {
  it('sends an expired session to sign-in and returns to the same page afterwards', async () => {
    const { browser, assign } = browserReturning(expired);
    installSessionRedirect(browser);
    const response = await browser.fetch('/api/journal');
    expect(response.status).toBe(401);
    expect(assign).toHaveBeenCalledWith('/login?next=%2Ftransactions%3Fpage%3D2');
  });

  it('redirects once even when several requests fail together', async () => {
    const { browser, assign } = browserReturning(expired);
    installSessionRedirect(browser);
    await Promise.all([browser.fetch('/api/journal'), browser.fetch('/api/accounts'), browser.fetch('/api/categories')]);
    expect(assign).toHaveBeenCalledTimes(1);
  });

  it('leaves other 401s alone, such as a wrong password or a provider rejecting a token', async () => {
    const { browser, assign } = browserReturning(() => new Response('{"error":"Incorrect password."}', { status: 401 }));
    installSessionRedirect(browser);
    await browser.fetch('/api/auth/login', { method: 'POST' });
    expect(assign).not.toHaveBeenCalled();
  });

  it('does not loop when already on the sign-in page', async () => {
    const { browser, assign } = browserReturning(expired, '/login', '');
    installSessionRedirect(browser);
    await browser.fetch('/api/anything');
    expect(assign).not.toHaveBeenCalled();
  });

  it('passes successful responses through and restores the original fetch', async () => {
    const { browser, assign } = browserReturning(() => new Response('[]', { status: 200 }));
    const original = browser.fetch;
    const uninstall = installSessionRedirect(browser);
    expect(browser.fetch).not.toBe(original);
    await expect((await browser.fetch('/api/accounts')).json()).resolves.toEqual([]);
    uninstall();
    expect(browser.fetch).toBe(original);
    expect(assign).not.toHaveBeenCalled();
  });
});
