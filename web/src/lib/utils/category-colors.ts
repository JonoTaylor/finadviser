// Vibrant, balanced palette for category identification
const CATEGORY_COLORS = [
  '#5EEAD4', // teal (primary)
  '#A78BFA', // violet
  '#FBBF24', // amber
  '#60A5FA', // blue
  '#FB7185', // rose
  '#34D399', // emerald
  '#F97316', // orange
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
