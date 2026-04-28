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

    // Pre-validate the shape of every mapping so we can surface a
    // single clear 400 before doing any DB work.
    for (const m of mappings) {
      if (typeof m.aggregatorAccountRef !== 'string' || typeof m.accountId !== 'number') {
        return NextResponse.json(
          { error: 'each mapping requires aggregatorAccountRef (string) and accountId (number)' },
          { status: 400 },
        );
      }
      if (m.paysOffAccountId !== undefined && m.paysOffAccountId !== null && typeof m.paysOffAccountId !== 'number') {
        return NextResponse.json(
          { error: 'paysOffAccountId, when present, must be a number (or null to clear)' },
          { status: 400 },
        );
      }
      if (typeof m.paysOffAccountId === 'number' && m.paysOffAccountId === m.accountId) {
        return NextResponse.json(
          { error: 'paysOffAccountId must reference a different account' },
          { status: 400 },
        );
      }
    }

    // Detect conflicting pays_off choices when the same internal
    // account is bound to multiple provider rows in this request.
    // Without this, the later UPDATE silently overwrites the earlier
    // one based on iteration order. Coalesce to one value per
    // accountId; reject if values differ.
    const paysOffByAccount = new Map<number, number | null>();
    for (const m of mappings) {
      if (m.paysOffAccountId === undefined) continue;
      if (paysOffByAccount.has(m.accountId)) {
        const existing = paysOffByAccount.get(m.accountId);
        if (existing !== m.paysOffAccountId) {
          return NextResponse.json(
            { error: `Conflicting paysOffAccountId for internal account ${m.accountId}: ${existing} vs ${m.paysOffAccountId}` },
            { status: 400 },
          );
        }
      } else {
        paysOffByAccount.set(m.accountId, m.paysOffAccountId);
      }
    }

    // Bulk-fetch every internal account referenced by this request
    // (mapping targets + pays_off partners) so the validation pass
    // doesn't run N queries through the loop. Defence in depth: the
    // sync engine writes the bank-side amount on the mapped account;
    // binding a non-ASSET (e.g. EQUITY or EXPENSE) would produce
    // nonsense ledger entries that the journal-balance trigger can't
    // catch because the per-journal sums still net to zero.
    const referencedIds = new Set<number>();
    for (const m of mappings) {
      referencedIds.add(m.accountId);
      if (typeof m.paysOffAccountId === 'number') referencedIds.add(m.paysOffAccountId);
    }
    const accountsById = await accountRepo.getByIds(Array.from(referencedIds));

    for (const m of mappings) {
      const target = accountsById.get(m.accountId);
      if (!target) {
        return NextResponse.json({ error: `Internal account ${m.accountId} not found` }, { status: 400 });
      }
      if (target.accountType !== 'ASSET') {
        return NextResponse.json(
          { error: `Internal account ${m.accountId} (${target.name}) must be ASSET; got ${target.accountType}` },
          { status: 400 },
        );
      }
      if (typeof m.paysOffAccountId === 'number' && !accountsById.has(m.paysOffAccountId)) {
        return NextResponse.json(
          { error: `paysOffAccountId ${m.paysOffAccountId} not found` },
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

    // Apply pays_off updates once per accountId, after every upsert
    // succeeds, using the coalesced map. This avoids the order-
    // dependent overwrite when two provider rows bind to the same
    // internal account.
    for (const [accountId, paysOff] of paysOffByAccount) {
      await accountRepo.update(accountId, { paysOffAccountId: paysOff });
    }

    return NextResponse.json({ ok: true, mappings: created });
  } catch (err) {
    console.error('Map mappings failed:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
