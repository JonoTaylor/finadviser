import { NextRequest, NextResponse } from 'next/server';
import { calculatePersonalNetWorth } from '@/lib/properties/personal-net-worth';
import { propertyRepo } from '@/lib/repos';

/**
 * GET /api/dashboard/your-share?ownerId=N
 *
 * Returns the owner-scoped net-worth view used by the dashboard's
 * "Your share" card. If ownerId is omitted, defaults to the first
 * owner alphabetically (so the page has something to render before
 * the user picks). The card surfaces the list of owners so the user
 * can switch.
 */
export async function GET(request: NextRequest) {
  try {
    const owners = await propertyRepo.listOwners();
    if (owners.length === 0) {
      return NextResponse.json({ owners: [], yourShare: null });
    }

    const param = request.nextUrl.searchParams.get('ownerId');
    let ownerId = owners[0].id;
    if (param !== null) {
      const parsed = parseInt(param, 10);
      if (Number.isNaN(parsed)) {
        return NextResponse.json({ error: 'Invalid ownerId' }, { status: 400 });
      }
      if (!owners.some(o => o.id === parsed)) {
        return NextResponse.json({ error: 'Owner not found' }, { status: 404 });
      }
      ownerId = parsed;
    }

    const yourShare = await calculatePersonalNetWorth(ownerId);
    return NextResponse.json({
      owners: owners.map(o => ({ id: o.id, name: o.name })),
      yourShare,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to load your share';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
