import Anthropic from '@anthropic-ai/sdk';
import Decimal from 'decimal.js';
import { accountRepo, journalRepo, categoryRepo, propertyRepo, tipRepo } from '@/lib/repos';
import { calculateEquity } from '@/lib/properties/equity-calculator';
import { formatCurrency } from '@/lib/utils/formatting';
import { matchRule } from '@/lib/import/categorizer';
import { categorizeBatch } from './claude-client';

type Tool = Anthropic.Messages.Tool;

// -------------------------------------------------------------------
// Tool definitions (Anthropic tool-use schema)
// -------------------------------------------------------------------

export const TOOL_DEFINITIONS: Tool[] = [
  {
    name: 'get_account_balances',
    description:
      'Get current balances for all financial accounts. Returns assets, liabilities, equity, income, and expense accounts with their balances. Use this to understand the user\'s financial position.',
    input_schema: {
      type: 'object' as const,
      properties: {
        account_type: {
          type: 'string',
          enum: ['ASSET', 'LIABILITY', 'EQUITY', 'INCOME', 'EXPENSE'],
          description: 'Optional filter by account type.',
        },
      },
      required: [],
    },
  },
  {
    name: 'search_transactions',
    description:
      'Search and filter journal entries / transactions. Returns date, description, category, and amounts. Use for analysing spending patterns, finding specific transactions, or reviewing recent activity.',
    input_schema: {
      type: 'object' as const,
      properties: {
        query: { type: 'string', description: 'Text to match against descriptions.' },
        start_date: { type: 'string', description: 'Start date YYYY-MM-DD.' },
        end_date: { type: 'string', description: 'End date YYYY-MM-DD.' },
        category_id: { type: 'number', description: 'Filter by category ID.' },
        limit: { type: 'number', description: 'Max results (default 25).' },
      },
      required: [],
    },
  },
  {
    name: 'get_monthly_spending',
    description:
      'Get monthly spending broken down by category for the last few months. Great for trend analysis and budget reviews.',
    input_schema: {
      type: 'object' as const,
      properties: {},
      required: [],
    },
  },
  {
    name: 'get_categories',
    description: 'List all transaction categories with their IDs. Needed before categorising a transaction or creating a rule.',
    input_schema: {
      type: 'object' as const,
      properties: {},
      required: [],
    },
  },
  {
    name: 'get_property_summary',
    description:
      'Get property details including valuations, mortgages, and owner equity breakdowns. Use for property and equity analysis.',
    input_schema: {
      type: 'object' as const,
      properties: {},
      required: [],
    },
  },
  {
    name: 'categorize_transaction',
    description:
      'Set the category for a specific journal entry. Use when the user asks to recategorise a transaction or you identify a miscategorised one.',
    input_schema: {
      type: 'object' as const,
      properties: {
        journal_id: { type: 'number', description: 'The journal entry ID.' },
        category_id: { type: 'number', description: 'The category ID to assign.' },
      },
      required: ['journal_id', 'category_id'],
    },
  },
  {
    name: 'auto_categorize',
    description:
      'Bulk auto-categorise all uncategorised transactions using rules and AI. Returns a summary of how many were categorised.',
    input_schema: {
      type: 'object' as const,
      properties: {},
      required: [],
    },
  },
  {
    name: 'create_category',
    description: 'Create a new transaction category.',
    input_schema: {
      type: 'object' as const,
      properties: {
        name: { type: 'string', description: 'Category name.' },
      },
      required: ['name'],
    },
  },
  {
    name: 'add_categorization_rule',
    description:
      'Create a rule that automatically categorises future transactions whose description matches the given pattern.',
    input_schema: {
      type: 'object' as const,
      properties: {
        pattern: { type: 'string', description: 'Text pattern to match.' },
        category_id: { type: 'number', description: 'Category ID to assign on match.' },
        match_type: {
          type: 'string',
          enum: ['contains', 'startswith', 'exact', 'regex'],
          description: 'How to match (default: contains).',
        },
      },
      required: ['pattern', 'category_id'],
    },
  },
  {
    name: 'add_tip',
    description:
      'Add a financial tip, warning, or insight to the user\'s dashboard. Use proactively when you spot something noteworthy — a saving opportunity, an unusual expense, or a positive trend.',
    input_schema: {
      type: 'object' as const,
      properties: {
        content: { type: 'string', description: 'The tip / insight text (1-2 sentences, actionable).' },
        tip_type: {
          type: 'string',
          enum: ['tip', 'warning', 'insight'],
          description: 'tip = savings advice, warning = concern, insight = observation.',
        },
      },
      required: ['content'],
    },
  },
  {
    name: 'get_tips',
    description: 'Get currently active financial tips on the dashboard.',
    input_schema: {
      type: 'object' as const,
      properties: {},
      required: [],
    },
  },
];

// Human-readable labels for tool status display
export const TOOL_LABELS: Record<string, string> = {
  get_account_balances: 'Looking up account balances',
  search_transactions: 'Searching transactions',
  get_monthly_spending: 'Fetching spending data',
  get_categories: 'Loading categories',
  get_property_summary: 'Loading property data',
  categorize_transaction: 'Categorising transaction',
  auto_categorize: 'Auto-categorising transactions',
  create_category: 'Creating category',
  add_categorization_rule: 'Adding categorisation rule',
  add_tip: 'Adding tip to dashboard',
  get_tips: 'Loading dashboard tips',
};

// -------------------------------------------------------------------
// Tool executor
// -------------------------------------------------------------------

