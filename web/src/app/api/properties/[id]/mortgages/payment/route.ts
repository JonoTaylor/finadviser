import { NextRequest, NextResponse } from 'next/server';
import { recordMortgagePayment } from '@/lib/properties/mortgage-tracker';
import { isValidCalendarDate } from '@/lib/properties/mortgage-rate-validation';
import { propertyRepo } from '@/lib/repos';
import { ClientError, NotFoundError } from '@/lib/errors';
import { nonNegativeMoney, round2 } from '@/lib/tax/moneyInput';
import { formatCurrency } from '@/lib/utils/formatting';
import { routeErrorResponse, readJsonBody, parseId } from '@/lib/http/route-errors';

/**
 * Records one mortgage payment. Everything is checked before writing so a
 * mistake comes back as a clear message rather than a half-recorded payment.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const propertyId = parseId((await params).id, 'property id');
    const body = await readJsonBody(request);
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      throw new ClientError('Send the payment details as a JSON object.');
    }
    const mortgageId = parseId(String(body.mortgageId ?? ''), 'mortgage');
    const payerOwnerId = parseId(String(body.payerOwnerId ?? ''), 'payer');
    const fromAccountId = parseId(String(body.fromAccountId ?? ''), 'payment account');
    if (typeof body.paymentDate !== 'string' || !isValidCalendarDate(body.paymentDate)) {
      throw new ClientError('Enter a real payment date as YYYY-MM-DD.');
    }
    const total = round2(nonNegativeMoney(body.totalAmount, 'Total amount'));
    const principal = round2(nonNegativeMoney(body.principalAmount, 'Principal amount'));
    const interest = round2(nonNegativeMoney(body.interestAmount, 'Interest amount'));
    if (total.isZero()) throw new ClientError('Total amount must be more than zero.');
    if (!principal.plus(interest).equals(total)) {
      throw new ClientError(
        `Principal (${formatCurrency(principal.toFixed(2))}) and interest (${formatCurrency(interest.toFixed(2))}) must add up to the total amount (${formatCurrency(total.toFixed(2))}).`,
      );
    }

    const mortgage = await propertyRepo.getMortgage(mortgageId);
    if (!mortgage || mortgage.propertyId !== propertyId) {
      throw new NotFoundError('That mortgage is not recorded on this property.');
    }

    const journalId = await recordMortgagePayment({
      mortgageId,
      paymentDate: body.paymentDate,
      totalAmount: total.toFixed(2),
      principalAmount: principal.toFixed(2),
      interestAmount: interest.toFixed(2),
      payerOwnerId,
      fromAccountId,
    });
    return NextResponse.json({ journalId }, { status: 201 });
  } catch (error) {
    return routeErrorResponse(error, 'Failed to record payment', { exposeMessage: true });
  }
}
