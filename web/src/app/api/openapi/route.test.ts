import { describe, it, expect } from 'vitest';
import { GET } from './route';

describe('GET /api/openapi', () => {
  it('returns the OpenAPI document as JSON', async () => {
    const res = GET();
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toMatch(/application\/json/);
    const doc = await res.json();
    expect(doc.openapi).toBe('3.1.0');
    expect(doc.paths).toHaveProperty('/api/journal');
  });
});
