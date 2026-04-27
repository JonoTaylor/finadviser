import { NextResponse } from 'next/server';
import { format } from 'date-fns';
import { bankingRepo } from '@/lib/banking/repo';
import { accountRepo } from '@/lib/repos';

/**
 * POST /api/banking/connections/[id]/map
 *
 * Body: { mappings: Array<{ aggregatorAccountRef, accountId, currency?, iban?, product?, cutoverDate? }> }
 *
 * Creates (or updates) provider_accounts rows binding aggregator
 * accounts to existing internal accounts. Existing internal accounts
 * only for PR B; the "create new account" option lands in PR B.5.
 *
 * cutoverDate defaults to today; the sync engine uses it as the
 * lower-bound on transaction dates for the first sync. After that
 * the connection's last_synced_at takes over with a 7-day overlap
 * window.
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const connectionId = parseInt(id, 10);
    if (Number.isNaN(connectionId)) return NextResponse.json({ error: 'Invalid id' }, { status: 400 });

    const conn = await bankingRepo.getConnection(connectionId);
    if (!conn) return NextResponse.json({ error: 'Connection not found' }, { status: 404 });

    const body = await req.json().catch(() => ({}));
    const mappings = body.mappings;
    if (!Array.isArray(mappings) || mappings.length === 0) {
      return NextResponse.json({ error: 'mappings is required (non-empty array)' }, { status: 400 });
    }

    const today = format(new Date(), 'yyyy-MM-dd');
    const created: Array<{ id: number; aggregatorAccountRef: string; accountId: number }> = [];

    for (const m of mappings) {
      if (typeof m.aggregatorAccountRef !== 'string' || typeof m.accountId !== 'number') {
        return NextResponse.json(
          { error: 'each mapping requires aggregatorAccountRef (string) and accountId (number)' },
          { status: 400 },
        );
      }
      // Defence in depth: confirm the internal account exists AND
      // is an ASSET. The sync engine writes the bank-side amount on
      // the mapped account; binding a non-ASSET (e.g. EQUITY or
      // EXPENSE) would produce nonsense ledger entries that the
      // journal-balance trigger can't catch because the per-journal
      // sums still net to zero. The FK on provider_accounts.
      // account_id only enforces existence, not type.
      const target = await accountRepo.getById(m.accountId);
      if (!target) {
        return NextResponse.json({ error: `Internal account ${m.accountId} not found` }, { status: 400 });
      }
      if (target.accountType !== 'ASSET') {
        return NextResponse.json(
          { error: `Internal account ${m.accountId} (${target.name}) must be ASSET; got ${target.accountType}` },
          { status: 400 },
        );
      }

      const row = await bankingRepo.upsertProviderAccount({
        connectionId,
        accountId: m.accountId,
        aggregatorAccountRef: m.aggregatorAccountRef,
        iban: typeof m.iban === 'string' ? m.iban : null,
        currency: typeof m.currency === 'string' ? m.currency : 'GBP',
        product: typeof m.product === 'string' ? m.product : null,
        cutoverDate: typeof m.cutoverDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(m.cutoverDate)
          ? m.cutoverDate : today,
      });
      created.push({ id: row.id, aggregatorAccountRef: row.aggregatorAccountRef, accountId: row.accountId });
    }

    return NextResponse.json({ ok: true, mappings: created });
  } catch (err) {
    console.error('Map mappings failed:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
