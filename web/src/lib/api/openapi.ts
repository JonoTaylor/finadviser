import { z } from 'zod';
import {
  accountType,
  dateString,
  idNumber,
  matchType,
  moneyString,
  monthString,
  ruleSource,
} from './schemas';

// OpenAPI 3.1 uses JSON Schema draft 2020-12 natively, so we can embed the
// output of z.toJSONSchema directly. The helper avoids the top-level
// `$schema` key (which is redundant inside a paths entry) and re-uses the
// components section for shared shapes.

function jsonSchema(schema: z.ZodTypeAny) {
  const out = z.toJSONSchema(schema) as Record<string, unknown>;
  delete out.$schema;
  return out;
}

// ---- shared schemas ----

const errorSchema = z.object({
  error: z.string(),
  correlationId: z.string().optional(),
  issues: z.array(z.unknown()).optional(),
});

const journalEntry = z.object({
  id: idNumber,
  date: dateString,
  description: z.string(),
  reference: z.string().nullable(),
  category_name: z.string().nullable().optional(),
});

const createPropertyBody = z.object({
  name: z.string(),
  address: z.string().nullish(),
  purchaseDate: dateString.nullish(),
  purchasePrice: moneyString.nullish(),
});

const property = z.object({
  id: idNumber,
  name: z.string(),
  address: z.string().nullable(),
  purchaseDate: dateString.nullable(),
  purchasePrice: moneyString.nullable(),
});

const createValuationBody = z.object({
  valuation: moneyString,
  valuationDate: dateString,
  source: z.string().optional(),
});

const createRuleBody = z.object({
  pattern: z.string().min(1).max(500),
  categoryId: idNumber,
  matchType: matchType.optional(),
  priority: z.number().int().min(0).max(10_000).optional(),
  source: ruleSource.optional(),
});

const createAccountBody = z.object({
  name: z.string(),
  accountType,
  parentId: idNumber.nullish(),
  description: z.string().nullish(),
  isSystem: z.boolean().optional(),
});

const account = z.object({
  id: idNumber,
  name: z.string(),
  accountType,
  description: z.string().nullable(),
});

const createOwnerBody = z.object({ name: z.string() });
const owner = z.object({ id: idNumber, name: z.string() });

const createCategoryBody = z.object({
  name: z.string(),
  parentId: idNumber.nullish(),
  isSystem: z.boolean().optional(),
});
const category = z.object({ id: idNumber, name: z.string() });

const budgetStatusQuery = z.object({ month: monthString.optional() });

// ---- path primitives ----

const unauthorized = {
  description: 'Missing or invalid bearer token',
  content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } },
};
const validationError = {
  description: 'Request failed validation',
  content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } },
};
const rateLimited = {
  description: 'Rate limit exceeded',
  content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } },
};
const serverError = {
  description: 'Unhandled server error',
  content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } },
};

const commonResponses = { 400: validationError, 401: unauthorized, 429: rateLimited, 500: serverError };

const idPath = {
  name: 'id',
  in: 'path' as const,
  required: true,
  schema: { type: 'string', pattern: '^\\d+$' },
};

function jsonBody(schema: z.ZodTypeAny) {
  return { required: true, content: { 'application/json': { schema: jsonSchema(schema) } } };
}

function jsonResponse(description: string, schema: z.ZodTypeAny) {
  return {
    description,
    content: { 'application/json': { schema: jsonSchema(schema) } },
  };
}

// ---- spec ----

