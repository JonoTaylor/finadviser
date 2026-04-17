import { NextResponse } from 'next/server';
import { buildOpenAPISpec } from '@/lib/api/openapi';

// Cached across requests — the spec is purely derived from static schemas.
let cached: unknown | null = null;

export function GET() {
  if (!cached) cached = buildOpenAPISpec();
  return NextResponse.json(cached);
}
