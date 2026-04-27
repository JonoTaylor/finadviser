import { softTokens } from '@/theme/theme';

export interface CategoryColor {
  /** Saturated tone — use as the fill for dots / bars / `alpha(fill, 0.1-0.14)` chip backgrounds. */
  fill: string;
  /** Dark companion guaranteed to clear WCAG AA on white / pastel surfaces — use for chip text. */
  ink: string;
}

// 8 distinct (fill, ink) pairings drawn from the Soft Surfaces v2
// palette. Every fill is either a `.deep` saturated tone or an `.ink`
// darker variant — both readable as text on white, and both
// recognisable as a solid dot/bar at full opacity. The duplicated
// inks (each family contributes two entries) are intentional:
// callers use `ink` only as a text colour on a pale fill, where
// matching the family reads as cohesive.
const PALETTE: readonly CategoryColor[] = [
  { fill: softTokens.mint.deep,     ink: softTokens.mint.ink },
  { fill: softTokens.lavender.deep, ink: softTokens.lavender.ink },
  { fill: softTokens.peach.deep,    ink: softTokens.peach.ink },
  { fill: softTokens.lemon.deep,    ink: softTokens.lemon.ink },
  { fill: softTokens.mint.ink,      ink: softTokens.mint.ink },
  { fill: softTokens.lavender.ink,  ink: softTokens.lavender.ink },
  { fill: softTokens.peach.ink,     ink: softTokens.peach.ink },
  { fill: softTokens.lemon.ink,     ink: softTokens.lemon.ink },
];

function hashString(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = (hash << 5) - hash + str.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash);
}

export function getCategoryColor(categoryName: string): CategoryColor {
  const index = hashString(categoryName) % PALETTE.length;
  return PALETTE[index];
}