export function buildOpenAPISpec() {
  return {
    openapi: '3.1.0',
    info: {
      title: 'finadviser API',
      version: '1.0.0',
      description:
        'finadviser HTTP API. All routes require an `Authorization: Bearer ' +
        '<API_AUTH_TOKEN>` header in production.',
    },
    servers: [{ url: '/', description: 'This deployment' }],
    // A request authenticates EITHER by a session cookie (set by
    // POST /api/auth/signin) OR by an API_AUTH_TOKEN bearer header — not
    // both required.
    security: [{ SessionCookie: [] }, { BearerAuth: [] }],
    components: {
      securitySchemes: {
        SessionCookie: { type: 'apiKey', in: 'cookie', name: 'finadviser_session' },
        BearerAuth: { type: 'http', scheme: 'bearer' },
      },
      headers: {
        XRequestId: {
          description: 'Correlation id for log traceability',
          schema: { type: 'string' },
        },
      },
      schemas: {
        Error: jsonSchema(errorSchema),
        JournalEntry: jsonSchema(journalEntry),
        Property: jsonSchema(property),
        Account: jsonSchema(account),
        Owner: jsonSchema(owner),
        Category: jsonSchema(category),
      },
    },
    paths: {
      '/api/journal': {
        get: {
          summary: 'List journal entries',
          parameters: [
            { name: 'startDate', in: 'query', schema: { type: 'string', format: 'date' } },
            { name: 'endDate', in: 'query', schema: { type: 'string', format: 'date' } },
            { name: 'categoryId', in: 'query', schema: { type: 'integer', minimum: 1 } },
            { name: 'accountId', in: 'query', schema: { type: 'integer', minimum: 1 } },
            { name: 'q', in: 'query', schema: { type: 'string', maxLength: 200 } },
            { name: 'limit', in: 'query', schema: { type: 'integer', minimum: 1, maximum: 500 } },
            { name: 'offset', in: 'query', schema: { type: 'integer', minimum: 0, maximum: 1_000_000 } },
          ],
          responses: {
            200: jsonResponse(
              'Entries + total count',
              z.object({
                entries: z.array(journalEntry),
                total: z.number().int(),
              }),
            ),
            ...commonResponses,
          },
        },
      },
      '/api/journal/{id}': {
        parameters: [idPath],
        get: {
          summary: 'Get a single journal entry',
          responses: {
            200: { description: 'The entry', content: { 'application/json': { schema: { $ref: '#/components/schemas/JournalEntry' } } } },
            404: { description: 'Not found', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
            ...commonResponses,
          },
        },
        patch: {
          summary: 'Update a journal entry (categorise + optionally learn a rule)',
          requestBody: jsonBody(
            z.object({
              categoryId: idNumber.optional(),
              createRule: z.boolean().optional(),
              description: z.string().max(500).optional(),
            }),
          ),
          responses: {
            200: jsonResponse('Update applied', z.object({ success: z.boolean() })),
            ...commonResponses,
          },
        },
      },
      '/api/properties': {
        get: {
          summary: 'List properties',
          responses: {
            200: jsonResponse('Properties', z.array(property)),
            ...commonResponses,
          },
        },
        post: {
          summary: 'Create a property',
          requestBody: jsonBody(createPropertyBody),
          responses: {
            201: { description: 'Created', content: { 'application/json': { schema: { $ref: '#/components/schemas/Property' } } } },
            ...commonResponses,
          },
        },
      },
      '/api/properties/{id}': {
        parameters: [idPath],
        get: {
          summary: 'Get a property with ownership, valuations, mortgages, allocations',
          responses: {
            200: jsonResponse(
              'Property detail',
              property.extend({
                ownership: z.array(z.unknown()),
                valuations: z.array(z.unknown()),
                mortgages: z.array(z.unknown()),
                allocations: z.array(z.unknown()),
              }),
            ),
            404: { description: 'Not found', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
            ...commonResponses,
          },
        },
      },
      '/api/properties/{id}/valuations': {
        parameters: [idPath],
        post: {
          summary: 'Add a property valuation',
          requestBody: jsonBody(createValuationBody),
          responses: {
            201: jsonResponse('Valuation created', z.object({ id: idNumber })),
            ...commonResponses,
          },
        },
      },
      '/api/accounts': {
        get: {
          summary: 'List accounts or balances',
          parameters: [
            { name: 'balances', in: 'query', schema: { type: 'string', enum: ['true', 'false'] } },
            { name: 'type', in: 'query', schema: jsonSchema(accountType) },
          ],
          responses: {
            200: jsonResponse('Accounts', z.array(account)),
            ...commonResponses,
          },
        },
        post: {
          summary: 'Create an account',
          requestBody: jsonBody(createAccountBody),
          responses: {
            201: { description: 'Created', content: { 'application/json': { schema: { $ref: '#/components/schemas/Account' } } } },
            ...commonResponses,
          },
        },
      },
      '/api/owners': {
        get: {
          summary: 'List owners',
          responses: {
            200: jsonResponse('Owners', z.array(owner)),
            ...commonResponses,
          },
        },
        post: {
          summary: 'Create an owner',
          requestBody: jsonBody(createOwnerBody),
          responses: {
            201: { description: 'Created', content: { 'application/json': { schema: { $ref: '#/components/schemas/Owner' } } } },
            ...commonResponses,
          },
        },
      },
      '/api/categories': {
        get: {
          summary: 'List categories',
          responses: {
            200: jsonResponse('Categories', z.array(category)),
            ...commonResponses,
          },
        },
        post: {
          summary: 'Create a category',
          requestBody: jsonBody(createCategoryBody),
          responses: {
            201: { description: 'Created', content: { 'application/json': { schema: { $ref: '#/components/schemas/Category' } } } },
            ...commonResponses,
          },
        },
      },
      '/api/categories/rules': {
        get: {
          summary: 'List categorisation rules',
          responses: {
            200: jsonResponse('Rules', z.array(z.unknown())),
            ...commonResponses,
          },
        },
        post: {
          summary: 'Create a rule (regex patterns are safety-checked)',
          requestBody: jsonBody(createRuleBody),
          responses: {
            200: jsonResponse('Created', z.unknown()),
            ...commonResponses,
          },
        },
        patch: {
          summary: 'Update a rule',
          parameters: [{ name: 'id', in: 'query', required: true, schema: { type: 'string', pattern: '^\\d+$' } }],
          requestBody: jsonBody(
            z.object({
              pattern: z.string().optional(),
              matchType: matchType.optional(),
              categoryId: idNumber.optional(),
              priority: z.number().int().optional(),
            }),
          ),
          responses: {
            200: jsonResponse('Updated', z.unknown()),
            ...commonResponses,
          },
        },
        delete: {
          summary: 'Delete a rule',
          parameters: [{ name: 'id', in: 'query', required: true, schema: { type: 'string', pattern: '^\\d+$' } }],
          responses: {
            200: jsonResponse('Deleted', z.object({ success: z.boolean() })),
            ...commonResponses,
          },
        },
      },
      '/api/budgets/status': {
        get: {
          summary: 'Budget status for a given month (defaults to current)',
          parameters: [{ name: 'month', in: 'query', schema: jsonSchema(budgetStatusQuery.shape.month) }],
          responses: {
            200: jsonResponse('Status rows', z.array(z.unknown())),
            ...commonResponses,
          },
        },
      },
      '/api/openapi': {
        get: {
          summary: 'This OpenAPI spec',
          security: [],
          responses: {
            200: jsonResponse('OpenAPI 3.1 document', z.unknown()),
          },
        },
      },
      '/api/auth/signin': {
        post: {
          summary: 'Exchange the owner password for a session cookie',
          security: [],
          requestBody: jsonBody(z.object({ password: z.string() })),
          responses: {
            200: jsonResponse('Signed in — cookie set', z.object({ success: z.boolean() })),
            400: validationError,
            500: serverError,
          },
        },
      },
      '/api/auth/signout': {
        post: {
          summary: 'Clear the session cookie',
          security: [],
          responses: {
            200: jsonResponse('Signed out', z.object({ success: z.boolean() })),
            500: serverError,
          },
        },
      },
      '/api/auth/me': {
        get: {
          summary: 'Report whether the caller has a valid session cookie',
          security: [],
          responses: {
            200: jsonResponse(
              'Session status',
              z.object({
                authenticated: z.boolean(),
                subject: z.string().optional(),
                expiresAt: z.number().optional(),
              }),
            ),
            500: serverError,
          },
        },
      },
    },
  } as const;
}
