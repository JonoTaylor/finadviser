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
    // Pull paysOffAccountId out before the create so it doesn't get
    // forwarded to accountRepo.create (which doesn't accept it as a
    // creation field). The create-then-update sequence is non-atomic
    // (no neon-http transaction support), but the failure mode is
    // benign: the account exists without the link, and the user can
    // set it later via the connections-mapping wizard or the Chart
    // of Accounts UI.
    const { paysOffAccountId, ...createBody } = body ?? {};
    const account = await accountRepo.create(createBody);
    let responseAccount: typeof account & { paysOffAccountId?: number | null } = account;
    if (typeof paysOffAccountId === 'number' && paysOffAccountId !== account.id) {
      const updated = await accountRepo.update(account.id, { paysOffAccountId });
      responseAccount = updated ?? { ...account, paysOffAccountId };
    }
    return NextResponse.json(responseAccount, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: 'Failed to create account' }, { status: 500 });
  }
}
