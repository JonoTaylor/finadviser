import { NextRequest, NextResponse } from 'next/server';
import { journalRepo } from '@/lib/repos';

const TRANSFER_KINDS = [
  'statement_payment',
  'pot_transfer',
  'cross_bank',
  'self_transfer',
  'refund',
  'manual',
] as const;
type TransferKind = (typeof TRANSFER_KINDS)[number];

function isTransferKind(value: unknown): value is TransferKind {
  return typeof value === 'string' && (TRANSFER_KINDS as readonly string[]).includes(value);
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const journalId = body?.journalId;
    const pairedJournalId = body?.pairedJournalId;
    const rawKind = body?.kind;

    if (typeof journalId !== 'number') {
      return NextResponse.json({ error: 'journalId is required' }, { status: 400 });
    }
    if (pairedJournalId !== undefined && pairedJournalId !== null && typeof pairedJournalId !== 'number') {
      return NextResponse.json({ error: 'pairedJournalId must be a number' }, { status: 400 });
    }
    if (rawKind !== undefined && !isTransferKind(rawKind)) {
      return NextResponse.json({ error: `kind must be one of: ${TRANSFER_KINDS.join(', ')}` }, { status: 400 });
    }
    const kind: TransferKind = isTransferKind(rawKind) ? rawKind : 'manual';

    if (typeof pairedJournalId === 'number') {
      const mergedId = await journalRepo.mergeTransferPair(journalId, pairedJournalId, kind);
      return NextResponse.json({ success: true, merged: true, journalId: mergedId, kind });
    }

    await journalRepo.markAsTransfer(journalId, kind);
    return NextResponse.json({ success: true, merged: false, journalId, kind });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to mark transfer';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const url = new URL(request.url);
    const idParam = url.searchParams.get('journalId');
    const journalId = idParam ? Number(idParam) : NaN;
    if (!Number.isFinite(journalId)) {
      return NextResponse.json({ error: 'journalId is required' }, { status: 400 });
    }
    await journalRepo.unmarkTransfer(journalId);
    return NextResponse.json({ success: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to unmark transfer';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function GET(request: NextRequest) {
  try {
    const url = new URL(request.url);
    const idParam = url.searchParams.get('journalId');
    const windowParam = url.searchParams.get('windowDays');
    const journalId = idParam ? Number(idParam) : NaN;
    if (!Number.isFinite(journalId)) {
      return NextResponse.json({ error: 'journalId is required' }, { status: 400 });
    }
    let windowDays = 3;
    if (windowParam !== null) {
      const parsed = Number(windowParam);
      if (!Number.isFinite(parsed)) {
        return NextResponse.json(
          { error: 'windowDays must be an integer between 0 and 30' },
          { status: 400 },
        );
      }
      windowDays = Math.min(Math.max(Math.trunc(parsed), 0), 30);
    }
    const candidates = await journalRepo.findTransferCandidates(journalId, windowDays, 10);
    return NextResponse.json({ journalId, windowDays, candidates });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to find candidates';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
