const CATEGORY_COLORS = [
  '#4ecdc4', // teal
  '#ff6b6b', // coral
  '#feca57', // yellow
  '#45b7d1', // blue
  '#a29bfe', // purple
  '#6ab04c', // green
  '#f0932b', // orange
  '#e056a0', // pink
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
