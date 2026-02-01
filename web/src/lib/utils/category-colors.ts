// Warm premium palette for category identification
const CATEGORY_COLORS = [
  '#E8C547', // gold (primary)
  '#B8A9E8', // lavender
  '#FB923C', // orange
  '#60A5FA', // blue
  '#4ADE80', // emerald
  '#FB7185', // rose
  '#FBBF24', // amber
  '#E879F9', // fuchsia
  '#38BDF8', // sky
  '#A3E635', // lime
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
