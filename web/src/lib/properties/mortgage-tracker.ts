import Decimal from 'decimal.js';
import { accountRepo, journalRepo, propertyRepo } from '@/lib/repos';
import { getDb } from '@/lib/db';
import { sql } from 'drizzle-orm';

export async function recordMortgagePayment(params: {
  mortgageId: number;
  paymentDate: string;
  totalAmount: string;
  principalAmount: string;
  interestAmount: string;
  payerOwnerId: number;
  fromAccountId: number;
}): Promise<number> {
  const db = getDb();
  const { mortgageId, paymentDate, totalAmount, principalAmount, interestAmount, payerOwnerId, fromAccountId } = params;

  // Get mortgage details
  const mortgageRows = await db.execute(sql`SELECT * FROM mortgages WHERE id = ${mortgageId}`);
  const mortgage = mortgageRows.rows[0];
  if (!mortgage) throw new Error(`Mortgage ${mortgageId} not found`);

  const liabilityAccountId = mortgage.liability_account_id as number;
  const propertyId = mortgage.property_id as number;

  // Get payer's capital account
  const ownership = await propertyRepo.getOwnership(propertyId);
  let payerCapitalAccountId: number | null = null;
  for (const own of ownership) {
    if (own.owner_id === payerOwnerId) {
      payerCapitalAccountId = own.capital_account_id as number;
      break;
    }
  }
  if (!payerCapitalAccountId) {
    throw new Error(`Owner ${payerOwnerId} does not own property ${propertyId}`);
  }

  // Get or create interest expense account
  const interestAccount = await accountRepo.getOrCreate('Mortgage Interest', 'EXPENSE');

  const total = new Decimal(totalAmount);
  const principal = new Decimal(principalAmount);
  const interest = new Decimal(interestAmount);

  // Create main payment journal entry
  const journalId = await journalRepo.createEntry(
    {
      date: paymentDate,
      description: `Mortgage payment - ${mortgage.lender}`,
    },
    [
      { accountId: fromAccountId, amount: total.neg().toString() },
      { accountId: liabilityAccountId, amount: principal.toString() },
      { accountId: interestAccount.id, amount: interest.toString() },
    ],
  );

  // Create capital contribution entry
  const equityTracking = await accountRepo.getOrCreate(
    `Equity Contributions - ${mortgage.lender}`,
    'EQUITY',
  );

  await journalRepo.createEntry(
    {
      date: paymentDate,
      description: `Capital contribution via mortgage principal - ${mortgage.lender}`,
    },
    [
      { accountId: payerCapitalAccountId, amount: principal.toString() },
      { accountId: equityTracking.id, amount: principal.neg().toString() },
    ],
  );

  return journalId;
}
