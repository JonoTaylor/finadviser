import Anthropic from '@anthropic-ai/sdk';
import Decimal from 'decimal.js';
import { format, subMonths } from 'date-fns';
import { accountRepo, journalRepo, categoryRepo, propertyRepo, tipRepo, budgetRepo, savingsGoalRepo } from '@/lib/repos';
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
    name: 'list_uncategorized',
    description:
      'List uncategorized transactions with their id, date, description, and amount. Use this before auto_categorize to show the user what needs attention, or to review what is uncategorized.',
    input_schema: {
      type: 'object' as const,
      properties: {
        limit: { type: 'number', description: 'Max results (default 25).' },
      },
      required: [],
    },
  },
  {
    name: 'auto_categorize',
    description:
      'Bulk auto-categorise all uncategorised transactions using rules and AI. Returns a summary of how many were categorised, plus details of each categorisation (id, description, category, method).',
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
  {
    name: 'get_budget_status',
    description:
      'Get budget vs actual spending for each budgeted category. Returns limit, spent, remaining, and percent used. Use to review budget adherence.',
    input_schema: {
      type: 'object' as const,
      properties: {
        month: { type: 'string', description: 'Month in YYYY-MM format. Defaults to current month.' },
      },
      required: [],
    },
  },
  {
    name: 'set_budget',
    description:
      'Create or update a monthly budget for a spending category. Looks up category by name (creates it if needed).',
    input_schema: {
      type: 'object' as const,
      properties: {
        category_name: { type: 'string', description: 'The category name to budget for.' },
        monthly_limit: { type: 'string', description: 'Monthly budget limit as a decimal string (e.g. "500.00").' },
      },
      required: ['category_name', 'monthly_limit'],
    },
  },
  {
    name: 'get_savings_goals',
    description:
      'List savings goals with progress. Returns name, target, current amount, progress percentage, target date, and status.',
    input_schema: {
      type: 'object' as const,
      properties: {
        status: {
          type: 'string',
          enum: ['active', 'all'],
          description: 'Filter by status. "active" (default) or "all".',
        },
      },
      required: [],
    },
  },
  {
    name: 'set_savings_goal',
    description:
      'Create a new savings goal with a target amount and optional target date.',
    input_schema: {
      type: 'object' as const,
      properties: {
        name: { type: 'string', description: 'Goal name (e.g. "Emergency Fund", "Holiday 2025").' },
        target_amount: { type: 'string', description: 'Target amount as decimal string.' },
        target_date: { type: 'string', description: 'Optional target date YYYY-MM-DD.' },
        account_name: { type: 'string', description: 'Optional savings account name to link.' },
      },
      required: ['name', 'target_amount'],
    },
  },
  {
    name: 'update_savings_progress',
    description:
      'Update the current saved amount for a savings goal.',
    input_schema: {
      type: 'object' as const,
      properties: {
        goal_id: { type: 'number', description: 'The savings goal ID.' },
        current_amount: { type: 'string', description: 'New current amount saved.' },
      },
      required: ['goal_id', 'current_amount'],
    },
  },
  {
    name: 'get_debt_summary',
    description:
      'Get a summary of all debts — mortgages with current balances, interest rates, monthly payments, and total debt position. Uses property and mortgage data.',
    input_schema: {
      type: 'object' as const,
      properties: {},
      required: [],
    },
  },
  {
    name: 'get_income_expense_summary',
    description:
      'Get monthly income, expenses, and net position over a number of months. Useful for affordability analysis and financial health checks.',
    input_schema: {
      type: 'object' as const,
      properties: {
        months: { type: 'number', description: 'Number of months to look back (default 3).' },
      },
      required: [],
    },
  },
  {
    name: 'get_financial_health_check',
    description:
      'Run a comprehensive financial health check. Analyses savings rate, budget adherence, debt-to-income ratio, emergency fund status, and flags concerns. Composite tool that gathers data from multiple sources.',
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
  list_uncategorized: 'Finding uncategorized transactions',
  auto_categorize: 'Auto-categorising transactions',
  create_category: 'Creating category',
  add_categorization_rule: 'Adding categorisation rule',
  add_tip: 'Adding tip to dashboard',
  get_tips: 'Loading dashboard tips',
  get_budget_status: 'Checking budget status',
  set_budget: 'Setting budget',
  get_savings_goals: 'Loading savings goals',
  set_savings_goal: 'Creating savings goal',
  update_savings_progress: 'Updating savings progress',
  get_debt_summary: 'Analysing debt position',
  get_income_expense_summary: 'Calculating income & expenses',
  get_financial_health_check: 'Running financial health check',
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
    case 'list_uncategorized':
      return executeListUncategorized(input);
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
    case 'get_budget_status':
      return executeGetBudgetStatus(input);
    case 'set_budget':
      return executeSetBudget(input);
    case 'get_savings_goals':
      return executeGetSavingsGoals(input);
    case 'set_savings_goal':
      return executeSetSavingsGoal(input);
    case 'update_savings_progress':
      return executeUpdateSavingsProgress(input);
    case 'get_debt_summary':
      return executeGetDebtSummary();
    case 'get_income_expense_summary':
      return executeGetIncomeExpenseSummary(input);
    case 'get_financial_health_check':
      return executeGetFinancialHealthCheck();
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

async function executeListUncategorized(input: Record<string, unknown>) {
  const limit = (input.limit as number) || 25;
  const entries = await journalRepo.listUncategorizedWithAmounts(limit);
  return entries.map((e) => ({
    id: e.id,
    date: e.date,
    description: e.description,
    amount: e.entries_summary,
  }));
}

async function executeAutoCategorize() {
  const uncategorized = await journalRepo.listUncategorized();
  if (uncategorized.length === 0) {
    return { total: 0, ruleBased: 0, aiCategorized: 0, remaining: 0, details: [] };
  }

  const rules = await categoryRepo.getRules();
  const categories = await categoryRepo.listAll();
  const nameToId = new Map(categories.map((c) => [c.name.toLowerCase(), c.id]));
  const idToName = new Map(categories.map((c) => [c.id, c.name]));

  const ruleMatched: Array<{ id: number; categoryId: number; description: string }> = [];
  const unmatched: Array<{ id: number; description: string }> = [];

  for (const entry of uncategorized) {
    const categoryId = matchRule(entry.description, rules);
    if (categoryId) {
      ruleMatched.push({ id: entry.id, categoryId, description: entry.description });
    } else {
      unmatched.push(entry);
    }
  }

  const details: Array<{ id: number; description: string; category: string; method: 'rule' | 'ai' }> = [];

  for (const match of ruleMatched) {
    await journalRepo.updateCategory(match.id, match.categoryId);
    details.push({
      id: match.id,
      description: match.description,
      category: idToName.get(match.categoryId) ?? 'Unknown',
      method: 'rule',
    });
  }

  let aiCategorized = 0;
  if (unmatched.length > 0 && process.env.ANTHROPIC_API_KEY) {
    const categoryNames = categories.map((c) => c.name);
    const descriptions = unmatched.map((e) => e.description);
    const aiResults = await categorizeBatch(descriptions, categoryNames);

    for (const entry of unmatched) {
      const suggestedName = aiResults[entry.description];
      if (!suggestedName) continue;
      const catId = nameToId.get(suggestedName.toLowerCase());
      if (!catId) continue;
      await journalRepo.updateCategory(entry.id, catId);
      aiCategorized++;
      details.push({
        id: entry.id,
        description: entry.description,
        category: suggestedName,
        method: 'ai',
      });
    }
  }

  const hasMore = details.length > 50;

  return {
    total: uncategorized.length,
    ruleBased: ruleMatched.length,
    aiCategorized,
    remaining: unmatched.length - aiCategorized,
    details: details.slice(0, 50),
    hasMore,
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

// -------------------------------------------------------------------
// Budget, Savings, Debt & Health Check tools
// -------------------------------------------------------------------

async function executeGetBudgetStatus(input: Record<string, unknown>) {
  const month = (input.month as string) || format(new Date(), 'yyyy-MM');
  const rows = await budgetRepo.getStatusForMonth(month);
  return rows.map((r) => {
    const limit = parseFloat(r.monthly_limit);
    const spent = parseFloat(r.spent);
    const remaining = limit - spent;
    const percentUsed = limit > 0 ? Math.round((spent / limit) * 100) : 0;
    return {
      category: r.category_name,
      categoryId: r.category_id,
      limit: formatCurrency(limit),
      spent: formatCurrency(spent),
      remaining: formatCurrency(remaining),
      percentUsed,
      month,
    };
  });
}

async function executeSetBudget(input: Record<string, unknown>) {
  const categoryName = input.category_name as string;
  const monthlyLimit = input.monthly_limit as string;

  let category = await categoryRepo.getByName(categoryName);
  if (!category) {
    category = await categoryRepo.create({ name: categoryName });
  }

  const effectiveFrom = format(new Date(), 'yyyy-MM-dd');
  const budget = await budgetRepo.upsert(category.id, monthlyLimit, effectiveFrom);

  return {
    budgetId: budget.id,
    category: category.name,
    categoryId: category.id,
    monthlyLimit: formatCurrency(monthlyLimit),
    effectiveFrom: budget.effective_from,
  };
}

async function executeGetSavingsGoals(input: Record<string, unknown>) {
  const statusFilter = input.status as string | undefined;
  const goals = statusFilter === 'all'
    ? await savingsGoalRepo.getAll()
    : await savingsGoalRepo.getAll('active');

  return goals.map((g) => {
    const target = parseFloat(g.targetAmount);
    const current = parseFloat(g.currentAmount);
    const progress = target > 0 ? Math.round((current / target) * 100) : 0;
    return {
      id: g.id,
      name: g.name,
      targetAmount: formatCurrency(g.targetAmount),
      currentAmount: formatCurrency(g.currentAmount),
      remaining: formatCurrency(Math.max(0, target - current)),
      progress,
      targetDate: g.targetDate,
      status: g.status,
    };
  });
}

async function executeSetSavingsGoal(input: Record<string, unknown>) {
  const name = input.name as string;
  const targetAmount = input.target_amount as string;
  const targetDate = input.target_date as string | undefined;
  const accountName = input.account_name as string | undefined;

  let accountId: number | null = null;
  if (accountName) {
    const balances = await accountRepo.getBalances();
    const match = balances.find(
      (b) => b.account_name.toLowerCase() === accountName.toLowerCase(),
    );
    if (match) accountId = match.account_id as number;
  }

  const goal = await savingsGoalRepo.create({
    name,
    targetAmount,
    targetDate: targetDate ?? null,
    accountId,
  });

  return {
    id: goal.id,
    name: goal.name,
    targetAmount: formatCurrency(goal.targetAmount),
    targetDate: goal.targetDate,
    status: goal.status,
  };
}

async function executeUpdateSavingsProgress(input: Record<string, unknown>) {
  const goalId = input.goal_id as number;
  const currentAmount = input.current_amount as string;

  const goal = await savingsGoalRepo.updateProgress(goalId, currentAmount);
  if (!goal) return { error: 'Goal not found' };

  const target = parseFloat(goal.targetAmount);
  const current = parseFloat(goal.currentAmount);
  const progress = target > 0 ? Math.round((current / target) * 100) : 0;

  let milestone: string | null = null;
  if (progress >= 100) milestone = 'Goal completed!';
  else if (progress >= 75) milestone = '75% milestone reached!';
  else if (progress >= 50) milestone = 'Halfway there!';
  else if (progress >= 25) milestone = '25% milestone reached!';

  if (progress >= 100) {
    await savingsGoalRepo.update(goalId, { status: 'completed' });
  }

  return {
    id: goal.id,
    name: goal.name,
    targetAmount: formatCurrency(goal.targetAmount),
    currentAmount: formatCurrency(goal.currentAmount),
    progress,
    milestone,
    status: progress >= 100 ? 'completed' : goal.status,
  };
}

async function executeGetDebtSummary() {
  const props = await propertyRepo.listProperties();
  const debts = [];
  let totalDebt = new Decimal(0);

  for (const prop of props) {
    const mortgageList = await propertyRepo.getMortgages(prop.id);
    const valuation = await propertyRepo.getLatestValuation(prop.id);

    for (const m of mortgageList) {
      const balance = await propertyRepo.getMortgageBalance(m.id);
      const absBalance = new Decimal(balance).abs();
      totalDebt = totalDebt.plus(absBalance);

      const rateRows = await propertyRepo.getMortgageRates(m.id);
      const currentRate = rateRows.length > 0 ? rateRows[0] : null;

      const remainingMonths = Math.max(0, m.termMonths - monthsBetween(m.startDate, format(new Date(), 'yyyy-MM-dd')));

      debts.push({
        property: prop.name,
        lender: m.lender,
        originalAmount: formatCurrency(m.originalAmount),
        currentBalance: formatCurrency(absBalance.toString()),
        interestRate: currentRate ? `${currentRate.rate}%` : 'Unknown',
        termMonths: m.termMonths,
        remainingMonths,
        currentValuation: valuation ? formatCurrency(valuation.valuation) : null,
        ltv: valuation
          ? `${absBalance.div(new Decimal(valuation.valuation)).mul(100).toFixed(1)}%`
          : null,
      });
    }
  }

  return {
    debts,
    totalDebt: formatCurrency(totalDebt.toString()),
    count: debts.length,
  };
}

async function executeGetIncomeExpenseSummary(input: Record<string, unknown>) {
  const monthCount = (input.months as number) || 3;
  const now = new Date();
  const months: Array<{
    month: string;
    income: string;
    expenses: string;
    net: string;
  }> = [];

  let totalIncome = new Decimal(0);
  let totalExpenses = new Decimal(0);

  for (let i = 0; i < monthCount; i++) {
    const d = subMonths(now, i);
    const monthStr = format(d, 'yyyy-MM');
    const startDate = `${monthStr}-01`;
    const endDate = `${monthStr}-31`;

    const balances = await accountRepo.getBalances();
    const incomeAccounts = balances.filter((b) => b.account_type === 'INCOME');
    const expenseAccounts = balances.filter((b) => b.account_type === 'EXPENSE');

    // Get income entries for this month
    const incomeEntries = await journalRepo.listEntries({
      startDate,
      endDate,
      limit: 1000,
    });

    let monthIncome = new Decimal(0);
    let monthExpenses = new Decimal(0);

    for (const entry of incomeEntries as Array<Record<string, unknown>>) {
      const summary = entry.entries_summary as string;
      if (!summary) continue;
      for (const part of summary.split('|')) {
        const [accountName, amount] = part.split(':');
        if (!amount) continue;
        const val = new Decimal(amount);
        // Income accounts have negative balances (credit normal)
        const matchedIncome = incomeAccounts.find((a) => a.account_name === accountName);
        const matchedExpense = expenseAccounts.find((a) => a.account_name === accountName);
        if (matchedIncome) monthIncome = monthIncome.plus(val.abs());
        if (matchedExpense) monthExpenses = monthExpenses.plus(val.abs());
      }
    }

    totalIncome = totalIncome.plus(monthIncome);
    totalExpenses = totalExpenses.plus(monthExpenses);

    months.push({
      month: monthStr,
      income: formatCurrency(monthIncome.toString()),
      expenses: formatCurrency(monthExpenses.toString()),
      net: formatCurrency(monthIncome.minus(monthExpenses).toString()),
    });
  }

  const avgIncome = totalIncome.div(monthCount);
  const avgExpenses = totalExpenses.div(monthCount);

  return {
    months,
    averageMonthlyIncome: formatCurrency(avgIncome.toString()),
    averageMonthlyExpenses: formatCurrency(avgExpenses.toString()),
    averageMonthlyNet: formatCurrency(avgIncome.minus(avgExpenses).toString()),
    period: `${monthCount} months`,
  };
}

async function executeGetFinancialHealthCheck() {
  // Gather data from multiple sources
  const currentMonth = format(new Date(), 'yyyy-MM');
  const [budgetStatus, incomeExpense, debtSummary, savingsGoals] = await Promise.all([
    executeGetBudgetStatus({ month: currentMonth }),
    executeGetIncomeExpenseSummary({ months: 3 }),
    executeGetDebtSummary(),
    executeGetSavingsGoals({ status: 'active' }),
  ]);

  // Savings rate
  const avgIncome = parseFloat(
    (incomeExpense as { averageMonthlyIncome: string }).averageMonthlyIncome.replace(/[£,]/g, ''),
  );
  const avgExpenses = parseFloat(
    (incomeExpense as { averageMonthlyExpenses: string }).averageMonthlyExpenses.replace(/[£,]/g, ''),
  );
  const savingsRate = avgIncome > 0 ? ((avgIncome - avgExpenses) / avgIncome) * 100 : 0;

  // Budget adherence
  const budgets = budgetStatus as Array<{ category: string; percentUsed: number }>;
  const overBudget = budgets.filter((b) => b.percentUsed > 100);
  const nearBudget = budgets.filter((b) => b.percentUsed >= 80 && b.percentUsed <= 100);

  // Debt-to-income
  const totalDebtVal = parseFloat(
    (debtSummary as { totalDebt: string }).totalDebt.replace(/[£,]/g, ''),
  );
  const annualIncome = avgIncome * 12;
  const debtToIncome = annualIncome > 0 ? (totalDebtVal / annualIncome) * 100 : 0;

  // Emergency fund estimate (3 months expenses)
  const emergencyTarget = avgExpenses * 3;
  const monthlySurplus = avgIncome - avgExpenses;

  // Concerns
  const concerns: string[] = [];
  if (savingsRate < 10) concerns.push('Savings rate is below 10% — consider reducing discretionary spending.');
  if (overBudget.length > 0)
    concerns.push(`Over budget in ${overBudget.length} categor${overBudget.length === 1 ? 'y' : 'ies'}: ${overBudget.map((b) => b.category).join(', ')}.`);
  if (debtToIncome > 400)
    concerns.push('Debt-to-income ratio is high — focus on debt reduction.');
  if (monthlySurplus < 0)
    concerns.push('You are spending more than you earn on average. Review expenses urgently.');
  if (nearBudget.length > 0)
    concerns.push(`Approaching budget limits in: ${nearBudget.map((b) => b.category).join(', ')}.`);

  return {
    savingsRate: `${savingsRate.toFixed(1)}%`,
    savingsRateStatus: savingsRate >= 20 ? 'good' : savingsRate >= 10 ? 'fair' : 'poor',
    budgetAdherence: {
      total: budgets.length,
      onTrack: budgets.filter((b) => b.percentUsed <= 80).length,
      nearLimit: nearBudget.length,
      overBudget: overBudget.length,
    },
    debtToIncome: `${debtToIncome.toFixed(0)}%`,
    emergencyFund: {
      target: formatCurrency(emergencyTarget),
      monthlyExpenses: formatCurrency(avgExpenses),
      monthsToSave: monthlySurplus > 0 ? Math.ceil(emergencyTarget / monthlySurplus) : null,
    },
    monthlySurplus: formatCurrency(monthlySurplus),
    concerns,
    incomeExpenseSummary: incomeExpense,
    savingsGoals,
    debtSummary,
  };
}

// Helper
function monthsBetween(startDate: string, endDate: string): number {
  const start = new Date(startDate);
  const end = new Date(endDate);
  return (end.getFullYear() - start.getFullYear()) * 12 + (end.getMonth() - start.getMonth());
}
