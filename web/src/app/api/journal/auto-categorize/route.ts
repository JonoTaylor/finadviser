import { NextResponse } from 'next/server';
import { journalRepo, categoryRepo } from '@/lib/repos';
import { matchRule } from '@/lib/import/categorizer';
import { categorizeBatch } from '@/lib/ai/claude-client';

export async function POST() {
  try {
    const uncategorized = await journalRepo.listUncategorized();
    if (uncategorized.length === 0) {
      return NextResponse.json({ total: 0, ruleBased: 0, aiCategorized: 0, remaining: 0 });
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

    // Apply rule-based matches
    for (const match of ruleMatched) {
      await journalRepo.updateCategory(match.id, match.categoryId);
    }

    let aiCategorized = 0;

    // AI fallback for unmatched entries
    if (unmatched.length > 0 && process.env.ANTHROPIC_API_KEY) {
      const categories = await categoryRepo.listAll();
      const categoryNames = categories.map((c) => c.name);

      const descriptions = unmatched.map((e) => e.description);
      const aiResults = await categorizeBatch(descriptions, categoryNames);

      // Build name->id lookup
      const nameToId = new Map(categories.map((c) => [c.name.toLowerCase(), c.id]));

      for (const entry of unmatched) {
        const suggestedName = aiResults[entry.description];
        if (!suggestedName) continue;

        const categoryId = nameToId.get(suggestedName.toLowerCase());
        if (!categoryId) continue;

        await journalRepo.updateCategory(entry.id, categoryId);
        aiCategorized++;

        // Create AI-sourced rule for this mapping
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

    const remaining = unmatched.length - aiCategorized;
    return NextResponse.json({
      total: uncategorized.length,
      ruleBased: ruleMatched.length,
      aiCategorized,
      remaining,
    });
  } catch (error) {
    console.error('Auto-categorize error:', error);
    return NextResponse.json({ error: 'Failed to auto-categorize' }, { status: 500 });
  }
}
