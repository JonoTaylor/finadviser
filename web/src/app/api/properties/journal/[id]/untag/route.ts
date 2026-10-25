import { NextResponse } from 'next/server';
import { untagJournalPropertyExpense } from '@/lib/properties/property-expense-link';
import { parseId, routeErrorResponse } from '@/lib/http/route-errors';

/**
 * POST /api/properties/journal/[id]/untag
 *
 * Clears `journal_entries.property_id` so this transaction stops
 * showing on any property's expense list / tax-year report. Used by
 * the inline "untag" button on the property page Expenses card and the
 * transaction category dialog.
 *
 * Doesn't touch the category - the journal stays where it is in the
 * chart of accounts. If the user wants to re-categorise too, they
 * do that from the transactions page.
 */
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const journalId = parseId((await params).id, 'journal id');
    const result = await untagJournalPropertyExpense(journalId);
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    return routeErrorResponse(error, 'Failed to untag', { exposeMessage: true });
  }
}
