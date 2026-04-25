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
    let aiNoMatch = 0;
    // Tells the UI whether the AI step ran at all and why if not. Without
    // this the user sees "0 by AI" with no explanation when
    // AI_GATEWAY_API_KEY is missing or when the gateway call fails — the
    // previous version silently swallowed both.
    let aiSkippedReason: string | null = null;

    if (unmatched.length > 0) {
      // Gateway-backed: AI_GATEWAY_API_KEY replaced ANTHROPIC_API_KEY in PR #17.
      if (!process.env.AI_GATEWAY_API_KEY) {
        aiSkippedReason = 'AI categorisation unavailable: AI_GATEWAY_API_KEY not set on the server.';
      } else {
        try {
          const categories = await categoryRepo.listAll();
          const categoryNames = categories.map((c) => c.name);
          const descriptions = unmatched.map((e) => e.description);
          const aiResults = await categorizeBatch(descriptions, categoryNames);

          const nameToId = new Map(categories.map((c) => [c.name.toLowerCase(), c.id]));

          for (const entry of unmatched) {
            const suggestedName = aiResults[entry.description];
            if (!suggestedName) {
              aiNoMatch++;
              continue;
            }
            const categoryId = nameToId.get(suggestedName.toLowerCase());
            if (!categoryId) {
              // AI suggested a name that doesn't match any existing
              // category — count it as no-match rather than silently
              // dropping it.
              aiNoMatch++;
              continue;
            }

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
        } catch (aiError) {
          console.error('Auto-categorize AI step failed:', aiError);
          aiSkippedReason = aiError instanceof Error
            ? `AI categorisation failed: ${aiError.message}`
            : 'AI categorisation failed.';
        }
      }
    }

    const remaining = unmatched.length - aiCategorized;
    return NextResponse.json({
      total: uncategorized.length,
      ruleBased: ruleMatched.length,
      aiCategorized,
      aiNoMatch,
      aiSkippedReason,
      remaining,
    });
  } catch (error) {
    console.error('Auto-categorize error:', error);
    const message = error instanceof Error ? error.message : 'Failed to auto-categorize';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
