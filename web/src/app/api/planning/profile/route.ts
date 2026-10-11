import { NextRequest, NextResponse } from 'next/server';
import { InvalidPlanningProfileError, loadPlanningProfile, planningProfileSchema, savePlanningProfile } from '@/lib/planning/load';

export const dynamic = 'force-dynamic';

function unavailable(error: unknown) {
  if (error instanceof InvalidPlanningProfileError) {
    return NextResponse.json({ status: 'unavailable', code: 'PROFILE_INVALID', error: error.message }, { status: 500 });
  }
  return NextResponse.json({
    status: 'unavailable',
    code: 'DATABASE_UNAVAILABLE',
    error: 'Your planning profile is unavailable. Configure DATABASE_URL in environment settings and check the database connection.',
  }, { status: 503, headers: { 'Cache-Control': 'no-store' } });
}

export async function GET() {
  try {
    return NextResponse.json(await loadPlanningProfile(), { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return unavailable(error);
  }
}

/** Replace the complete profile. Omitted personal facts remain unknown. */
export async function PUT(request: NextRequest) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }
  const result = planningProfileSchema.safeParse(body);
  if (!result.success) {
    return NextResponse.json({
      error: result.error.issues.map(issue => `${issue.path.join('.') || 'profile'}: ${issue.message}`).join('; '),
      code: 'PROFILE_VALIDATION_FAILED',
    }, { status: 400 });
  }
  try {
    await savePlanningProfile(result.data);
    return NextResponse.json({ profile: result.data, saved: true }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return unavailable(error);
  }
}
