import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import Decimal from 'decimal.js';
import { recordMortgagePayments } from '@/lib/properties/mortgage-tracker';
import { isMortgagePaymentIsoDate } from '@/lib/properties/mortgage-payment-date-review';
import { propertyRepo } from '@/lib/repos/property.repo';
import { accountRepo } from '@/lib/repos/account.repo';

const idSchema = z.number().int().positive().max(2147483647);
const amountSchema = z.string().superRefine((value, ctx) => {
  if (!/^\d+(?:\.\d{1,2})?$/.test(value)) {
    ctx.addIssue({ code: 'custom', message: 'Use a non-negative decimal amount with at most two decimal places.' });
  } else if (new Decimal(value).gte('1000000000000')) {
    ctx.addIssue({ code: 'custom', message: 'The payment amount is too large.' });
  }
});
const paymentSchema = z.object({
  date: z.string().refine(isMortgagePaymentIsoDate, 'Use a real payment date in YYYY-MM-DD format.'),
  amount: amountSchema,
  principal: amountSchema.optional(),
}).strict().superRefine((value, ctx) => {
  if (/^\d+(?:\.\d{1,2})?$/.test(value.amount) && new Decimal(value.amount).lte(0)) {
    ctx.addIssue({ code: 'custom', path: ['amount'], message: 'Payment amount must be positive.' });
  }
  if (value.principal !== undefined && /^\d+(?:\.\d{1,2})?$/.test(value.principal)
    && /^\d+(?:\.\d{1,2})?$/.test(value.amount) && new Decimal(value.principal).gt(value.amount)) {
    ctx.addIssue({ code: 'custom', path: ['principal'], message: 'Principal cannot exceed the payment amount.' });
  }
});
const bodySchema = z.object({
  mortgageId: idSchema, payerOwnerId: idSchema, fromAccountId: idSchema,
  payments: z.array(paymentSchema).min(1).max(100),
}).strict();

/** Validated payments retain row-level saved/duplicate/review outcomes. */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const rawId = (await params).id;
  const propertyId = /^\d+$/.test(rawId) ? Number(rawId) : NaN;
  const body = bodySchema.safeParse(await request.json().catch(() => null));
  if (!idSchema.safeParse(propertyId).success || !body.success) {
    return NextResponse.json({ error: 'Supply valid IDs and 1–100 payments with real calendar dates, positive amounts and valid principal splits.' }, { status: 400 });
  }
  try {
    const { mortgageId, payerOwnerId, fromAccountId, payments } = body.data;
    const [mortgages, account] = await Promise.all([propertyRepo.getMortgages(propertyId), accountRepo.getById(fromAccountId)]);
    const mortgage = mortgages.find(item => item.id === mortgageId);
    if (!mortgage) return NextResponse.json({ error: 'The mortgage does not belong to this property.' }, { status: 400 });
    if (!account || account.accountType !== 'ASSET') return NextResponse.json({ error: 'Choose an existing asset account that paid the mortgage.' }, { status: 400 });
    if (!mortgage.interestOnly && payments.some(payment => payment.principal === undefined)) {
      return NextResponse.json({ error: 'This mortgage is not marked interest-only. Supply the confirmed principal split for every payment.' }, { status: 400 });
    }
    const result = await recordMortgagePayments({ mortgageId, payerOwnerId, fromAccountId, payments });
    return NextResponse.json({ added: result.added.length, duplicates: result.duplicates.length, errors: result.errors.length, details: result }, { status: 201 });
  } catch {
    return NextResponse.json({ error: 'The payment save could not be confirmed. Keep the original statement and check recorded payments before retrying.' }, { status: 503 });
  }
}
