import { SESSION_REQUIRED_HEADER, SESSION_REQUIRED_VALUE } from './session';

interface BrowserLike {
  fetch: typeof fetch;
  location: { pathname: string; search: string; assign(url: string): void };
}

/**
 * Wraps the browser's fetch so that an API response saying the session has
 * expired sends the user to sign-in once, returning them to the same page.
 * Other 401s (a wrong password, a provider rejecting a token) pass through.
 * Returns a function that restores the original fetch.
 */
export function installSessionRedirect(browser: BrowserLike): () => void {
  const originalFetch = browser.fetch;
  let redirecting = false;

  const guardedFetch: typeof fetch = async (...args) => {
    const response = await originalFetch(...args);
    if (
      !redirecting
      && response.status === 401
      && response.headers.get(SESSION_REQUIRED_HEADER) === SESSION_REQUIRED_VALUE
      && browser.location.pathname !== '/login'
    ) {
      redirecting = true;
      const next = `${browser.location.pathname}${browser.location.search}`;
      browser.location.assign(`/login?next=${encodeURIComponent(next)}`);
    }
    return response;
  };

  browser.fetch = guardedFetch;
  return () => {
    // Only restore if nothing else has wrapped fetch since.
    if (browser.fetch === guardedFetch) browser.fetch = originalFetch;
  };
}
