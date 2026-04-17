import { describe, it, expect, vi, beforeEach } from 'vitest';
import { getRequest, jsonRequest } from '../__tests__/helpers';

const listProperties = vi.fn();
const createProperty = vi.fn();

vi.mock('@/lib/repos', () => ({
  propertyRepo: {
    listProperties: (...args: unknown[]) => listProperties(...args),
    createProperty: (...args: unknown[]) => createProperty(...args),
  },
}));

const { GET, POST } = await import('./route');

describe('/api/properties', () => {
  beforeEach(() => {
    listProperties.mockReset();
    createProperty.mockReset();
  });

  it('GET returns the list', async () => {
    listProperties.mockResolvedValue([{ id: 1, name: 'Denbigh' }]);
    const res = await GET(getRequest('http://localhost/'), {});
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual([{ id: 1, name: 'Denbigh' }]);
  });

  it('POST creates a property with valid data', async () => {
    createProperty.mockResolvedValue({ id: 1, name: 'Denbigh' });
    const res = await POST(
      jsonRequest('http://localhost/', {
        name: 'Denbigh',
        address: '20 Denbigh Rd',
        purchaseDate: '2022-07-08',
        purchasePrice: '440000',
      }),
      {},
    );
    expect(res.status).toBe(201);
    expect(createProperty).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'Denbigh', purchasePrice: '440000' }),
    );
  });

  it('POST rejects missing name', async () => {
    const res = await POST(
      jsonRequest('http://localhost/', { address: 'x' }),
      {},
    );
    expect(res.status).toBe(400);
    expect(createProperty).not.toHaveBeenCalled();
  });

  it('POST rejects an invalid purchase date', async () => {
    const res = await POST(
      jsonRequest('http://localhost/', { name: 'ok', purchaseDate: '2022/07/08' }),
      {},
    );
    expect(res.status).toBe(400);
  });

  it('POST rejects an invalid purchasePrice', async () => {
    const res = await POST(
      jsonRequest('http://localhost/', { name: 'ok', purchasePrice: '44,000.00' }),
      {},
    );
    expect(res.status).toBe(400);
  });

  it('POST rejects malformed JSON body', async () => {
    const req = new (await import('next/server')).NextRequest('http://localhost/api/properties', {
      method: 'POST',
      body: 'not-json',
      headers: { 'Content-Type': 'application/json' },
    });
    const res = await POST(req, {});
    expect(res.status).toBe(400);
  });
});
