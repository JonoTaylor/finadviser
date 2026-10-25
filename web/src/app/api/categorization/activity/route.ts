import { NextResponse } from 'next/server';
import { loadCategorizationActivity } from '@/lib/categorization/activity';
import { categorizationActivitySchema } from '@/lib/categorization/activity-schema';

export const runtime = 'nodejs';
export const maxDuration = 30;
const headers = { 'Cache-Control': 'private, no-store' };

export async function GET() {
  try { return NextResponse.json(categorizationActivitySchema.parse(await loadCategorizationActivity()), { headers }); }
  catch { return NextResponse.json({ error: 'Automatic category activity is unavailable. Existing labels have not been treated as verified or empty.' }, { status: 503, headers }); }
}
