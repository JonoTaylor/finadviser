import { journalRepo, categoryRepo } from '@/lib/repos';
import { matchRule } from '@/lib/import/categorizer';
import { categorizeBatch } from '@/lib/ai/claude-client';
import { apiHandler } from '@/lib/api/handler';

export const POST = apiHandler(async () => {
  const uncategorized = await journalRepo.listUncategorized();
  if (uncategorized.length === 0) {
    return { total: 0, ruleBased: 0, aiCategorized: 0, remaining: 0 };
  }

  const rules = await categoryRepo.getRules();
  const ruleMatched: Array<{ id: number; categoryId: number }> = [];
  const unmatched: Array<{ id: number; description: string }> = [];

  for (const entry of uncategorized) {
    const categoryId = matchRule(entry.description, rules);
    if (categoryId) {
      ruleMatched.push({ id: entry.id, categoryId });
    } else {
      unmatched.push(entry);
    }
  }

  for (const match of ruleMatched) {
    await journalRepo.updateCategory(match.id, match.categoryId);
  }

  let aiCategorized = 0;

  if (unmatched.length > 0 && process.env.ANTHROPIC_API_KEY) {
    const categories = await categoryRepo.listAll();
    const categoryNames = categories.map((c) => c.name);

    const descriptions = unmatched.map((e) => e.description);
    const aiResults = await categorizeBatch(descriptions, categoryNames);

    const nameToId = new Map(categories.map((c) => [c.name.toLowerCase(), c.id]));

    for (const entry of unmatched) {
      const suggestedName = aiResults[entry.description];
      if (!suggestedName) continue;

      const categoryId = nameToId.get(suggestedName.toLowerCase());
      if (!categoryId) continue;

      await journalRepo.updateCategory(entry.id, categoryId);
      aiCategorized++;

      const existingRules = rules.filter(
        (r) =>
          r.pattern.toLowerCase() === entry.description.toLowerCase() &&
          r.categoryId === categoryId,
      );
      if (existingRules.length === 0) {
        await categoryRepo.addRule({
          pattern: entry.description,
          categoryId,
          matchType: 'contains',
          source: 'ai',
        });
      }
    }
  }

  return {
    total: uncategorized.length,
    ruleBased: ruleMatched.length,
    aiCategorized,
    remaining: unmatched.length - aiCategorized,
  };
});
