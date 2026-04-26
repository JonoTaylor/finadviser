import { gateway } from '@ai-sdk/gateway';
import { appSettingsRepo } from '@/lib/repos/app-settings.repo';

/**
 * AI model selection.
 *
 * Resolution order for the active model:
 *   1. app_settings table (runtime-set on Settings page)
 *   2. MODEL_ID env var (deploy-time pin)
 *   3. DEFAULT_MODEL_ID (sensible Sonnet)
 *
 * Available models come live from the Vercel AI Gateway via
 * gateway.getAvailableModels() — Vercel adds providers/models regularly,
 * so a hardcoded list goes stale. We cache the response in-memory for
 * 5 minutes so the Settings page is snappy without hammering the gateway.
 *
 * Auth: AI_GATEWAY_API_KEY in Vercel env (already set for the rest of
 * the AI surface).
 */

export const MODEL_SETTING_KEY = 'ai.model_id';
export const DEFAULT_MODEL_ID = 'anthropic/claude-sonnet-4-5';

export interface AvailableModel {
  id: string;
  name: string;
  description?: string;
  provider?: string;
}

/**
 * Last-resort list shown if the gateway is unreachable (or auth fails).
 * Better than an empty dropdown — the user can still pick something.
 */
const FALLBACK_MODELS: AvailableModel[] = [
  { id: 'anthropic/claude-haiku-4-5',  name: 'Claude Haiku 4.5',  provider: 'anthropic' },
  { id: 'anthropic/claude-sonnet-4-5', name: 'Claude Sonnet 4.5', provider: 'anthropic' },
  { id: 'anthropic/claude-sonnet-4-7', name: 'Claude Sonnet 4.7', provider: 'anthropic' },
  { id: 'anthropic/claude-opus-4-7',   name: 'Claude Opus 4.7',   provider: 'anthropic' },
  { id: 'openai/gpt-5-mini',           name: 'GPT-5 mini',        provider: 'openai' },
  { id: 'openai/gpt-5',                name: 'GPT-5',             provider: 'openai' },
];

const MODEL_LIST_TTL_MS = 5 * 60 * 1000;
let cachedModels: { fetchedAt: number; models: AvailableModel[] } | null = null;

/**
 * Fetch the live list of models the configured AI Gateway exposes.
 * 5-minute in-memory cache; falls back to FALLBACK_MODELS on error so the
 * Settings page never shows an empty dropdown.
 */
export async function getAvailableModels(): Promise<AvailableModel[]> {
  if (cachedModels && Date.now() - cachedModels.fetchedAt < MODEL_LIST_TTL_MS) {
    return cachedModels.models;
  }
  try {
    const result = await gateway.getAvailableModels();
    const raw = (result?.models ?? []) as Array<{ id: string; name?: string; description?: string }>;
    const models: AvailableModel[] = raw.map((m) => ({
      id: m.id,
      name: m.name ?? m.id,
      description: m.description,
      provider: m.id.includes('/') ? m.id.split('/')[0] : undefined,
    }));
    if (models.length === 0) {
      console.warn('[model] gateway returned empty model list; using fallback');
      return FALLBACK_MODELS;
    }
    cachedModels = { fetchedAt: Date.now(), models };
    return models;
  } catch (err) {
    console.warn('[model] getAvailableModels failed; using fallback list:', err instanceof Error ? err.message : err);
    return FALLBACK_MODELS;
  }
}

export type ModelSource = 'db' | 'env' | 'default';

export async function resolveModelId(): Promise<{ modelId: string; source: ModelSource }> {
  const fromDb = await appSettingsRepo.get(MODEL_SETTING_KEY);
  if (fromDb) return { modelId: fromDb, source: 'db' };

  const fromEnv = process.env.MODEL_ID;
  if (fromEnv) return { modelId: fromEnv, source: 'env' };

  return { modelId: DEFAULT_MODEL_ID, source: 'default' };
}

/**
 * Lightweight validation for the dropdown POST. Allow any string that
 * looks like 'provider/model' — exact membership is checked against the
 * gateway's live list separately so future models work without code
 * changes.
 */
export function isValidModelId(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  if (value.length === 0 || value.length > 200) return false;
  return /^[a-z0-9-]+\/[a-z0-9._-]+$/i.test(value);
}
