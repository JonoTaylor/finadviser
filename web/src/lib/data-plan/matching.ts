import Decimal from 'decimal.js';
import type { JournalKind, LedgerLine } from './types';

/**
 * Likely-duplicate detection for plan journal items.
 *
 * An item is a probable duplicate of an existing journal when, within
 * +/- windowDays of the item's date, the journal has a leg on the right kind
 * of account with the item's amount. Sign is respected (an expense is a
 * debit on an EXPENSE account, income a credit on an INCOME account), so a
 * refund of the same size is not mistaken for the original payment.
 *
 * Candidates are bucketed:
 *   tagged     already tagged to the same property        -> skip as present
 *   untagged   no property tag at all                     -> offer to tag
 *   alternate  matches one of the item's alternateAmounts -> needs review
 *   otherProperty tagged to a different property          -> informational
 *   differentAmount (mortgage interest only) a payment already recorded on
 *              the Mortgage Interest account for this property in the same
 *              window but for another amount -> the month is already covered
 *
 * Pure functions only: no database access, so every rule is unit-tested.
 */

const MORTGAGE_INTEREST_ACCOUNT_NAME = 'Mortgage Interest';

export function isMortgageInterestLine(line: Pick<LedgerLine, 'accountName' | 'accountIsSystem'>): boolean {
  return line.accountName === MORTGAGE_INTEREST_ACCOUNT_NAME && line.accountIsSystem;
}

/** Whole days between two YYYY-MM-DD dates (b - a). */
export function daysBetween(a: string, b: string): number {
  const ms = Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`);
  return Math.round(ms / 86_400_000);
}

export function addDays(iso: string, days: number): string {
  const d = new Date(Date.parse(`${iso}T00:00:00Z`) + days * 86_400_000);
  return d.toISOString().slice(0, 10);
}

/** Does this line have the natural sign and account class for the item kind? */
function lineFitsKind(line: LedgerLine, kind: JournalKind): boolean {
  const amount = new Decimal(line.amount);
  switch (kind) {
    case 'income':
      return line.accountType === 'INCOME' && amount.isNegative();
    case 'expense':
      return line.accountType === 'EXPENSE' && amount.isPositive() && !isMortgageInterestLine(line);
    case 'mortgage_interest':
      // Any EXPENSE debit: a mortgage payment booked to the wrong expense
      // account is still the same cash payment and must not be doubled.
      return line.accountType === 'EXPENSE' && amount.isPositive();
  }
}

export interface Match {
  line: LedgerLine;
  /** Absolute day difference from the item's date. */
  dayDiff: number;
  /** True when it matched one of the item's alternate amounts rather than the amount. */
  viaAlternate: boolean;
}

export interface MatchResult {
  tagged: Match[];
  untagged: Match[];
  alternate: Match[];
  otherProperty: Match[];
  differentAmount: Match[];
}

export interface MatchQuery {
  kind: JournalKind;
  propertyId: number;
  date: string;
  amount: string;
  alternateAmounts: string[];
  windowDays: number;
  /** Journals already used by an earlier plan item in this run. */
  claimedJournalIds: ReadonlySet<number>;
}

function byProximity(a: Match, b: Match): number {
  return a.dayDiff - b.dayDiff || a.line.journalId - b.line.journalId;
}

export function findMatches(lines: readonly LedgerLine[], q: MatchQuery): MatchResult {
  const amount = new Decimal(q.amount).abs();
  const alternates = q.alternateAmounts.map(a => new Decimal(a).abs());
  const result: MatchResult = { tagged: [], untagged: [], alternate: [], otherProperty: [], differentAmount: [] };
  const seenJournals = new Set<number>();

  for (const line of lines) {
    if (q.claimedJournalIds.has(line.journalId)) continue;
    if (!lineFitsKind(line, q.kind)) continue;
    const dayDiff = Math.abs(daysBetween(q.date, line.date));
    if (dayDiff > q.windowDays) continue;

    const abs = new Decimal(line.amount).abs();
    const exact = abs.eq(amount);
    const viaAlternate = !exact && alternates.some(a => a.eq(abs));
    if (!exact && !viaAlternate) {
      // A real payment already booked as mortgage interest for this property
      // around the same date, just for a different sum (e.g. the actual rate
      // was higher than the plan's estimate): the plan's estimate must not
      // sit alongside it.
      if (
        q.kind === 'mortgage_interest' &&
        line.propertyId === q.propertyId &&
        isMortgageInterestLine(line) &&
        !seenJournals.has(line.journalId)
      ) {
        seenJournals.add(line.journalId);
        result.differentAmount.push({ line, dayDiff, viaAlternate: false });
      }
      continue;
    }

    // One journal can have several qualifying legs; report it once.
    if (seenJournals.has(line.journalId)) continue;
    seenJournals.add(line.journalId);

    const match: Match = { line, dayDiff, viaAlternate };
    if (viaAlternate) {
      if (line.propertyId === null || line.propertyId === q.propertyId) result.alternate.push(match);
      else result.otherProperty.push(match);
    } else if (line.propertyId === q.propertyId) {
      result.tagged.push(match);
    } else if (line.propertyId === null) {
      result.untagged.push(match);
    } else {
      result.otherProperty.push(match);
    }
  }

  result.tagged.sort(byProximity);
  result.untagged.sort(byProximity);
  result.alternate.sort(byProximity);
  result.otherProperty.sort(byProximity);
  result.differentAmount.sort(byProximity);
  return result;
}
