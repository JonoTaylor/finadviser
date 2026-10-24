import { gateway } from '@ai-sdk/gateway';
import Decimal from 'decimal.js';
import { withModelDeadline } from './bounds';
import { modelIdSchema, type CatalogModel, type GatewayCatalog } from './types';

let cached: GatewayCatalog | null = null;
const CATALOG_TTL_MS = 90_000;

export function gatewayEvaluationConfigured(): boolean {
  return Boolean(process.env.AI_GATEWAY_API_KEY || process.env.VERCEL_OIDC_TOKEN);
}

function price(value: unknown): number | null {
  if (typeof value !== 'string' && typeof value !== 'number') return null;
  if (typeof value === 'string' && !value.trim()) return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) return null;
  const perMillion = new Decimal(value).times(1_000_000).toNumber();
  return Number.isFinite(perMillion) ? perMillion : null;
}

/** Benchmark membership always comes from actual Gateway metadata, never fallback guesses. */
export async function getEvaluationCatalog(options: { signal?: AbortSignal; timeoutMs?: number } = {}): Promise<GatewayCatalog> {
  if (cached && Date.now() - Date.parse(cached.observedAt) < CATALOG_TTL_MS) return cached;
  const observedAt = new Date().toISOString();
  try {
    const response = await withModelDeadline(() => gateway.getAvailableModels(), Math.min(options.timeoutMs ?? 4000, 4000), options.signal);
    const models: CatalogModel[] = [];
    const seen = new Set<string>();
    for (const model of response.models ?? []) {
      if (!modelIdSchema.safeParse(model.id).success || seen.has(model.id)
        || (model.modelType !== undefined && model.modelType !== null && model.modelType !== 'language')) continue;
      models.push({ id: model.id, name: typeof model.name === 'string' ? model.name.slice(0, 200) || model.id : model.id,
        inputUsdPerMillion: price(model.pricing?.input), outputUsdPerMillion: price(model.pricing?.output) });
      seen.add(model.id);
      if (models.length >= 1000) break;
    }
    if (!models.length) return { status: 'unavailable', observedAt, models: [] };
    cached = { status: 'available', observedAt, models };
    return cached;
  } catch { return { status: 'unavailable', observedAt, models: [] }; }
}

/** These are comparison candidates only, and must appear in the live catalogue. */
export function defaultEvaluationCandidates(catalog: GatewayCatalog): string[] {
  const ids = new Set(catalog.models.map(model => model.id));
  const families = [
    ['openai/gpt-4.1-mini', 'openai/gpt-5.4-mini', 'openai/gpt-5-mini'],
    ['google/gemini-3-flash', 'google/gemini-2.5-flash'],
    ['anthropic/claude-haiku-4.5', 'anthropic/claude-sonnet-4.6', 'anthropic/claude-sonnet-4.5'],
  ];
  return families.flatMap(family => { const id = family.find(candidate => ids.has(candidate)); return id ? [id] : []; }).slice(0, 3);
}
