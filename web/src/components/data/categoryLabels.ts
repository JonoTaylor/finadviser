type Category = { id: number; name: string; parentId?: number | null };

/** Preserve IDs while making equal names in different finance trees distinct. */
export function buildCategoryLabels(categories: readonly Category[]): Map<number, string> {
  const byId = new Map(categories.map(category => [category.id, category]));
  const paths = new Map<number, string>();
  const pathCounts = new Map<string, number>();
  for (const category of categories) {
    const names: string[] = [];
    const visited = new Set<number>();
    let current: Category | undefined = category;
    while (current && !visited.has(current.id) && visited.size < 32) {
      visited.add(current.id);
      names.unshift(current.name);
      current = current.parentId == null ? undefined : byId.get(current.parentId);
    }
    const path = names.join(' / ');
    paths.set(category.id, path);
    pathCounts.set(path, (pathCounts.get(path) ?? 0) + 1);
  }
  return new Map(categories.map(category => {
    const path = paths.get(category.id)!;
    return [category.id, (pathCounts.get(path) ?? 0) > 1 ? `${path} · ID ${category.id}` : path];
  }));
}
