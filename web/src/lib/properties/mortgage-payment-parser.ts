import Decimal from 'decimal.js';

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
  /** Precise validation failures for callers; optional for older integrations. */
  issues?: PaymentParseIssue[];
}

export interface PaymentParseIssue {
  raw: string;
  reason: 'missing_date' | 'invalid_date' | 'missing_amount' | 'invalid_amount' | 'ambiguous_amount';
  message: string;
}

// Match a whole token, including malformed component lengths, so a bad
// `128/08/2026` cannot be salvaged as `28/08/2026`. Consuming matches also
// prevent a second boundary inside `30/09/2026` at `0/09/2026`.
// A word boundary would break the provider's `Credit31/03/2026` run-on format.
const DATE_TOKEN_RE = /(?<![\d/])\d+(?:\/\d+){2,}(?![\d/])/g;
const DATE_RE = /^(\d{1,2})\/(\d{1,2})\/(\d{4})(?![\d/])/;
// Amount regex: £-prefixed only. The user's lender always emits the
// £ symbol; if a future caller wants raw decimals they should
// pre-process the input upstream rather than weakening the regex
// here (a bare "1.5" elsewhere in the chunk would otherwise be
// misread as a payment amount).
// Consume the complete numeric token before validating it: matching only
// two decimal places would silently turn `£1,382.365` into `£1,382.36`.
const AMOUNT_RE = /£\s*([+\-−]?\d[\d,.]*)/;

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
 * Normalise the amount captured by AMOUNT_RE (which strips the
 * leading £ already) into a positive decimal string with two
 * decimal places. Uses Decimal rather than JS Number so the
 * round-trip preserves the exact value the user typed: parseFloat
 * + toFixed can drift on tricky values like 1234.005 (banker's
 * rounding vs the JS spec's behaviour). Money math elsewhere in
 * the codebase uses decimal.js for the same reason. Returns null
 * on unparseable or non-positive input.
 */
function normaliseAmount(raw: string): string | null {
  if (!/^(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d{1,2})?$/.test(raw)) return null;
  const stripped = raw.replace(/,/g, '');
  let dec: Decimal;
  try {
    dec = new Decimal(stripped);
  } catch {
    return null;
  }
  if (!dec.isPositive() || dec.isZero()) return null;
  return dec.toFixed(2);
}

/**
 * Split the input on date boundaries so each emitted chunk starts
 * with a complete date-shaped token. Iterate consuming matches instead of
 * splitting on an overlapping lookahead, which can cut a two-digit day
 * in half. Preserve malformed rows and any non-date preamble for review.
 */
function splitOnDates(input: string): string[] {
  const trimmed = input.replace(/\s+/g, ' ').trim();
  if (!trimmed) return [];
  const starts = Array.from(trimmed.matchAll(DATE_TOKEN_RE), match => match.index);
  if (starts.length === 0) return [trimmed];
  const chunks = starts[0] > 0 ? [trimmed.slice(0, starts[0]).trim()] : [];
  for (let index = 0; index < starts.length; index += 1) {
    chunks.push(trimmed.slice(starts[index], starts[index + 1]).trim());
  }
  return chunks.filter(Boolean);
}

/**
 * Parse a single chunk like "31/12/2025 Receipt £1,382.36 Credit"
 * into one of: valid payment, explicitly-skipped row, or unparsed.
 */
function parseChunk(chunk: string): ParsedPayment | SkippedPayment | PaymentParseIssue {
  const issue = (reason: PaymentParseIssue['reason'], message: string): PaymentParseIssue => ({ raw: chunk, reason, message });
  const dateMatch = chunk.match(DATE_RE);
  if (!dateMatch) return issue(/^\d+\//.test(chunk) ? 'invalid_date' : 'missing_date', 'Use a complete UK date in DD/MM/YYYY format.');
  const iso = toIsoDate(dateMatch[1], dateMatch[2], dateMatch[3]);
  if (!iso) return issue('invalid_date', 'The date is not a valid Gregorian calendar date.');

  const lower = chunk.toLowerCase();
  const skipReason = lower.includes('rejected') ? 'rejected' : lower.includes('debit') ? 'debit' : null;
  const currencyCount = chunk.match(/£/g)?.length ?? 0;
  if (currencyCount === 0) return issue('missing_amount', 'Include one £-prefixed payment amount.');
  if (currencyCount > 1) return issue('ambiguous_amount', 'The row contains more than one £ amount; identify the payment amount before booking.');
  const amountMatch = chunk.match(AMOUNT_RE);
  if (!amountMatch) return issue('invalid_amount', 'Use a positive payment amount with valid thousands separators and at most two decimal places.');
  const negative = /[-−]\s*£|\(\s*£/.test(chunk) || /^[\-−]/.test(amountMatch[1])
    || /^\s*\)/.test(chunk.slice((amountMatch.index ?? 0) + amountMatch[0].length));
  const afterAmount = chunk.slice((amountMatch.index ?? 0) + amountMatch[0].length);
  if ((!skipReason && negative) || /^\s+(?:\d|[.,]\d)/.test(afterAmount)
    || /^[eE][+\-]?\d|^[/+\-−_%]/.test(afterAmount)) {
    return issue('invalid_amount', 'The amount is negative or uses an unsupported numeric format; it has not been booked.');
  }
  const amount = normaliseAmount(skipReason ? amountMatch[1].replace(/^[\-−]/, '') : amountMatch[1]);
  if (!amount) return issue('invalid_amount', 'Use a positive payment amount with valid thousands separators and at most two decimal places.');

  // Order matters: check 'rejected' before 'receipt' since the
  // chunk could in theory contain both substrings.
  if (skipReason === 'rejected') {
    return { date: iso, amount, raw: chunk, reason: 'rejected' } satisfies SkippedPayment;
  }
  // Direction: a Debit line on a regular Receipt row is unusual;
  // typically Receipt + Credit. If we see Debit on something that
  // ISN'T already flagged rejected, treat as a refund / reversal
  // and skip rather than booking a negative interest expense.
  if (skipReason === 'debit') {
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
  const issues: PaymentParseIssue[] = [];

  for (const chunk of splitOnDates(input)) {
    const result = parseChunk(chunk);
    if ('message' in result) {
      unparsed.push(chunk);
      issues.push(result);
      continue;
    }
    if ('reason' in result) {
      skipped.push(result);
    } else {
      valid.push(result);
    }
  }

  return { valid, skipped, unparsed, issues };
}
