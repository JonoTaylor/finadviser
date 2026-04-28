import { NextRequest, NextResponse } from 'next/server';
import { accountRepo } from '@/lib/repos';

export async function GET(request: NextRequest) {
  try {
    const balances = request.nextUrl.searchParams.get('balances');

    if (balances === 'true') {
      const data = await accountRepo.getBalances();
      return NextResponse.json(data);
    }

    const type = request.nextUrl.searchParams.get('type');
    if (type) {
      const data = await accountRepo.listByType(type as 'ASSET' | 'LIABILITY' | 'EQUITY' | 'INCOME' | 'EXPENSE');
      return NextResponse.json(data);
    }

    const data = await accountRepo.listAll();
    return NextResponse.json(data);
  } catch (error) {
    return NextResponse.json({ error: 'Failed to fetch accounts' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    // Optional pays_off link: persist it via accountRepo.update right
    // after the create so the caller doesn't need a separate PATCH
    // round-trip. Accepted on both ASSET and LIABILITY rows; the
    // transfer reconciler reads the link bidirectionally.
    const paysOffAccountId = body?.paysOffAccountId;
    const account = await accountRepo.create(body);
    if (typeof paysOffAccountId === 'number') {
      if (paysOffAccountId === account.id) {
        // Self-reference is meaningless; ignore rather than error
        // since the account itself already exists at this point.
      } else {
        await accountRepo.update(account.id, { paysOffAccountId });
      }
    }
    return NextResponse.json(account, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: 'Failed to create account' }, { status: 500 });
  }
}