export async function executeTool(
  name: string,
  input: Record<string, unknown>,
): Promise<unknown> {
  switch (name) {
    case 'get_account_balances':
      return executeGetAccountBalances(input);
    case 'search_transactions':
      return executeSearchTransactions(input);
    case 'get_monthly_spending':
      return executeGetMonthlySpending();
    case 'get_categories':
      return executeGetCategories();
    case 'get_property_summary':
      return executeGetPropertySummary();
    case 'categorize_transaction':
      return executeCategorizeTransaction(input);
    case 'auto_categorize':
      return executeAutoCategorize();
    case 'create_category':
      return executeCreateCategory(input);
    case 'add_categorization_rule':
      return executeAddCategorizationRule(input);
    case 'add_tip':
      return executeAddTip(input);
    case 'get_tips':
      return executeGetTips();
    default:
      return { error: `Unknown tool: ${name}` };
  }
}

// -------------------------------------------------------------------
// Individual tool implementations
// -------------------------------------------------------------------

async function executeGetAccountBalances(input: Record<string, unknown>) {
  const balances = await accountRepo.getBalances();
  const accountType = input.account_type as string | undefined;
  const filtered = accountType
    ? balances.filter((b) => b.account_type === accountType)
    : balances;
  return filtered.map((b) => ({
    id: b.account_id,
    name: b.account_name,
    type: b.account_type,
    balance: formatCurrency(b.balance),
    raw_balance: b.balance,
  }));
}

async function executeSearchTransactions(input: Record<string, unknown>) {
  const limit = (input.limit as number) || 25;
  const entries = await journalRepo.listEntries({
    query: input.query as string | undefined,
    startDate: input.start_date as string | undefined,
    endDate: input.end_date as string | undefined,
    categoryId: input.category_id as number | undefined,
    limit,
  });
  return (entries as Record<string, unknown>[]).map((e) => ({
    id: e.id,
    date: e.date,
    description: e.description,
    category: e.category_name ?? 'Uncategorised',
    amounts: e.entries_summary,
  }));
}

async function executeGetMonthlySpending() {
  const spending = await journalRepo.getMonthlySpending();
  const byMonth: Record<string, Array<{ category: string; total: string }>> = {};
  for (const row of spending) {
    const month = row.month ?? 'unknown';
    if (!byMonth[month]) byMonth[month] = [];
    byMonth[month].push({
      category: row.category_name || 'Uncategorised',
      total: formatCurrency(Math.abs(parseFloat(row.total ?? '0'))),
    });
  }
  return byMonth;
}

async function executeGetCategories() {
  const cats = await categoryRepo.listAll();
  return cats.map((c) => ({ id: c.id, name: c.name }));
}

async function executeGetPropertySummary() {
  const properties = await propertyRepo.listProperties();
  const results = [];

  for (const prop of properties) {
    const valuation = await propertyRepo.getLatestValuation(prop.id);
    const mortgages = await propertyRepo.getMortgages(prop.id);
    const mortgageDetails = [];
    for (const m of mortgages) {
      const balance = await propertyRepo.getMortgageBalance(m.id);
      mortgageDetails.push({
        lender: m.lender,
        balance: formatCurrency(new Decimal(balance).abs().toString()),
      });
    }
    const equity = await calculateEquity(prop.id);
    results.push({
      id: prop.id,
      name: prop.name,
      address: prop.address,
      purchasePrice: prop.purchasePrice ? formatCurrency(prop.purchasePrice) : null,
      currentValuation: valuation ? formatCurrency(valuation.valuation) : null,
      mortgages: mortgageDetails,
      ownerEquity: equity.map((e) => ({
        owner: e.name,
        amount: formatCurrency(e.equityAmount.toString()),
        percentage: `${e.equityPct.toFixed(1)}%`,
      })),
    });
  }
  return results;
}

async function executeCategorizeTransaction(input: Record<string, unknown>) {
  const journalId = input.journal_id as number;
  const categoryId = input.category_id as number;
  await journalRepo.updateCategory(journalId, categoryId);
  return { success: true, journalId, categoryId };
}

async function executeAutoCategorize() {
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
      const catId = nameToId.get(suggestedName.toLowerCase());
      if (!catId) continue;
      await journalRepo.updateCategory(entry.id, catId);
      aiCategorized++;
    }
  }

  return {
    total: uncategorized.length,
    ruleBased: ruleMatched.length,
    aiCategorized,
    remaining: unmatched.length - aiCategorized,
  };
}

async function executeCreateCategory(input: Record<string, unknown>) {
  const name = input.name as string;
  const existing = await categoryRepo.getByName(name);
  if (existing) return { id: existing.id, name: existing.name, alreadyExisted: true };
  const cat = await categoryRepo.create({ name });
  return { id: cat.id, name: cat.name, alreadyExisted: false };
}

async function executeAddCategorizationRule(input: Record<string, unknown>) {
  const rule = await categoryRepo.addRule({
    pattern: input.pattern as string,
    categoryId: input.category_id as number,
    matchType: (input.match_type as 'contains' | 'startswith' | 'exact' | 'regex') ?? 'contains',
    source: 'ai',
  });
  return { id: rule.id, pattern: rule.pattern };
}

async function executeAddTip(input: Record<string, unknown>) {
  const tip = await tipRepo.create({
    content: input.content as string,
    tipType: (input.tip_type as 'tip' | 'warning' | 'insight') ?? 'tip',
  });
  return { id: tip.id, content: tip.content, tipType: tip.tipType };
}

async function executeGetTips() {
  const tips = await tipRepo.listActive();
  return tips.map((t) => ({ id: t.id, content: t.content, type: t.tipType, createdAt: t.createdAt }));
}
