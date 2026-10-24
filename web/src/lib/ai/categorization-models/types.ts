import { z } from 'zod';

export const modelIdSchema = z.string().min(3).max(200).regex(/^[a-z0-9._-]+\/[a-z0-9._-]+$/i);
const count = z.number().int().nonnegative();
export const catalogModelSchema = z.object({
  id: modelIdSchema, name: z.string().min(1).max(200),
  inputUsdPerMillion: z.number().finite().nonnegative().nullable(),
  outputUsdPerMillion: z.number().finite().nonnegative().nullable(),
}).strict();
export const gatewayCatalogSchema = z.object({
  status: z.enum(['available', 'unavailable']), observedAt: z.iso.datetime(),
  models: z.array(catalogModelSchema).max(1000),
}).strict();
export const modelEvaluationResultSchema = z.object({
  modelId: modelIdSchema, status: z.enum(['complete', 'failed', 'timed_out']), qualified: z.boolean(),
  correct: count.max(10), total: z.literal(10), unsafeAutoApplied: count.max(10), invalidBatches: count.max(2),
  reviewCount: count.max(10).nullable(),
  completedBatches: count.max(2), totalBatches: z.literal(2),
  meanLatencyMs: z.number().finite().nonnegative(), maxLatencyMs: z.number().finite().nonnegative(),
  estimatedCostUsd: z.number().finite().nonnegative().nullable(),
}).strict();
export const modelEvaluationReportSchema = z.object({
  id: z.uuid(), benchmarkVersion: z.string().max(100), startedAt: z.iso.datetime(), completedAt: z.iso.datetime(),
  catalogObservedAt: z.iso.datetime().nullable(), status: z.enum(['complete', 'unavailable']),
  results: z.array(modelEvaluationResultSchema).max(3), recommendedModelId: modelIdSchema.nullable(),
  applied: z.boolean(), message: z.string().max(1000),
}).strict();
export const modelSelectionSchema = z.object({ modelId: modelIdSchema, benchmarkId: z.uuid(), benchmarkVersion: z.string().max(100), selectedAt: z.iso.datetime() }).strict();
export const modelEvaluationStateSchema = z.object({
  running: z.object({ id: z.uuid(), startedAt: z.iso.datetime(), expiresAt: z.iso.datetime() }).strict().nullable(),
  lastReport: modelEvaluationReportSchema.nullable(), selection: modelSelectionSchema.nullable(),
}).strict();
export const categorizationModelsResponseSchema = modelEvaluationStateSchema.extend({
  revision: count, catalog: gatewayCatalogSchema, gatewayConfigured: z.boolean(),
  active: z.object({ modelId: modelIdSchema, source: z.enum(['env', 'qualified', 'default']) }).strict(),
}).strict();

export type CatalogModel = z.infer<typeof catalogModelSchema>;
export type GatewayCatalog = z.infer<typeof gatewayCatalogSchema>;
export type ModelEvaluationResult = z.infer<typeof modelEvaluationResultSchema>;
export type ModelEvaluationReport = z.infer<typeof modelEvaluationReportSchema>;
export type ModelEvaluationState = z.infer<typeof modelEvaluationStateSchema>;
export type CategorizationModelsResponse = z.infer<typeof categorizationModelsResponseSchema>;

export const INITIAL_MODEL_EVALUATION_STATE: ModelEvaluationState = { running: null, lastReport: null, selection: null };
