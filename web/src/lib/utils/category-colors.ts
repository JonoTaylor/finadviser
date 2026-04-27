import { softTokens } from '@/theme/theme';

// 10 visually distinct hues drawn from the Soft Surfaces v2 palette.
// Used as the dot / chip / bar colour for category identification on
// white pillow surfaces (categories are also tinted with `alpha(c,
// 0.14)` for fills, so `.deep` variants give a readable but soft
// look without overpowering the surface).
const CATEGORY_COLORS: readonly string[] = [
  softTokens.lavender.deep,
  softTokens.mint.deep,
  softTokens.peach.deep,
  softTokens.lemon.deep,
  softTokens.lavender.ink,
  softTokens.mint.ink,
  softTokens.peach.ink,
  softTokens.lemon.ink,
  softTokens.lavender.main,
  softTokens.mint.main,
];

function hashString(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = (hash << 5) - hash + str.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash);
}

export function getCategoryColor(categoryName: string): string {
  const index = hashString(categoryName) % CATEGORY_COLORS.length;
  return CATEGORY_COLORS[index];
}
