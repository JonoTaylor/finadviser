import { randomUUID } from 'node:crypto';
import { readWorkspace, writeWorkspace, WorkspaceConflictError } from '@/lib/finance-workspace/store';
import { canonicalGatewayModelId } from '@/lib/ai/model';
import { defaultEvaluationCandidates, gatewayEvaluationConfigured, getEvaluationCatalog } from './catalog';
import { BENCHMARK_VERSION } from './fixtures';
import { withModelDeadline } from './bounds';
import { evaluateCatalogModel, recommendedEvaluationModel } from './runner';
import {
  INITIAL_MODEL_EVALUATION_STATE, categorizationModelsResponseSchema, modelEvaluationStateSchema, modelIdSchema,
  type CategorizationModelsResponse, type GatewayCatalog, type ModelEvaluationReport, type ModelEvaluationState,
} from './types';

export const CATEGORIZATION_MODEL_POLICY_KEY = 'ai.categorization_models.v1';
export const DEFAULT_CATEGORIZATION_MODEL_ID = 'openai/gpt-4.1-mini';
const COOLDOWN_MS = 24 * 60 * 60 * 1000;
const EVALUATION_MS = 29_000;
const RUNNING_LEASE_MS = 120_000;
type ActiveModel = CategorizationModelsResponse['active'];
type EvaluationOutcome = { status: 'complete' | 'unavailable' | 'skipped' | 'running'; report: ModelEvaluationReport | null };
let cachedQualified: { model: ActiveModel; expiresAt: number } | null = null;

export class ModelEvaluationInputError extends Error {
  constructor() { super('Select up to three distinct models currently listed by AI Gateway.'); }
}

function activeFromState(state: ModelEvaluationState): ActiveModel {
  const pinned = canonicalGatewayModelId(process.env.CATEGORIZATION_MODEL_ID?.trim() || '');
  if (modelIdSchema.safeParse(pinned).success) return { modelId: pinned, source: 'env' };
  if (state.selection?.benchmarkVersion === BENCHMARK_VERSION) return { modelId: state.selection.modelId, source: 'qualified' };
  return { modelId: DEFAULT_CATEGORIZATION_MODEL_ID, source: 'default' };
}

async function readState(signal?: AbortSignal, timeoutMs = 1500) {
  return withModelDeadline(() => readWorkspace(CATEGORIZATION_MODEL_POLICY_KEY, modelEvaluationStateSchema, INITIAL_MODEL_EVALUATION_STATE), timeoutMs, signal);
}

/** A cheap lookup, independent from the long-running synthetic comparison. */
export async function resolveCategorizationModelId(): Promise<ActiveModel> {
  const pinned = activeFromState(INITIAL_MODEL_EVALUATION_STATE);
  if (pinned.source === 'env') return pinned;
  if (cachedQualified && Date.now() < cachedQualified.expiresAt) return cachedQualified.model;
  try {
    const state = await readState(undefined, 350);
    const model = activeFromState(state.data);
    if (model.source === 'qualified') cachedQualified = { model, expiresAt: Date.now() + 60_000 };
    return model;
  } catch { return pinned; }
}

export async function getCategorizationModelsSnapshot(): Promise<CategorizationModelsResponse> {
  const [state, catalog] = await Promise.all([readState(undefined, 3000), getEvaluationCatalog()]);
  const running = state.data.running && Date.parse(state.data.running.expiresAt) > Date.now() ? state.data.running : null;
  return categorizationModelsResponseSchema.parse({
    ...state.data, running, revision: state.revision, catalog, gatewayConfigured: gatewayEvaluationConfigured(), active: activeFromState(state.data),
  });
}

type EvaluationOptions = {
  expectedRevision?: number; modelIds?: string[]; applyRecommendation?: boolean; force?: boolean;
  signal?: AbortSignal; budgetMs?: number;
};

/** At most six model calls; the stored CAS claim prevents duplicate provider spend across workers. */
export async function evaluateCategorizationModels(options: EvaluationOptions = {}): Promise<EvaluationOutcome> {
  const budget = Math.max(1, Math.min(options.budgetMs ?? EVALUATION_MS, EVALUATION_MS));
  try {
    return await withModelDeadline(signal => runEvaluation(options, signal, Date.now() + budget), budget, options.signal);
  } catch (error) {
    if (error instanceof WorkspaceConflictError || error instanceof ModelEvaluationInputError) throw error;
    return { status: 'unavailable', report: null };
  }
}

/** Used before a background slice; unavailable comparisons never block ordinary categorisation. */
export async function maybeEvaluateCategorizationModels(options: { signal?: AbortSignal; budgetMs?: number } = {}): Promise<EvaluationOutcome> {
  try { return await evaluateCategorizationModels(options); }
  catch { return { status: 'skipped', report: null }; }
}

