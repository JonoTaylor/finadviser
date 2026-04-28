/**
 * Pure-function parser for paste-style mortgage payment lists. The
 * user's mortgage provider exports payment history as a free-form
 * blob like:
 *
 *   31/12/2025 Receipt £1,382.36 Credit 28/11/2025 Receipt £1,382.36 Credit
 *   28/03/2024 Receipt £1,224.71 Credit28/03/2024 Rejected Payment £1,224.71 Debit
 *
 * which is run-on (no newlines), date-prefixed, mixes "Receipt"
 * (real payment) with "Rejected Payment" (failed direct debit), and
 * uses UK date format DD/MM/YYYY. This parser tokenises on the
 * date boundary so we can handle the run-on case and surfaces the
 * skipped "Rejected Payment" rows separately so the UI can show
 * them dimmed-out instead of silently dropping them.
 */

export interface ParsedPayment {
  /** ISO date YYYY-MM-DD (parsed from DD/MM/YYYY input). */
  date: string;
  /** Amount as a positive decimal string, e.g. "1382.36". */
  amount: string;
  /** The original raw chunk, kept for debugging / display. */
  raw: string;
}

export interface SkippedPayment extends ParsedPayment {
  reason: 'rejected' | 'debit' | 'malformed';
}

export interface ParseResult {
  valid: ParsedPayment[];
  skipped: SkippedPayment[];
  /** Every chunk after splitting that didn't yield a parseable payment. */
  unparsed: string[];
}

const DATE_RE = /\b(\d{1,2})\/(\d{1,2})\/(\d{4})\b/;
const AMOUNT_RE = /£\s*([\d,]+(?:\.\d{1,2})?)/;

/**
 * Convert DD/MM/YYYY components to YYYY-MM-DD ISO date. Returns null
 * if the components don't form a valid Gregorian date (e.g. 31/02).
 */
function toIsoDate(d: string, m: string, y: string): string | null {
  const dd = parseInt(d, 10);
  const mm = parseInt(m, 10);
  const yyyy = parseInt(y, 10);
  if (mm < 1 || mm > 12 || dd < 1 || dd > 31) return null;
  // Use UTC to avoid timezone drift; we only care about the date part.
  const date = new Date(Date.UTC(yyyy, mm - 1, dd));
  if (
    date.getUTCFullYear() !== yyyy ||
    date.getUTCMonth() !== mm - 1 ||
    date.getUTCDate() !== dd
  ) return null;
  const isoMonth = String(mm).padStart(2, '0');
  const isoDay = String(dd).padStart(2, '0');
  return `${yyyy}-${isoMonth}-${isoDay}`;
}

/**
 * Normalise an amount string like "£1,382.36" or "1382.36" to a
 * positive decimal string with two decimal places. Returns null on
 * unparseable input. We don't preserve the leading sign here -
 * direction (Credit / Debit) is read from the surrounding text and
 * carried separately.
 */
function normaliseAmount(raw: string): string | null {
  const stripped = raw.replace(/[£,\s]/g, '');
  if (!/^\d+(?:\.\d{1,2})?$/.test(stripped)) return null;
  const num = Number(stripped);
  if (!Number.isFinite(num) || num <= 0) return null;
  return num.toFixed(2);
}

/**
 * Split the input on date boundaries so each emitted chunk starts
 * with a DD/MM/YYYY token. Handles the "Credit31/03/2026" run-on
 * case from the user's paste by using lookahead.
 */
function splitOnDates(input: string): string[] {
  const trimmed = input.replace(/\s+/g, ' ').trim();
  if (!trimmed) return [];
  // Lookahead split: each chunk begins with a date.
  return trimmed.split(/(?=\b\d{1,2}\/\d{1,2}\/\d{4}\b)/).map(s => s.trim()).filter(Boolean);
}

/**
 * Parse a single chunk like "31/12/2025 Receipt £1,382.36 Credit"
 * into one of: valid payment, explicitly-skipped row, or unparsed.
 */
function parseChunk(chunk: string): ParsedPayment | SkippedPayment | null {
  const dateMatch = chunk.match(DATE_RE);
  if (!dateMatch) return null;
  const iso = toIsoDate(dateMatch[1], dateMatch[2], dateMatch[3]);
  if (!iso) return null;

  const amountMatch = chunk.match(AMOUNT_RE);
  if (!amountMatch) return null;
  const amount = normaliseAmount(amountMatch[1]);
  if (!amount) return null;

  const lower = chunk.toLowerCase();
  // Order matters: check 'rejected' before 'receipt' since the
  // chunk could in theory contain both substrings.
  if (lower.includes('rejected')) {
    return { date: iso, amount, raw: chunk, reason: 'rejected' } satisfies SkippedPayment;
  }
  // Direction: a Debit line on a regular Receipt row is unusual;
  // typically Receipt + Credit. If we see Debit on something that
  // ISN'T already flagged rejected, treat as a refund / reversal
  // and skip rather than booking a negative interest expense.
  if (lower.includes('debit')) {
    return { date: iso, amount, raw: chunk, reason: 'debit' } satisfies SkippedPayment;
  }
  return { date: iso, amount, raw: chunk } satisfies ParsedPayment;
}

/**
 * Main entry point. Accepts the user's pasted text and returns a
 * structured ParseResult with the three buckets the UI can render
 * separately. Idempotent / pure - no I/O, no state.
 */
export function parseMortgagePayments(input: string): ParseResult {
  const valid: ParsedPayment[] = [];
  const skipped: SkippedPayment[] = [];
  const unparsed: string[] = [];

  for (const chunk of splitOnDates(input)) {
    const result = parseChunk(chunk);
    if (!result) {
      unparsed.push(chunk);
      continue;
    }
    if ('reason' in result) {
      skipped.push(result);
    } else {
      valid.push(result);
    }
  }

  return { valid, skipped, unparsed };
}
