import Decimal from 'decimal.js';
import { accountRepo, journalRepo, propertyRepo, tenancyRepo } from '@/lib/repos';

export interface RecordRentalIncomeInput {
  propertyId: number;
  date: string;
  amount: string;
  toAccountId: number;
  description?: string;
  tenancyId?: number | null;
}

/**
 * Record gross rent received. Creates a single balanced journal entry stamped
 * with property_id so the tax-year report picks it up. Per-owner share is
 * derived at report time from expense_allocation_rules — we do NOT split the
 * income across capital accounts here, because Jane's tax filing wants gross
 * receipts, not equity movements.
 */
export async function recordRentalIncome(input: RecordRentalIncomeInput): Promise<number> {
  const property = await propertyRepo.getProperty(input.propertyId);
  if (!property) throw new Error(`Property ${input.propertyId} not found`);

  const fromAccount = await accountRepo.getById(input.toAccountId);
  if (!fromAccount) throw new Error(`Account ${input.toAccountId} not found`);
  if (fromAccount.accountType !== 'ASSET') {
    throw new Error(`Rent can only be received into an ASSET account (got ${fromAccount.accountType})`);
  }

  const incomeAccount = await accountRepo.getOrCreate('Rental Income', 'INCOME');

  let description = input.description?.trim();
  if (!description && input.tenancyId) {
    const tenancy = await tenancyRepo.get(input.tenancyId);
    if (tenancy) description = `Rent received - ${tenancy.tenantName}`;
  }
  description = description || 'Rent received';

  const amount = new Decimal(input.amount);
  if (amount.isNeg() || amount.isZero()) {
    throw new Error('Rental income amount must be positive');
  }

  return journalRepo.createEntry(
    {
      date: input.date,
      description,
      propertyId: input.propertyId,
    },
    [
      { accountId: input.toAccountId, amount: amount.toFixed(2) },
      { accountId: incomeAccount.id, amount: amount.neg().toFixed(2) },
    ],
  );
}
