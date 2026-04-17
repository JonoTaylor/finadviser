import { describe, it, expect } from 'vitest';
import { buildOpenAPISpec } from './openapi';

const spec = buildOpenAPISpec() as Record<string, unknown>;

describe('buildOpenAPISpec', () => {
  it('produces an OpenAPI 3.1 document', () => {
    expect(spec.openapi).toBe('3.1.0');
    expect(spec.info).toMatchObject({ title: 'finadviser API', version: expect.any(String) });
  });

  it('declares BearerAuth and applies it globally', () => {
    const components = spec.components as Record<string, unknown>;
    const security = spec.security as Array<Record<string, unknown>>;
    expect((components.securitySchemes as Record<string, unknown>).BearerAuth).toMatchObject({
      type: 'http',
      scheme: 'bearer',
    });
    expect(security[0]).toHaveProperty('BearerAuth');
  });

  it('covers the major routes', () => {
    const paths = Object.keys(spec.paths as object);
    for (const expected of [
      '/api/journal',
      '/api/journal/{id}',
      '/api/properties',
      '/api/properties/{id}',
      '/api/properties/{id}/valuations',
      '/api/accounts',
      '/api/owners',
      '/api/categories',
      '/api/categories/rules',
      '/api/budgets/status',
      '/api/openapi',
    ]) {
      expect(paths, `expected ${expected}`).toContain(expected);
    }
  });

  it('each operation declares a 400 and 401 response (except the spec endpoint)', () => {
    const paths = spec.paths as Record<string, Record<string, Record<string, unknown>>>;
    for (const [path, methods] of Object.entries(paths)) {
      if (path === '/api/openapi') continue;
      for (const [method, op] of Object.entries(methods)) {
        if (method === 'parameters') continue;
        const responses = op.responses as Record<string, unknown>;
        expect(responses['400'], `${method.toUpperCase()} ${path} missing 400`).toBeDefined();
        expect(responses['401'], `${method.toUpperCase()} ${path} missing 401`).toBeDefined();
      }
    }
  });

  it('exposes the spec endpoint without auth', () => {
    const paths = spec.paths as Record<string, Record<string, Record<string, unknown>>>;
    expect(paths['/api/openapi'].get.security).toEqual([]);
  });

  it('inlines JSON Schema for Error, Property, and Account', () => {
    const schemas = (spec.components as Record<string, unknown>).schemas as Record<string, Record<string, unknown>>;
    expect(schemas.Error.type).toBe('object');
    expect(schemas.Property.type).toBe('object');
    expect(schemas.Account.type).toBe('object');
  });
});
