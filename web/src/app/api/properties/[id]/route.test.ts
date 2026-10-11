import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const updateProperty = vi.fn();
vi.mock('@/lib/repos', () => ({
  propertyRepo: { updateProperty: (...args: unknown[]) => updateProperty(...args) },
}));

import { PATCH } from './route';

const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
const patch = (id: string, body: unknown) =>
  PATCH(
    new NextRequest(`http://localhost/api/properties/${id}`, {
      method: 'PATCH',
      body: typeof body === 'string' ? body : JSON.stringify(body),
    }),
    ctx(id),
  );

beforeEach(() => updateProperty.mockReset());

describe('PATCH /api/properties/[id]', () => {
  it('updates the letting type', async () => {
    updateProperty.mockResolvedValue({ id: 3, lettingType: 'rent_a_room' });
    const res = await patch('3', { lettingType: 'rent_a_room' });
    expect(res.status).toBe(200);
    expect(updateProperty).toHaveBeenCalledWith(3, { lettingType: 'rent_a_room' });
    expect(await res.json()).toEqual({ id: 3, lettingType: 'rent_a_room' });
  });

  it('rejects an unknown letting type, extra fields and bad JSON with 400', async () => {
    expect((await patch('3', { lettingType: 'airbnb' })).status).toBe(400);
    expect((await patch('3', { lettingType: 'standard', name: 'x' })).status).toBe(400);
    expect((await patch('3', '{oops')).status).toBe(400);
    expect((await patch('abc', { lettingType: 'standard' })).status).toBe(400);
    expect(updateProperty).not.toHaveBeenCalled();
  });

  it('returns 404 for a missing property', async () => {
    updateProperty.mockResolvedValue(null);
    expect((await patch('99', { lettingType: 'standard' })).status).toBe(404);
  });
});
