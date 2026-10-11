/** Keep unsuccessful API responses out of SWR's successful-data cache. */
export async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  const body = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(typeof body?.error === 'string' ? body.error : `Request failed (${response.status}). Please try again.`);
  }
  if (body === null) throw new Error('The server returned an unreadable response. Please try again.');
  return body as T;
}
