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
 * `mortgage_payment:<mortgageId>:<isoDate>:<amount-with-2dp>`; we
 * look those up first and skip any that already exist. The amount
 * portion of the reference is normalised to 2 decimals so "100" and
 * "100.00" produce the same key and dedup correctly.
 *
 * Performance: shared resources (mortgage row, payer's capital
 * account, "Mortgage Interest" expense account, and the per-lender
 * "Equity Contributions" equity account) are fetched ONCE outside
 * the loop, then the per-payment journals are inserted in two
 * multi-row INSERTs via journalRepo.createEntriesBulk. Without this
 * hoisting, recording 30+ payments would fire ~5 SELECTs and 3
 * INSERTs each — 240+ round-trips. With it, we hit the DB ~6 times
 * total regardless of payment count.
 *
 * For interest-only mortgages every payment is fully interest (no
 * principal/equity legs). For repayment mortgages the caller can
 * pass a per-payment principal split.
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
  /** existingJournalId is null when the duplicate is intra-batch
   *  (the same date+amount appeared twice in the submitted list);
   *  numeric when the row already exists in journal_entries from a
   *  prior import. */
  duplicates: Array<{ date: string; amount: string; existingJournalId: number | null }>;
  errors: Array<{ date: string; amount: string; message: string }>;
}> {
  const { mortgageId, payerOwnerId, fromAccountId, payments } = params;
  const db = getDb();

  const added: Array<{ journalId: number; date: string; amount: string }> = [];
  const duplicates: Array<{ date: string; amount: string; existingJournalId: number | null }> = [];
  const errors: Array<{ date: string; amount: string; message: string }> = [];

  if (payments.length === 0) {
    return { added, duplicates, errors };
  }

  // Hoist all shared resources ONCE rather than per-payment - the
  // mortgage row, ownership table, "Mortgage Interest" expense, and
  // the equity-contribution account don't change between rows in a
  // single bulk call.
  const mortgageRows = await db.execute(sql`SELECT * FROM mortgages WHERE id = ${mortgageId}`);
  const mortgage = mortgageRows.rows[0];
  if (!mortgage) throw new Error(`Mortgage ${mortgageId} not found`);
  const liabilityAccountId = mortgage.liability_account_id as number;
  const propertyId = mortgage.property_id as number;
  const lender = mortgage.lender as string;

  const ownership = await propertyRepo.getOwnership(propertyId);
  const payerOwn = ownership.find(o => o.owner_id === payerOwnerId);
  if (!payerOwn) {
    throw new Error(`Owner ${payerOwnerId} does not own property ${propertyId}`);
  }
  const payerCapitalAccountId = payerOwn.capital_account_id as number;

  const interestAccount = await accountRepo.getOrCreate('Mortgage Interest', 'EXPENSE');

  // Pre-load existing references in ONE query so re-pasting the
  // user's full list doesn't fan out into N SELECTs. Use the
  // normalised amount (Decimal.toFixed(2)) so "100" and "100.00"
  // produce the same key.
  const buildRef = (date: string, amountFixed: string) =>
    `mortgage_payment:${mortgageId}:${date}:${amountFixed}`;
  const refs = payments.map(p => buildRef(p.date, new Decimal(p.amount).toFixed(2)));
  const existing = await db.execute(sql`
    SELECT id, reference FROM journal_entries
     WHERE reference = ANY(${refs}::text[])
  `);
  const existingByRef = new Map<string, number>();
  for (const r of existing.rows) {
    existingByRef.set(r.reference as string, r.id as number);
  }

  // Build the journal items in memory first; defer the DB writes
  // until after every payment has been validated. This keeps the
  // partial-failure shape clean: if row 7 has a bad principal split,
  // rows 0-6 still record successfully and the caller sees row 7 in
  // `errors`. Equity-contribution journals are collected separately
  // because they only fire on repayment mortgages.
  // seenInBatch supplements existingByRef: the DB pre-load only
  // catches references that already exist; intra-batch duplicates
  // (same line pasted twice) need their own guard so both don't
  // get inserted.
  const seenInBatch = new Set<string>();
  const paymentItems: Array<{
    payment: { date: string; amount: string };
    reference: string;
    journal: { date: string; description: string; reference: string; propertyId: number };
    entries: Array<{ accountId: number; amount: string }>;
    principalDec: Decimal;
  }> = [];

  for (const p of payments) {
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

    const amountFixed = totalDec.toFixed(2);
    const reference = buildRef(p.date, amountFixed);
    const dupId = existingByRef.get(reference);
    if (dupId !== undefined) {
      duplicates.push({ date: p.date, amount: amountFixed, existingJournalId: dupId });
      continue;
    }
    // Intra-batch dedup: a single pasted list can contain the same
    // date+amount twice (e.g. the user accidentally double-pasted a
    // line). Without this guard both rows would queue + insert and
    // the endpoint's idempotency promise breaks. Track refs we've
    // seen in this loop and skip subsequent occurrences.
    if (seenInBatch.has(reference)) {
      duplicates.push({ date: p.date, amount: amountFixed, existingJournalId: null });
      continue;
    }
    seenInBatch.add(reference);

    const entries: Array<{ accountId: number; amount: string }> = [
      { accountId: fromAccountId, amount: totalDec.neg().toString() },
      { accountId: interestAccount.id, amount: interestDec.toString() },
    ];
    if (!principalDec.isZero()) {
      entries.push({ accountId: liabilityAccountId, amount: principalDec.toString() });
    }

    paymentItems.push({
      payment: { date: p.date, amount: amountFixed },
      reference,
      journal: {
        date: p.date,
        description: `Mortgage payment - ${lender}`,
        reference,
        propertyId,
      },
      entries,
      principalDec,
    });
  }

  if (paymentItems.length === 0) {
    return { added, duplicates, errors };
  }

  // Two multi-row INSERTs for all payment journals.
  let paymentJournalIds: number[];
  try {
    paymentJournalIds = await journalRepo.createEntriesBulk(
      paymentItems.map(it => ({ journal: it.journal, entries: it.entries })),
    );
  } catch (e) {
    // The bulk insert is all-or-nothing; if it fails we surface the
    // error against every queued row so the caller can log it. We
    // don't try to recover by falling back to per-row inserts because
    // the most likely cause (a balance-violation or FK miss) would
    // hit the per-row path the same way.
    const message = e instanceof Error ? e.message : 'createEntriesBulk failed';
    for (const it of paymentItems) {
      errors.push({ date: it.payment.date, amount: it.payment.amount, message });
    }
    return { added, duplicates, errors };
  }

  for (let i = 0; i < paymentItems.length; i++) {
    const it = paymentItems[i];
    added.push({
      journalId: paymentJournalIds[i],
      date: it.payment.date,
      amount: it.payment.amount,
    });
  }

  // Equity-contribution journals (only for rows with non-zero
  // principal — interest-only mortgages skip this entire branch).
  const equityItems = paymentItems.filter(it => !it.principalDec.isZero());
  if (equityItems.length > 0) {
    const equityTracking = await accountRepo.getOrCreate(
      `Equity Contributions - ${lender}`,
      'EQUITY',
    );
    await journalRepo.createEntriesBulk(
      equityItems.map(it => ({
        journal: {
          date: it.journal.date,
          description: `Capital contribution via mortgage principal - ${lender}`,
          propertyId,
        },
        entries: [
          { accountId: payerCapitalAccountId, amount: it.principalDec.toString() },
          { accountId: equityTracking.id, amount: it.principalDec.neg().toString() },
        ],
      })),
    );
  }

  return { added, duplicates, errors };
}
