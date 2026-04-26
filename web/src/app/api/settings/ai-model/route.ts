import { NextRequest, NextResponse } from 'next/server';
import { appSettingsRepo } from '@/lib/repos';
import {
  MODEL_SETTING_KEY,
  getAvailableModels,
  isValidModelId,
  resolveModelId,
} from '@/lib/ai/model';

/**
 * Settings page reads + writes the active AI model here. GET returns the
 * resolved model + where it came from + the live list of models from the
 * Vercel AI Gateway; PUT writes a new value to app_settings (or DELETE
 * clears it back to env / default).
 */

export async function GET() {
  try {
    const [{ modelId, source }, options] = await Promise.all([
      resolveModelId(),
      getAvailableModels(),
    ]);
    return NextResponse.json({ modelId, source, options });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to load AI model setting';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function PUT(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({} as { modelId?: unknown }));
    if (!isValidModelId(body.modelId)) {
      return NextResponse.json(
        { error: 'modelId must be a string of the form "provider/model".' },
        { status: 400 },
      );
    }
    await appSettingsRepo.set(MODEL_SETTING_KEY, body.modelId);
    return NextResponse.json({ ok: true, modelId: body.modelId });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to update AI model';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function DELETE() {
  try {
    await appSettingsRepo.clear(MODEL_SETTING_KEY);
    const { modelId, source } = await resolveModelId();
    return NextResponse.json({ ok: true, modelId, source });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to clear AI model';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
