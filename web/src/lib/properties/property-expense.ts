import Decimal from 'decimal.js';
import { accountRepo, journalRepo, propertyRepo } from '@/lib/repos';
import { ClientError } from '@/lib/errors';

export interface RecordPropertyExpenseInput {
  propertyId: number;
  date: string;
  amount: string;
  fromAccountId: number;
  categoryId?: number | null;
  description?: string;
  reference?: string | null;
}

/**
 * Record an itemised property expense as a balanced journal entry, stamped
 * with property_id and (optionally) category_id so the tax-year report
 * picks it up and groups it correctly.
 *
 * Posts:  DR Property Expenses (system account)   amount
 *         CR fromAccount (e.g. Emily's bank)      amount
 *
 * Mortgage interest is deliberately NOT routed through here — that account
 * is separate (S.24 restricted) and is created by mortgage-tracker.
 */
export async function recordPropertyExpense(input: RecordPropertyExpenseInput): Promise<number> {
  const property = await propertyRepo.getProperty(input.propertyId);
  if (!property) throw new ClientError(`Property ${input.propertyId} not found`);

  const fromAccount = await accountRepo.getById(input.fromAccountId);
  if (!fromAccount) throw new ClientError(`Account ${input.fromAccountId} not found`);
  if (fromAccount.accountType !== 'ASSET') {
    throw new ClientError(`Property expenses must be paid from an ASSET account (got ${fromAccount.accountType})`);
  }

  const expenseAccount = await accountRepo.getOrCreate('Property Expenses', 'EXPENSE');

  // Decimal throws on garbage input; turn that into a 400 instead of a 500.
  let amount: Decimal;
  try {
    amount = new Decimal(input.amount);
  } catch {
    throw new ClientError(`Invalid amount: ${input.amount}`);
  }
  if (amount.isNeg() || amount.isZero()) {
    throw new ClientError('Property expense amount must be positive');
  }

  const description = (input.description ?? '').trim() || 'Property expense';
  const reference = input.reference?.trim() || null;

  return journalRepo.createEntry(
    {
      date: input.date,
      description,
      reference,
      categoryId: input.categoryId ?? null,
      propertyId: input.propertyId,
    },
    [
      { accountId: input.fromAccountId, amount: amount.neg().toFixed(2) },
      { accountId: expenseAccount.id, amount: amount.toFixed(2) },
    ],
  );
}
