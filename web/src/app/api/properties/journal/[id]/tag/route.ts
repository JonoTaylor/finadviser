import { NextResponse } from 'next/server';
import { tagJournalAsPropertyExpense } from '@/lib/properties/property-expense-link';
import { ClientError } from '@/lib/errors';
import { parseId, readJsonBody, routeErrorResponse } from '@/lib/http/route-errors';

/**
 * POST /api/properties/journal/[id]/tag  { propertyId }
 *
 * Links one transaction to a property so it appears on that property's
 * expense list and tax-year report. Always an explicit user choice: the
 * category is left as it is and nothing is inferred.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const journalId = parseId((await params).id, 'transaction id');
    const body = await readJsonBody(request);
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      throw new ClientError('Choose the property to link this transaction to.');
    }
    const propertyId = parseId(String(body.propertyId ?? ''), 'property');
    const result = await tagJournalAsPropertyExpense({ journalId, propertyId });
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    return routeErrorResponse(error, 'The property link could not be saved.', { exposeMessage: true });
  }
}
