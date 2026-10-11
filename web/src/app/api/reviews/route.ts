import { NextRequest, NextResponse } from 'next/server';
import { workspaceErrorResponse } from '@/lib/finance-workspace/api';
import { captureFinanceReview, FinanceReviewUnavailableError, loadFinanceReviewWorkspace, saveFinanceReviewWorkspace } from '@/lib/finance-reviews/load';
import { reviewsPostSchema, reviewsPutSchema } from '@/lib/finance-reviews/schema';

export const dynamic = 'force-dynamic';
const HEADERS = { 'Cache-Control': 'no-store' };

function errorResponse(error: unknown) {
  if (error instanceof FinanceReviewUnavailableError) {
    return NextResponse.json({ code: 'REVIEW_UNAVAILABLE', error: error.message }, { status: 503, headers: HEADERS });
  }
  return workspaceErrorResponse(error);
}

export async function GET() {
  try { return NextResponse.json(await loadFinanceReviewWorkspace(), { headers: HEADERS }); }
  catch (error) { return errorResponse(error); }
}

export async function PUT(request: NextRequest) {
  const parsed = reviewsPutSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ code: 'VALIDATION_FAILED', error: parsed.error.issues.map(issue => `${issue.path.join('.') || 'review'}: ${issue.message}`).join('; ') }, { status: 400, headers: HEADERS });
  try {
    const workspace = await saveFinanceReviewWorkspace(parsed.data.data, parsed.data.revision);
    return NextResponse.json({ workspace }, { headers: HEADERS });
  } catch (error) { return errorResponse(error); }
}

export async function POST(request: NextRequest) {
  const parsed = reviewsPostSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ code: 'VALIDATION_FAILED', error: parsed.error.issues.map(issue => `${issue.path.join('.') || 'review'}: ${issue.message}`).join('; ') }, { status: 400, headers: HEADERS });
  try {
    const workspace = await captureFinanceReview(parsed.data.revision);
    return NextResponse.json({ workspace }, { headers: HEADERS });
  } catch (error) { return errorResponse(error); }
}
