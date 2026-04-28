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
  /** Optional stable reference for idempotency. When set, callers can
   *  detect re-runs by querying journal_entries.reference instead of
   *  re-deriving (mortgage,date,amount). Used by the bulk-paste path
   *  to make re-pasting the same list a no-op. */
  reference?: string | null;
}): Promise<number> {
  const db = getDb();
  const { mortgageId, paymentDate, totalAmount, principalAmount, interestAmount, payerOwnerId, fromAccountId, reference } = params;

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

  // Create main payment journal entry. property_id stamps the journal so the
  // tax-year report's mortgage-interest bucket picks up the interest portion.
  // If principal is zero (interest-only mortgage), we skip the liability leg
  // entirely so the journal still balances on a 2-leg shape rather than
  // emitting a £0.00 book_entry that clutters reports.
  const entries: Array<{ accountId: number; amount: string }> = [
    { accountId: fromAccountId, amount: total.neg().toString() },
    { accountId: interestAccount.id, amount: interest.toString() },
  ];
  if (!principal.isZero()) {
    entries.push({ accountId: liabilityAccountId, amount: principal.toString() });
  }

  const journalId = await journalRepo.createEntry(
    {
      date: paymentDate,
      description: `Mortgage payment - ${mortgage.lender}`,
      reference: reference ?? null,
      propertyId,
    },
    entries,
  );

  // Create capital contribution entry. Tag the property too — capital movements
  // are property-specific and stamping makes property-scoped queries cheap.
  // Skip entirely on interest-only payments (principal=0) - there's no
  // equity to contribute and a £0.00 / £0.00 journal would clutter equity
  // history without conveying anything.
  if (!principal.isZero()) {
    const equityTracking = await accountRepo.getOrCreate(
      `Equity Contributions - ${mortgage.lender}`,
      'EQUITY',
    );

    await journalRepo.createEntry(
      {
        date: paymentDate,
        description: `Capital contribution via mortgage principal - ${mortgage.lender}`,
        propertyId,
      },
      [
        { accountId: payerCapitalAccountId, amount: principal.toString() },
        { accountId: equityTracking.id, amount: principal.neg().toString() },
      ],
    );
  }

  return journalId;
}

/**
 * Bulk-record a list of mortgage payments. Idempotent across re-runs:
 * each payment carries a stable reference of the form
 * `mortgage_payment:<mortgageId>:<isoDate>:<amount>`; we look those
 * up first and skip any that already exist. The shared interest-only
 * flag and per-mortgage rate history mean each row needs an
 * interest/principal split here rather than at the call site.
 *
 * For interest-only mortgages every payment is fully interest. For
 * repayment mortgages the caller can pass a per-payment principal
 * split; if none is provided we default to fully-interest and
 * surface a hint so the AI / UI can warn the user.
 */
export async function recordMortgagePayments(params: {
  mortgageId: number;
  payerOwnerId: number;
  fromAccountId: number;
  payments: Array<{
    date: string;
    amount: string;
    /** Optional explicit principal split; defaults to "0" (interest-only). */
    principal?: string;
  }>;
}): Promise<{
  added: Array<{ journalId: number; date: string; amount: string }>;
  duplicates: Array<{ date: string; amount: string; existingJournalId: number }>;
  errors: Array<{ date: string; amount: string; message: string }>;
}> {
  const { mortgageId, payerOwnerId, fromAccountId, payments } = params;
  const db = getDb();

  const added: Array<{ journalId: number; date: string; amount: string }> = [];
  const duplicates: Array<{ date: string; amount: string; existingJournalId: number }> = [];
  const errors: Array<{ date: string; amount: string; message: string }> = [];

  // Pre-load existing references in one query so re-pasting the
  // user's full list doesn't fan out into N SELECTs.
  const refs = payments.map(p => `mortgage_payment:${mortgageId}:${p.date}:${p.amount}`);
  const existing = await db.execute(sql`
    SELECT id, reference FROM journal_entries
     WHERE reference = ANY(${refs}::text[])
  `);
  const existingByRef = new Map<string, number>();
  for (const r of existing.rows) {
    existingByRef.set(r.reference as string, r.id as number);
  }

  for (const p of payments) {
    const reference = `mortgage_payment:${mortgageId}:${p.date}:${p.amount}`;
    const dupId = existingByRef.get(reference);
    if (dupId !== undefined) {
      duplicates.push({ date: p.date, amount: p.amount, existingJournalId: dupId });
      continue;
    }

    const totalDec = new Decimal(p.amount);
    const principalDec = new Decimal(p.principal ?? '0');
    const interestDec = totalDec.minus(principalDec);
    if (interestDec.isNegative()) {
      errors.push({
        date: p.date,
        amount: p.amount,
        message: `principal ${principalDec.toFixed(2)} exceeds total ${totalDec.toFixed(2)}`,
      });
      continue;
    }

    try {
      const journalId = await recordMortgagePayment({
        mortgageId,
        paymentDate: p.date,
        totalAmount: totalDec.toFixed(2),
        principalAmount: principalDec.toFixed(2),
        interestAmount: interestDec.toFixed(2),
        payerOwnerId,
        fromAccountId,
        reference,
      });
      added.push({ journalId, date: p.date, amount: totalDec.toFixed(2) });
    } catch (e) {
      errors.push({
        date: p.date,
        amount: p.amount,
        message: e instanceof Error ? e.message : 'unknown',
      });
    }
  }

  return { added, duplicates, errors };
}
