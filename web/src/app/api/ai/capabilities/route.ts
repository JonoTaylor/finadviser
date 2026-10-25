import { NextResponse } from 'next/server';
import { getAdviserCapabilities } from '@/lib/ai/capabilities';
import { TOOL_DEFINITIONS } from '@/lib/ai/tools';

export const dynamic = 'force-dynamic';

/** Authenticated by the same proxy as chat; contains no personal records or credentials. */
export function GET() {
  return NextResponse.json(getAdviserCapabilities(TOOL_DEFINITIONS.map(tool => tool.name), process.env), {
    headers: { 'Cache-Control': 'private, no-store, max-age=0' },
  });
}
