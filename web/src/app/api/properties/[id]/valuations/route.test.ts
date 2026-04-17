import { describe, it, expect, vi, beforeEach } from 'vitest';
import { jsonRequest, paramsCtx } from '../../../__tests__/helpers';

const addValuation = vi.fn();

vi.mock('@/lib/repos', () => ({
  propertyRepo: {
    addValuation: (...args: unknown[]) => addValuation(...args),
  },
}));

const { POST } = await import('./route');

describe('POST /api/properties/[id]/valuations', () => {
  beforeEach(() => {
    addValuation.mockReset();
    addValuation.mockResolvedValue({ id: 1 });
  });

  it('creates a valuation when the body is valid', async () => {
    const res = await POST(
      jsonRequest('http://localhost/', {
        valuation: '450000',
        valuationDate: '2024-09-07',
        source: 'Santander',
      }),
      paramsCtx({ id: '3' }),
    );
    expect(res.status).toBe(201);
    expect(addValuation).toHaveBeenCalledWith(3, '450000', '2024-09-07', 'Santander');
  });

  it('defaults source to manual when omitted', async () => {
    await POST(
      jsonRequest('http://localhost/', {
        valuation: '450000',
        valuationDate: '2024-09-07',
      }),
      paramsCtx({ id: '3' }),
    );
    expect(addValuation).toHaveBeenLastCalledWith(3, '450000', '2024-09-07', 'manual');
  });

  it('rejects a malformed amount', async () => {
    const res = await POST(
      jsonRequest('http://localhost/', {
        valuation: '450,000',
        valuationDate: '2024-09-07',
      }),
      paramsCtx({ id: '3' }),
    );
    expect(res.status).toBe(400);
    expect(addValuation).not.toHaveBeenCalled();
  });

  it('rejects when id param is non-numeric', async () => {
    const res = await POST(
      jsonRequest('http://localhost/', {
        valuation: '450000',
        valuationDate: '2024-09-07',
      }),
      paramsCtx({ id: 'abc' }),
    );
    expect(res.status).toBe(400);
  });
});
