/**
 * One human-readable line of working in a tax computation. `text` is a full
 * sentence (amounts included) that reads on its own; `amount` repeats the
 * headline figure as a plain decimal string so a UI can right-align it and
 * a CSV can put it in its own column. Null for pure narrative lines.
 */
export interface BreakdownLine {
  section: string;
  text: string;
  amount: string | null;
}
