import { NextRequest, NextResponse } from 'next/server';
import { categorizeBatch } from '@/lib/ai/claude-client';
import { previewCategorizationSchema, validatePreviewMapping } from '@/lib/categorization/preview';

export const maxDuration = 30;
const headers = { 'Cache-Control': 'no-store', 'X-Finadviser-Preview-Only': 'true' };

/** Read-only legacy preview. Use /api/journal/auto-categorize to process saved transactions. */
export async function POST(request: NextRequest) {
  let body: unknown;
  try {
    const text = await request.text();
    if (text.length > 60000) return NextResponse.json({ error: 'The category preview request is too large.' }, { status: 400, headers });
    body = JSON.parse(text);
  } catch {
    return NextResponse.json({ error: 'Provide valid JSON preview options.' }, { status: 400, headers });
  }
  const parsed = previewCategorizationSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: 'Preview up to 25 descriptions and 100 categories using bounded text fields.' }, { status: 400, headers });
  if (!process.env.AI_GATEWAY_API_KEY) return NextResponse.json({ error: 'AI category previews are unavailable because the AI service is not configured.' }, { status: 503, headers });
  try {
    const result = await categorizeBatch(parsed.data.descriptions, parsed.data.categories);
    // Keep the legacy description->category response shape, with an explicit
    // preview-only header. No journal, learning or provenance writes occur.
    return NextResponse.json(validatePreviewMapping(result, parsed.data.descriptions, parsed.data.categories), { headers });
  } catch {
    console.warn('[categorization] read-only preview unavailable');
    return NextResponse.json({ error: 'The read-only category preview could not be completed. No saved transactions were changed.' }, { status: 503, headers });
  }
}
