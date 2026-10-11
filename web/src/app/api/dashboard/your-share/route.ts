import { NextRequest, NextResponse } from 'next/server';
import { calculatePersonalNetWorth } from '@/lib/properties/personal-net-worth';
import { propertyRepo } from '@/lib/repos';
import { loadFinancialContext } from '@/lib/finance-context';
import { workspaceErrorResponse } from '@/lib/finance-workspace/api';

/**
 * GET /api/dashboard/your-share?ownerId=N
 *
 * Returns the owner-scoped net-worth view used by the dashboard's
 * "Your share" card. If ownerId is omitted, use the explicitly saved
 * personal owner. No alphabetical household member becomes the user.
 */
export async function GET(request: NextRequest) {
  try {
    const owners = await propertyRepo.listOwners();
    if (owners.length === 0) {
      return NextResponse.json({ owners: [], yourShare: null });
    }

    const param = request.nextUrl.searchParams.get('ownerId');
    let ownerId: number | null = null;
    if (param !== null) {
      const parsed = Number(param);
      if (!/^\d+$/.test(param) || !Number.isSafeInteger(parsed) || parsed <= 0) {
        return NextResponse.json({ error: 'Invalid ownerId' }, { status: 400 });
      }
      if (!owners.some(o => o.id === parsed)) {
        return NextResponse.json({ error: 'Owner not found' }, { status: 404 });
      }
      ownerId = parsed;
    } else {
      ownerId = (await loadFinancialContext()).data.ownerId;
      if (ownerId !== null && !owners.some(owner => owner.id === ownerId)) {
        return NextResponse.json({ error: 'Your saved owner is unavailable. Review My context before using a personal total.' }, { status: 422 });
      }
    }

    if (ownerId === null) return NextResponse.json({ owners: owners.map(owner => ({ id: owner.id, name: owner.name })), yourShare: null, requiresOwnerSelection: true }, { headers: { 'Cache-Control': 'no-store' } });

    const yourShare = await calculatePersonalNetWorth(ownerId);
    return NextResponse.json({
      owners: owners.map(o => ({ id: o.id, name: o.name })),
      yourShare,
    });
  } catch (error) {
    return workspaceErrorResponse(error);
  }
}
