import { z } from 'zod';
import { NextResponse } from 'next/server';
import { recordMortgagePayment } from '@/lib/properties/mortgage-tracker';
import { apiHandler, validateBody } from '@/lib/api/handler';
import { dateString, idNumber, moneyString } from '@/lib/api/schemas';

const bodySchema = z.object({
  mortgageId: idNumber,
  paymentDate: dateString,
  totalAmount: moneyString,
  principalAmount: moneyString,
  interestAmount: moneyString,
  payerOwnerId: idNumber,
  fromAccountId: idNumber,
});

export const POST = apiHandler(async (req) => {
  const body = await validateBody(req, bodySchema);
  const journalId = await recordMortgagePayment(body);
  return NextResponse.json({ journalId }, { status: 201 });
});
