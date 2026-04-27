import { NextResponse } from 'next/server';
import { untagJournalPropertyExpense } from '@/lib/properties/property-expense-link';

/**
 * POST /api/properties/journal/[id]/untag
 *
 * Clears `journal_entries.property_id` so this transaction stops
 * showing on any property's expense list / tax-year report. Used by
 * the inline "untag" button on the property page Expenses card.
 *
 * Doesn't touch the category - the journal stays where it is in the
 * chart of accounts. If the user wants to re-categorise too, they
 * do that from the transactions page.
 */
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const journalId = parseInt(id, 10);
    if (Number.isNaN(journalId)) {
      return NextResponse.json({ error: 'Invalid journal id' }, { status: 400 });
    }
    const result = await untagJournalPropertyExpense(journalId);
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to untag';
    if (message.includes('not found')) {
      return NextResponse.json({ error: message }, { status: 404 });
    }
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