async function runEvaluation(options: EvaluationOptions, signal: AbortSignal, deadline: number): Promise<EvaluationOutcome> {
  const initial = await readState(signal);
  signal.throwIfAborted();
  if (options.expectedRevision !== undefined && initial.revision !== options.expectedRevision) throw new WorkspaceConflictError();
  if (initial.data.running && Date.parse(initial.data.running.expiresAt) > Date.now()) return { status: 'running', report: null };
  if (!options.force && initial.data.lastReport?.benchmarkVersion === BENCHMARK_VERSION
    && Date.now() - Date.parse(initial.data.lastReport.completedAt) < COOLDOWN_MS) return { status: 'skipped', report: initial.data.lastReport };

  const id = randomUUID();
  const startedAt = new Date().toISOString();
  const catalog = gatewayEvaluationConfigured() ? await getEvaluationCatalog({ signal })
    : { status: 'unavailable' as const, observedAt: startedAt, models: [] };
  signal.throwIfAborted();
  let report: ModelEvaluationReport;
  if (catalog.status !== 'available') {
    report = { id, benchmarkVersion: BENCHMARK_VERSION, startedAt, completedAt: new Date().toISOString(),
      catalogObservedAt: null, status: 'unavailable', results: [], recommendedModelId: null, applied: false,
      message: gatewayEvaluationConfigured() ? 'The live Gateway catalogue could not be read. No model comparison or selection change was made.'
        : 'Gateway credentials are unavailable. No model comparison or selection change was made.' };
    await withModelDeadline(() => writeWorkspace(CATEGORIZATION_MODEL_POLICY_KEY, modelEvaluationStateSchema,
      { ...initial.data, running: null, lastReport: report }, initial.revision), Math.min(2500, deadline - Date.now()), signal);
    return { status: 'unavailable', report };
  }

  const modelIds = validateCandidates(options.modelIds ?? defaultEvaluationCandidates(catalog), catalog);
  const claimed = await withModelDeadline(() => writeWorkspace(CATEGORIZATION_MODEL_POLICY_KEY, modelEvaluationStateSchema, {
    ...initial.data, running: { id, startedAt, expiresAt: new Date(Date.now() + RUNNING_LEASE_MS).toISOString() },
  }, initial.revision), Math.min(2500, deadline - Date.now()), signal);
  signal.throwIfAborted();
  const remainingForCalls = Math.max(1, Math.min(17_000, deadline - Date.now() - 3500));
  const phaseSignal = AbortSignal.any([signal, AbortSignal.timeout(remainingForCalls)]);
  const results = await Promise.all(modelIds.map(modelId => evaluateCatalogModel(catalog.models.find(model => model.id === modelId)!, phaseSignal)));
  signal.throwIfAborted();
  const recommendedModelId = recommendedEvaluationModel(results);
  const selectedAt = new Date().toISOString();
  const apply = options.applyRecommendation !== false && recommendedModelId !== null;
  const selection = apply ? { modelId: recommendedModelId!, benchmarkId: id, benchmarkVersion: BENCHMARK_VERSION, selectedAt } : initial.data.selection;
  const pinned = activeFromState(INITIAL_MODEL_EVALUATION_STATE).source === 'env';
  report = {
    id, benchmarkVersion: BENCHMARK_VERSION, startedAt, completedAt: selectedAt, catalogObservedAt: catalog.observedAt,
    status: 'complete', results, recommendedModelId, applied: apply && !pinned,
    message: recommendedModelId
      ? `A model passed all ten synthetic cases within the batch deadline. This small comparison is not a guarantee of accuracy on your records.${pinned ? ' The deployment model override remains active.' : ''}`
      : 'No compared model met every safety, correctness and timing check. The current selection was kept; this does not establish that another model is worse.',
  };
  await withModelDeadline(() => writeWorkspace(CATEGORIZATION_MODEL_POLICY_KEY, modelEvaluationStateSchema,
    { running: null, lastReport: report, selection }, claimed.revision), Math.min(3000, deadline - Date.now()), signal);
  cachedQualified = null;
  return { status: 'complete', report };
}

function validateCandidates(modelIds: string[], catalog: GatewayCatalog): string[] {
  if (!modelIds.length || modelIds.length > 3 || new Set(modelIds).size !== modelIds.length
    || modelIds.some(id => !modelIdSchema.safeParse(id).success || !catalog.models.some(model => model.id === id))) throw new ModelEvaluationInputError();
  return modelIds;
}
