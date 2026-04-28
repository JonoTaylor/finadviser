import Decimal from 'decimal.js';
import { format, subMonths } from 'date-fns';
import { accountRepo, journalRepo, categoryRepo, propertyRepo, tipRepo, budgetRepo, savingsGoalRepo, aiMemoryRepo } from '@/lib/repos';
import { calculateEquity } from '@/lib/properties/equity-calculator';
import { setInvestmentBalance } from '@/lib/properties/personal-net-worth';
import { recordMortgagePayments } from '@/lib/properties/mortgage-tracker';
import { parseMortgagePayments } from '@/lib/properties/mortgage-payment-parser';
import { formatCurrency } from '@/lib/utils/formatting';
import { matchRule } from '@/lib/import/categorizer';
import { londonTodayIso } from '@/lib/dates/today';
import {
  autoLinkPropertyExpenses,
  tagJournalAsPropertyExpense,
  tagJournalsAsPropertyExpensesBulk,
  untagJournalPropertyExpense,
  listPropertyExpenseCategories,
} from '@/lib/properties/property-expense-link';
import { categorizeBatch } from './claude-client';

/**
 * Plain JSON-Schema tool definition. claude-client.ts wraps each entry
 * with the AI SDK's tool() + jsonSchema() helpers so the gateway can
 * route to whichever provider MODEL_ID points at.
 */
interface Tool {
  name: string;
  description: string;
  input_schema: {
    type: 'object';
    properties: Record<string, unknown>;
    required: string[];
  };
}

// -------------------------------------------------------------------
// Tool definitions (JSON-Schema; provider-agnostic)
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
      'Search and filter journal entries / transactions. Returns date, description, category, amounts, plus rich metadata when present (merchant name, emoji, transaction type, bank category, user notes, address — populated for Monzo and any other bank with a "rich" import profile). Use for analysing spending patterns, finding specific transactions, or reviewing recent activity. Prefer the merchant + bank-category fields over the raw description when categorising — the description is often a cryptic bank reference, while the merchant name is human-readable.',
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
      'List uncategorized transactions with their id, date, description, amount, plus rich metadata when present (merchant name, emoji, transaction type, bank category, user notes, address). Use this before auto_categorize to show the user what needs attention, or to review what is uncategorized. The merchant + bank-category fields are usually a much better basis for categorisation than the raw description.',
    input_schema: {
      type: 'object' as const,
      properties: {
        limit: { type: 'number', description: 'Max results (default 25).' },
      },
      required: [],
    },
  },
  {
    name: 'list_months_needing_categorization',
    description:
      'List every month that still has uncategorised journal entries, with the count for each. Use this as the first step of a backward categorisation pass: pick the most recent month with uncategorised work and review that first, then move on to the previous month.',
    input_schema: {
      type: 'object' as const,
      properties: {},
      required: [],
    },
  },
  {
    name: 'list_uncategorized_in_month',
    description:
      'List uncategorised journal entries within a specific YYYY-MM month, with their id / date / description / amounts (a pipe-delimited per-account breakdown like "Bank:-12.34|Uncategorized Expense:12.34", not a single scalar), plus rich metadata when present (merchant name, emoji, transaction type, bank category, user notes, address — captured at import time for Monzo and similar rich exports). Use after picking a month from list_months_needing_categorization to see exactly what needs review. ALWAYS prefer merchant + bank-category over the raw description — the description is usually a cryptic bank reference like "tx_0000Ah…" while merchant is human-readable.',
    input_schema: {
      type: 'object' as const,
      properties: {
        month: { type: 'string', description: 'Month in YYYY-MM format (e.g. "2026-03").' },
        limit: { type: 'number', description: 'Max results (default 200).' },
      },
      required: ['month'],
    },
  },
  {
    name: 'apply_categorizations_bulk',
    description:
      'Apply many categorisations to journal entries in a single round-trip. Use after the user has confirmed a batch of suggested categorisations rather than calling categorize_transaction in a loop.',
    input_schema: {
      type: 'object' as const,
      properties: {
        items: {
          type: 'array',
          description: 'Array of {journal_id, category_id} pairs.',
          items: {
            type: 'object',
            properties: {
              journal_id: { type: 'number' },
              category_id: { type: 'number' },
            },
            required: ['journal_id', 'category_id'],
          },
        },
      },
      required: ['items'],
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
    name: 'remember',
    description:
      'Save a durable fact about the user that should persist across conversations and be available in future system prompts. Use for: recurring patterns the user describes, financial preferences, naming conventions for transactions, account purposes, categorisation rules they prefer, life facts that affect their finances (e.g. "Pays mortgage on the 28th from Monzo"). DO NOT use for: transient context, sensitive credentials, or facts that change month-to-month.',
    input_schema: {
      type: 'object' as const,
      properties: {
        content: { type: 'string', description: 'The fact to remember (1-3 sentences, written third-person about the user).' },
      },
      required: ['content'],
    },
  },
  {
    name: 'list_memories',
    description:
      'List the persisted facts the assistant currently knows about the user. Use to check whether something is already remembered before adding a duplicate.',
    input_schema: {
      type: 'object' as const,
      properties: {},
      required: [],
    },
  },
  {
    name: 'forget',
    description:
      'Delete a previously-saved memory by id. Use when the user explicitly asks to forget something, or when a saved fact is no longer accurate.',
    input_schema: {
      type: 'object' as const,
      properties: {
        memory_id: { type: 'number', description: 'The memory id from list_memories.' },
      },
      required: ['memory_id'],
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
  {
    name: 'list_investments',
    description:
      'List every investment account (pension / S&S ISA / LISA / cash savings / crypto / other) with its current balance, owner, and type. Use this to answer "how much do I have invested?" or as a precursor to update_investment_balance.',
    input_schema: {
      type: 'object' as const,
      properties: {},
      required: [],
    },
  },
  {
    name: 'add_investment_account',
    description:
      'Create a new investment account (an ASSET account flagged is_investment=true). Use when the user mentions a pension, ISA, savings pot, or similar that isn\'t yet tracked. The balance can be set in the same call by passing initial_balance, otherwise call update_investment_balance afterwards. Owner attribution is required so the dashboard\'s per-owner "Your share" view can include the account.',
    input_schema: {
      type: 'object' as const,
      properties: {
        name: { type: 'string', description: 'Account name (e.g. "Vanguard SIPP", "AJ Bell ISA"). Must be unique across all accounts.' },
        owner_id: { type: 'number', description: 'The owner this investment belongs to.' },
        investment_kind: {
          type: 'string',
          enum: ['pension', 'isa', 'lisa', 'savings', 'crypto', 'other'],
          description: 'Bucket label so similar things group together on the dashboard.',
        },
        initial_balance: { type: 'string', description: 'Optional decimal string. If provided, an opening balance journal is created in the same call.' },
        description: { type: 'string', description: 'Optional free-text note (e.g. "global all-cap fund").' },
      },
      required: ['name', 'owner_id', 'investment_kind'],
    },
  },
  {
    name: 'update_investment_balance',
    description:
      'Mark-to-market an investment account: set its current balance to a new value. Records a journal entry that DRs/CRs the account by the delta and offsets to the system "Investment Adjustments" equity account, so historical balance changes are preserved without losing the double-entry property. Use whenever the user gives a fresh statement value.',
    input_schema: {
      type: 'object' as const,
      properties: {
        account_id: { type: 'number', description: 'The investment account id (from list_investments).' },
        new_balance: { type: 'string', description: 'The new total balance as a decimal string (e.g. "152400.00").' },
        as_of_date: { type: 'string', description: 'Optional YYYY-MM-DD; defaults to today (Europe/London).' },
        description: { type: 'string', description: 'Optional note ("Quarterly Vanguard statement").' },
      },
      required: ['account_id', 'new_balance'],
    },
  },
  {
    name: 'tag_account_owner',
    description:
      'Attribute an existing ASSET account to a specific owner (set its owner_id). Use this when the user wants a personal cash account to count toward their "Your share" net-worth — by default, untagged cash accounts are excluded. Pass owner_id=null to revert to shared.',
    input_schema: {
      type: 'object' as const,
      properties: {
        account_id: { type: 'number' },
        owner_id: {
          // Schema allows null because the executor explicitly handles
          // owner_id=null as "mark account shared". Without nullable
          // typing here the AI couldn't actually pass null.
          type: ['number', 'null'],
          description: 'Owner id, or null to mark as shared.',
        },
      },
      required: ['account_id'],
    },
  },
  {
    name: 'list_owners',
    description: 'List every property owner (their id + name). Needed before add_investment_account or tag_account_owner.',
    input_schema: {
      type: 'object' as const,
      properties: {},
      required: [],
    },
  },
  {
    name: 'list_property_expense_categories',
    description:
      'List the seeded "Property expenses" subtree (parent + children like "Repairs & maintenance", "Letting agent fees", etc) with their ids. Use this BEFORE tag_property_expense / tag_property_expenses_bulk so you pick a category that\'s actually a property-expense one — tagging a journal under a non-property category would not show up on the property\'s tax-year report.',
    input_schema: {
      type: 'object' as const,
      properties: {},
      required: [],
    },
  },
  {
    name: 'tag_property_expense',
    description:
      'Attribute a single transaction (journal entry) to a specific BTL property as a property expense. Sets journal_entries.property_id (and optionally re-categorises it). Use this when the user has multiple properties and the auto-link from categorize_transaction can\'t pick which one (multi-property mode disables the single-property auto-link). After tagging, the transaction shows up on that property\'s tax-year report. Validate categoryId is in the property-expense subtree first via list_property_expense_categories.',
    input_schema: {
      type: 'object' as const,
      properties: {
        journal_id: { type: 'number', description: 'The journal entry id to tag.' },
        property_id: { type: 'number', description: 'Which BTL property the expense belongs to.' },
        category_id: {
          type: 'number',
          description: 'Optional: also re-categorise the journal under this property-expense subtree id (e.g. "Repairs & maintenance"). If omitted, the journal\'s existing category is preserved.',
        },
      },
      required: ['journal_id', 'property_id'],
    },
  },
  {
    name: 'tag_property_expenses_bulk',
    description:
      'Attribute many transactions to (potentially different) BTL properties in a single round-trip. Use after the user confirms a batch e.g. "tag all letting-agent invoices in March to Denbigh Road and the boiler repair to Francis Road". The whole batch is rejected if any item references an unknown property / journal / non-property-expense category, so the user / AI doesn\'t end up with a partially-applied state.',
    input_schema: {
      type: 'object' as const,
      properties: {
        items: {
          type: 'array',
          description: 'Array of {journal_id, property_id, category_id?} triples.',
          items: {
            type: 'object',
            properties: {
              journal_id: { type: 'number' },
              property_id: { type: 'number' },
              category_id: { type: 'number', description: 'Optional property-expense subtree id.' },
            },
            required: ['journal_id', 'property_id'],
          },
        },
      },
      required: ['items'],
    },
  },
  {
    name: 'untag_property_expense',
    description:
      'Clear a journal entry\'s property_id (the inverse of tag_property_expense). Use when an expense was wrongly attributed to a property - e.g. a personal repair that the AI mistakenly tagged to a BTL. Doesn\'t change the category; if you want to re-categorise too, follow up with categorize_transaction.',
    input_schema: {
      type: 'object' as const,
      properties: {
        journal_id: { type: 'number' },
      },
      required: ['journal_id'],
    },
  },
  {
    name: 'mark_as_transfer',
    description:
      'Flag a journal entry as an inter-account transfer so it stops double-counting in monthly income/expense totals. If a paired_journal_id is supplied, both journals are merged into ONE balanced journal with two real-account legs (Bank -> Amex shape) - this is the right call for a credit-card statement payment, a Monzo Pot top-up, or a self-transfer between two of the user\'s own accounts. If no paired_journal_id is supplied, only the single journal is flagged (use this when the partner side isn\'t connected, e.g. paying an external person from one account). Always pick a kind: statement_payment for paying off a credit card, pot_transfer for Monzo Pot top-ups, self_transfer for moving money between your own current/savings accounts, cross_bank for transfers between two different banks (Monzo to Barclays etc), refund for a vendor refund, manual when none of the above fits. Use find_transfer_pair_candidates first if you don\'t already know the partner journal.',
    input_schema: {
      type: 'object' as const,
      properties: {
        journal_id: { type: 'number', description: 'The journal entry to flag.' },
        paired_journal_id: {
          type: 'number',
          description: 'Optional: the partner journal on the other side. When supplied, the two journals are merged.',
        },
        kind: {
          type: 'string',
          enum: ['statement_payment', 'pot_transfer', 'cross_bank', 'self_transfer', 'refund', 'manual'],
          description: 'Transfer classification. Defaults to "manual" when omitted.',
        },
      },
      required: ['journal_id'],
    },
  },
  {
    name: 'unmark_transfer',
    description:
      'Clear the transfer flag on a journal entry (the inverse of mark_as_transfer). Use to recover from a false-positive transfer flag. Note: if mark_as_transfer was called with paired_journal_id (which merges the two journals into one), unmarking only flips the flag - the merge cannot be unmerged from this tool.',
    input_schema: {
      type: 'object' as const,
      properties: {
        journal_id: { type: 'number' },
      },
      required: ['journal_id'],
    },
  },
  {
    name: 'find_transfer_pair_candidates',
    description:
      'For a given journal entry, find candidate partner journals that look like the other side of an inter-account transfer (opposite-sign amount on a different real account, within a small date window). Returns up to a handful of matches sorted by date proximity. Use this before mark_as_transfer when you need to identify the partner, or when the user asks you to find unmatched transfers.',
    input_schema: {
      type: 'object' as const,
      properties: {
        journal_id: { type: 'number', description: 'The source journal whose partner you\'re looking for.' },
        window_days: { type: 'number', description: 'Date window in days (default 3).' },
      },
      required: ['journal_id'],
    },
  },
  {
    name: 'bulk_add_mortgage_payments',
    description:
      'Record a list of mortgage payments against a property\'s mortgage in one shot. Use when the user pastes a payment history (date + amount per row) and wants every line booked as a journal entry. The user\'s lender exports look like "31/12/2025 Receipt £1,382.36 Credit" - pass the raw paste in the `payments_text` field and the tool will parse it (Rejected Payments are skipped automatically). Idempotent across re-runs: re-pasting the same list returns duplicates rather than re-inserting. For interest-only mortgages every payment books fully as Mortgage Interest (S.24-deductible). Identify the property by name (case-insensitive substring match like "Francis" or "Hinckley"). When the property has more than one mortgage (e.g. first and second charge), the user must also pass a `lender` substring to disambiguate; the tool returns an error listing the available lenders if multiple match.',
    input_schema: {
      type: 'object' as const,
      properties: {
        property_name: { type: 'string', description: 'Property name or address fragment (e.g. "249 Francis", "Hinckley"). Case-insensitive substring match.' },
        payments_text: { type: 'string', description: 'Raw pasted payment history. The parser tokenises on date boundaries (DD/MM/YYYY) and skips "Rejected Payment" / debit lines.' },
        lender: { type: 'string', description: 'Optional lender-name substring to pick a specific mortgage when the property has multiple (e.g. "Hinckley", "Nationwide"). Required when the property has 2+ mortgages.' },
        paid_from_account_name: { type: 'string', description: 'Optional ASSET account name that paid the mortgage (e.g. "Bank", "Monzo"). Defaults to the user\'s only ASSET account if there\'s exactly one; otherwise the tool returns an error and lists candidates.' },
        payer_owner_name: { type: 'string', description: 'Optional owner name. Defaults to the property\'s only owner when there\'s exactly one.' },
      },
      required: ['property_name', 'payments_text'],
    },
  },
];

// Human-readable labels for tool status display
export const TOOL_LABELS: Record<string, string> = {
  list_investments: 'Loading investments',
  add_investment_account: 'Adding investment account',
  update_investment_balance: 'Updating investment balance',
  tag_account_owner: 'Tagging account owner',
  list_owners: 'Listing owners',
  list_property_expense_categories: 'Loading property-expense categories',
  tag_property_expense: 'Tagging property expense',
  tag_property_expenses_bulk: 'Tagging property expenses',
  untag_property_expense: 'Untagging property expense',
  mark_as_transfer: 'Marking as transfer',
  unmark_transfer: 'Clearing transfer flag',
  find_transfer_pair_candidates: 'Finding transfer candidates',
  bulk_add_mortgage_payments: 'Recording mortgage payments',
  get_account_balances: 'Looking up account balances',
  search_transactions: 'Searching transactions',
  get_monthly_spending: 'Fetching spending data',
  get_categories: 'Loading categories',
  get_property_summary: 'Loading property data',
  categorize_transaction: 'Categorising transaction',
  list_uncategorized: 'Finding uncategorized transactions',
  list_months_needing_categorization: 'Scanning months for uncategorized work',
  list_uncategorized_in_month: 'Reading uncategorized for the month',
  apply_categorizations_bulk: 'Applying categorisations',
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
  remember: 'Saving to memory',
  list_memories: 'Reading memory',
  forget: 'Removing from memory',
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
    case 'list_months_needing_categorization':
      return executeListMonthsNeedingCategorization();
    case 'list_uncategorized_in_month':
      return executeListUncategorizedInMonth(input);
    case 'apply_categorizations_bulk':
      return executeApplyCategorizationsBulk(input);
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
    case 'remember':
      return executeRemember(input);
    case 'list_memories':
      return executeListMemories();
    case 'forget':
      return executeForget(input);
    case 'list_investments':
      return executeListInvestments();
    case 'add_investment_account':
      return executeAddInvestmentAccount(input);
    case 'update_investment_balance':
      return executeUpdateInvestmentBalance(input);
    case 'tag_account_owner':
      return executeTagAccountOwner(input);
    case 'list_owners':
      return executeListOwners();
    case 'list_property_expense_categories':
      return executeListPropertyExpenseCategories();
    case 'tag_property_expense':
      return executeTagPropertyExpense(input);
    case 'tag_property_expenses_bulk':
      return executeTagPropertyExpensesBulk(input);
    case 'untag_property_expense':
      return executeUntagPropertyExpense(input);
    case 'mark_as_transfer':
      return executeMarkAsTransfer(input);
    case 'unmark_transfer':
      return executeUnmarkTransfer(input);
    case 'find_transfer_pair_candidates':
      return executeFindTransferPairCandidates(input);
    case 'bulk_add_mortgage_payments':
      return executeBulkAddMortgagePayments(input);
    default:
      return { error: `Unknown tool: ${name}` };
  }
}

async function executeBulkAddMortgagePayments(input: Record<string, unknown>) {
  const propertyName = input.property_name;
  const paymentsText = input.payments_text;
  const paidFromAccountName = input.paid_from_account_name;
  const payerOwnerName = input.payer_owner_name;

  if (typeof propertyName !== 'string' || !propertyName.trim()) {
    return { error: 'property_name is required (string).' };
  }
  if (typeof paymentsText !== 'string' || !paymentsText.trim()) {
    return { error: 'payments_text is required (the pasted payment list).' };
  }

  // Resolve property: try exact-name match first (case-insensitive),
  // then fall back to substring on name + address. Without the exact-
  // name preference, a fragment that matches one property's full
  // name AND another's address (e.g. "249 Francis Road" matches both
  // a property named exactly "249 Francis Road" AND "249 Francis
  // Road, Flat A" via its address) would be flagged ambiguous even
  // when the user clearly meant the exact match.
  //
  // Both branches must check for multiple matches: the DB's unique
  // constraint on properties.name is case-sensitive, so two rows
  // can legally differ only in case ("Hinckley" vs "hinckley") and
  // a case-insensitive .find() would silently pick the first.
  const properties = await propertyRepo.listProperties();
  const needle = propertyName.toLowerCase();
  const exactMatches = properties.filter(p => p.name.toLowerCase() === needle);
  let property: typeof properties[number];
  if (exactMatches.length === 1) {
    property = exactMatches[0];
  } else if (exactMatches.length > 1) {
    return {
      error: `Property name "${propertyName}" matched ${exactMatches.length} rows case-insensitively: ${exactMatches.map(p => p.name).join(', ')}. Use the exact case.`,
    };
  } else {
    const candidates = properties.filter(p => {
      const haystack = `${p.name} ${p.address ?? ''}`.toLowerCase();
      return haystack.includes(needle);
    });
    if (candidates.length === 0) {
      return {
        error: `No property matched "${propertyName}". Available: ${properties.map(p => p.name).join(', ') || '(none)'}`,
      };
    }
    if (candidates.length > 1) {
      return {
        error: `Property name "${propertyName}" is ambiguous - matched ${candidates.length}: ${candidates.map(p => p.name).join(', ')}. Try a more specific term.`,
      };
    }
    property = candidates[0];
  }

  // Resolve mortgage. Auto-pick is only safe when there's exactly
  // one - a property with first and second charges would otherwise
  // get payments mis-routed silently. With multiple, require the
  // user to pass a `lender` substring; if the substring is also
  // ambiguous, list every match so they can refine.
  const lender = input.lender;
  const mortgages = await propertyRepo.getMortgages(property.id);
  if (mortgages.length === 0) {
    return { error: `Property "${property.name}" has no mortgages set up.` };
  }
  let mortgage: typeof mortgages[number];
  if (mortgages.length === 1) {
    mortgage = mortgages[0];
  } else {
    if (typeof lender !== 'string' || !lender.trim()) {
      return {
        error: `Property "${property.name}" has ${mortgages.length} mortgages; pass \`lender\` to pick one. Available: ${mortgages.map(m => m.lender).join(', ')}`,
      };
    }
    const lenderNeedle = lender.toLowerCase();
    const matched = mortgages.filter(m => m.lender.toLowerCase().includes(lenderNeedle));
    if (matched.length === 0) {
      return {
        error: `No mortgage on "${property.name}" matched lender "${lender}". Available: ${mortgages.map(m => m.lender).join(', ')}`,
      };
    }
    if (matched.length > 1) {
      return {
        error: `Lender "${lender}" matched ${matched.length} mortgages on "${property.name}": ${matched.map(m => m.lender).join(', ')}. Refine the substring.`,
      };
    }
    mortgage = matched[0];
  }

  // Resolve payer owner. Substring match must be UNAMBIGUOUS - if a
  // fragment hits multiple owners (similar names, e.g. "John Taylor"
  // and "John Taylor Jr"), refuse to guess. Mortgage principal /
  // capital postings going to the wrong owner is a data-integrity
  // problem that's hard to undo cleanly, so fail closed.
  const ownership = await propertyRepo.getOwnership(property.id);
  let payerOwnerId: number | null = null;
  if (typeof payerOwnerName === 'string' && payerOwnerName.trim()) {
    const ownerNeedle = payerOwnerName.toLowerCase();
    const matched = ownership.filter(o => (o.owner_name as string).toLowerCase().includes(ownerNeedle));
    if (matched.length === 0) {
      return {
        error: `Owner "${payerOwnerName}" not found on property "${property.name}". Available: ${ownership.map(o => o.owner_name).join(', ')}`,
      };
    }
    if (matched.length > 1) {
      return {
        error: `Owner name "${payerOwnerName}" matched ${matched.length} owners on "${property.name}": ${matched.map(o => o.owner_name).join(', ')}. Use a more specific fragment.`,
      };
    }
    payerOwnerId = matched[0].owner_id as number;
  } else if (ownership.length === 1) {
    payerOwnerId = ownership[0].owner_id as number;
  } else {
    return {
      error: `Property "${property.name}" has multiple owners; pass payer_owner_name. Available: ${ownership.map(o => o.owner_name).join(', ')}`,
    };
  }

  // Resolve "paid from" account. Default to the only ASSET if there's
  // exactly one, otherwise require the user to disambiguate. Same
  // ambiguity rule as the owner resolver: refuse to guess between
  // similar account names ("Bank Current", "Bank Savings") because
  // the wrong choice silently misroutes payments.
  const allAccounts = await accountRepo.listAll();
  const assetAccounts = allAccounts.filter(a => a.accountType === 'ASSET');
  let fromAccountId: number | null = null;
  if (typeof paidFromAccountName === 'string' && paidFromAccountName.trim()) {
    const accNeedle = paidFromAccountName.toLowerCase();
    const matched = assetAccounts.filter(a => a.name.toLowerCase().includes(accNeedle));
    if (matched.length === 0) {
      return {
        error: `Account "${paidFromAccountName}" not found among ASSET accounts. Available: ${assetAccounts.map(a => a.name).join(', ')}`,
      };
    }
    if (matched.length > 1) {
      return {
        error: `Account name "${paidFromAccountName}" matched ${matched.length} ASSET accounts: ${matched.map(a => a.name).join(', ')}. Use a more specific fragment.`,
      };
    }
    fromAccountId = matched[0].id;
  } else if (assetAccounts.length === 1) {
    fromAccountId = assetAccounts[0].id;
  } else {
    return {
      error: `Multiple ASSET accounts found; pass paid_from_account_name to pick one. Available: ${assetAccounts.map(a => a.name).join(', ')}`,
    };
  }

  // Parse the paste. The parser handles the run-on / rejected /
  // skipped cases without any DB access.
  const parsed = parseMortgagePayments(paymentsText);
  if (parsed.valid.length === 0) {
    return {
      error: 'No valid payments found in payments_text.',
      skipped: parsed.skipped.length,
      unparsed: parsed.unparsed.length,
    };
  }

  const result = await recordMortgagePayments({
    mortgageId: mortgage.id,
    payerOwnerId,
    fromAccountId,
    payments: parsed.valid.map(p => ({ date: p.date, amount: p.amount })),
  });

  return {
    property: property.name,
    mortgage_lender: mortgage.lender,
    parsed: {
      valid: parsed.valid.length,
      skipped_rejected: parsed.skipped.filter(s => s.reason === 'rejected').length,
      skipped_debit: parsed.skipped.filter(s => s.reason === 'debit').length,
      unparsed: parsed.unparsed.length,
    },
    booked: {
      added: result.added.length,
      duplicates: result.duplicates.length,
      errors: result.errors.length,
    },
    sample_added: result.added.slice(0, 5),
    sample_duplicates: result.duplicates.slice(0, 3),
    sample_errors: result.errors.slice(0, 3),
  };
}

// -------------------------------------------------------------------
// AI memory tools
// -------------------------------------------------------------------

async function executeRemember(input: Record<string, unknown>) {
  const content = input.content;
  if (typeof content !== 'string') {
    return { error: 'content must be a string' };
  }
  try {
    const memory = await aiMemoryRepo.add(content, 'ai');
    return { id: memory.id, content: memory.content, source: memory.source };
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Failed to save memory' };
  }
}

async function executeListMemories() {
  const memories = await aiMemoryRepo.list();
  return memories.map(m => ({
    id: m.id,
    content: m.content,
    source: m.source,
    createdAt: m.createdAt.toISOString(),
  }));
}

async function executeForget(input: Record<string, unknown>) {
  const memoryId = input.memory_id;
  if (typeof memoryId !== 'number') {
    return { error: 'memory_id must be a number' };
  }
  const deleted = await aiMemoryRepo.delete(memoryId);
  return { deleted, memory_id: memoryId };
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
  // Surface the rich metadata fields (Monzo merchant name / emoji /
  // type / bank category / user notes / address) when present, so the
  // AI has enough context to identify cryptic bank descriptions.
  // `undefined` keys are dropped on JSON serialisation, so legacy
  // entries without metadata stay compact.
  return (entries as Record<string, unknown>[]).map((e) => ({
    id: e.id,
    date: e.date,
    description: e.description,
    category: e.category_name ?? 'Uncategorised',
    amounts: e.entries_summary,
    merchant: e.merchant_name ?? undefined,
    emoji: e.merchant_emoji ?? undefined,
    type: e.transaction_type ?? undefined,
    bankCategory: e.bank_category ?? undefined,
    notes: e.notes ?? undefined,
    address: e.address ?? undefined,
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
  // Stamp property_id when the new category lives in the
  // "Property expenses" subtree AND there's exactly one property —
  // otherwise the tax-year report (which filters by je.property_id)
  // can't see the expense even though it's correctly categorised.
  // Multi-property users have to specify explicitly.
  const propertyLinked = await autoLinkPropertyExpenses([journalId]);
  // Return the count (0 or 1) so the response shape matches
  // executeApplyCategorizationsBulk — keeps the AI's mental model
  // consistent across the two categorisation tools.
  return { success: true, journalId, categoryId, propertyLinked };
}

async function executeListMonthsNeedingCategorization() {
  const months = await journalRepo.listMonthsNeedingCategorization();
  return {
    months,
    totalMonths: months.length,
    totalUncategorized: months.reduce((sum, m) => sum + m.uncategorizedCount, 0),
  };
}

async function executeListUncategorizedInMonth(input: Record<string, unknown>) {
  const month = input.month;
  if (typeof month !== 'string' || !/^\d{4}-\d{2}$/.test(month)) {
    return { error: 'month must be a string in YYYY-MM format' };
  }
  // Clamp limit defensively — the AI sometimes serialises numbers as
  // strings, and we never want a stringy or out-of-range value
  // forwarded into a SQL `LIMIT` clause.
  const rawLimit = input.limit;
  const limit = typeof rawLimit === 'number' && Number.isFinite(rawLimit)
    ? Math.min(Math.max(Math.trunc(rawLimit), 1), 500)
    : 200;
  const entries = await journalRepo.listUncategorizedInMonth(month, limit);
  // Use `amounts` (not `amount`) to match search_transactions — the
  // value is a pipe-delimited per-account breakdown like
  // "Monzo:-12.34|Groceries:12.34", not a single scalar.
  return {
    month,
    count: entries.length,
    entries: entries.map(e => ({
      id: e.id,
      date: e.date,
      description: e.description,
      amounts: e.entries_summary,
      // Surface the import-time metadata sidecar (PR #23 +
      // backfilled via PR #25). Without these the AI is matching
      // categories on the cryptic bank reference alone.
      merchant: e.merchant_name ?? undefined,
      emoji: e.merchant_emoji ?? undefined,
      type: e.transaction_type ?? undefined,
      bankCategory: e.bank_category ?? undefined,
      notes: e.notes ?? undefined,
      address: e.address ?? undefined,
    })),
  };
}

async function executeApplyCategorizationsBulk(input: Record<string, unknown>) {
  const items = input.items;
  if (!Array.isArray(items)) {
    return { error: 'items must be an array of {journal_id, category_id}' };
  }
  const validated: Array<{ journalId: number; categoryId: number }> = [];
  for (const raw of items) {
    if (
      typeof raw !== 'object' || raw === null ||
      typeof (raw as { journal_id?: unknown }).journal_id !== 'number' ||
      typeof (raw as { category_id?: unknown }).category_id !== 'number'
    ) {
      return { error: 'each item must be {journal_id: number, category_id: number}' };
    }
    const r = raw as { journal_id: number; category_id: number };
    validated.push({ journalId: r.journal_id, categoryId: r.category_id });
  }
  const updated = await journalRepo.updateCategoryBulk(validated);
  // Same auto-link pass as the single-row tool: any of these
  // journals whose new category sits in "Property expenses" AND who
  // currently have NULL property_id get stamped, so they show up on
  // the tax-year report. Single-property users only.
  const propertyLinked = await autoLinkPropertyExpenses(validated.map(v => v.journalId));
  return { applied: updated, requested: validated.length, propertyLinked };
}

async function executeListUncategorized(input: Record<string, unknown>) {
  const limit = (input.limit as number) || 25;
  const entries = await journalRepo.listUncategorizedWithAmounts(limit);
  return entries.map((e) => ({
    id: e.id,
    date: e.date,
    description: e.description,
    amount: e.entries_summary,
    merchant: e.merchant_name ?? undefined,
    emoji: e.merchant_emoji ?? undefined,
    type: e.transaction_type ?? undefined,
    bankCategory: e.bank_category ?? undefined,
    notes: e.notes ?? undefined,
    address: e.address ?? undefined,
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
  // Gateway-backed: AI_GATEWAY_API_KEY replaced ANTHROPIC_API_KEY in PR #17.
  if (unmatched.length > 0 && process.env.AI_GATEWAY_API_KEY) {
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

// -------------------------------------------------------------------
// Investments + owner tagging
// -------------------------------------------------------------------

const VALID_INVESTMENT_KINDS = ['pension', 'isa', 'lisa', 'savings', 'crypto', 'other'] as const;
type InvestmentKind = typeof VALID_INVESTMENT_KINDS[number];

async function executeListInvestments() {
  const investments = await accountRepo.listInvestments();
  // Resolve balances + owner names in one query for the AI's view.
  const balances = await accountRepo.getBalances();
  const balanceById = new Map<number, string>(balances.map(b => [b.account_id, b.balance]));
  const owners = await propertyRepo.listOwners();
  const ownerById = new Map<number, string>(owners.map(o => [o.id, o.name]));
  return investments.map(inv => ({
    id: inv.id,
    name: inv.name,
    kind: inv.investmentKind ?? 'other',
    ownerId: inv.ownerId,
    ownerName: inv.ownerId !== null ? ownerById.get(inv.ownerId) ?? null : null,
    balance: formatCurrency(balanceById.get(inv.id) ?? '0'),
    raw_balance: balanceById.get(inv.id) ?? '0',
  }));
}

async function executeListOwners() {
  const owners = await propertyRepo.listOwners();
  return owners.map(o => ({ id: o.id, name: o.name }));
}

async function executeAddInvestmentAccount(input: Record<string, unknown>) {
  const name = input.name;
  const ownerId = input.owner_id;
  const kind = input.investment_kind;
  const initialBalance = input.initial_balance;
  const description = input.description;

  if (typeof name !== 'string' || name.trim().length === 0) return { error: 'name is required' };
  if (typeof ownerId !== 'number') return { error: 'owner_id is required' };
  if (typeof kind !== 'string' || !VALID_INVESTMENT_KINDS.includes(kind as InvestmentKind)) {
    return { error: `investment_kind must be one of: ${VALID_INVESTMENT_KINDS.join(', ')}` };
  }
  const owner = await propertyRepo.getOwner(ownerId);
  if (!owner) return { error: `Owner ${ownerId} not found` };

  try {
    const account = await accountRepo.create({
      name: name.trim(),
      accountType: 'ASSET',
      isInvestment: true,
      investmentKind: kind,
      ownerId,
      description: typeof description === 'string' ? description : null,
    });
    let openingResult: { delta: string; previousBalance: string } | null = null;
    if (typeof initialBalance === 'string' && /^-?\d+(\.\d+)?$/.test(initialBalance.trim())) {
      const r = await setInvestmentBalance({
        accountId: account.id,
        newBalance: initialBalance.trim(),
        // londonTodayIso() so the journal date matches the rest of
        // the app (UK calendar) regardless of where the function
        // executor is running.
        asOfDate: londonTodayIso(),
        description: `Opening balance - ${account.name}`,
      });
      openingResult = { delta: r.delta, previousBalance: r.previousBalance };
    }
    return {
      success: true,
      account: { id: account.id, name: account.name, ownerId, kind },
      openingBalance: openingResult,
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Failed to create investment';
    if (msg.includes('duplicate key') || msg.includes('unique')) {
      return { error: `An account named "${name}" already exists. Pick a different name.` };
    }
    return { error: msg };
  }
}

async function executeUpdateInvestmentBalance(input: Record<string, unknown>) {
  const accountId = input.account_id;
  const newBalance = input.new_balance;
  const asOfDate = input.as_of_date;
  const description = input.description;

  if (typeof accountId !== 'number') return { error: 'account_id is required' };
  if (typeof newBalance !== 'string' || !/^-?\d+(\.\d+)?$/.test(newBalance.trim())) {
    return { error: 'new_balance must be a decimal number string' };
  }
  let dateIso: string;
  if (typeof asOfDate === 'string') {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(asOfDate)) {
      return { error: 'as_of_date must be YYYY-MM-DD' };
    }
    dateIso = asOfDate;
  } else {
    dateIso = londonTodayIso();
  }

  try {
    const result = await setInvestmentBalance({
      accountId,
      newBalance: newBalance.trim(),
      asOfDate: dateIso,
      description: typeof description === 'string' ? description : undefined,
    });
    return {
      success: true,
      accountId,
      previousBalance: formatCurrency(result.previousBalance),
      newBalance: formatCurrency(newBalance),
      delta: formatCurrency(result.delta),
      journalId: result.journalId,
      asOfDate: dateIso,
    };
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Failed to update balance' };
  }
}

async function executeTagAccountOwner(input: Record<string, unknown>) {
  const accountId = input.account_id;
  const ownerId = input.owner_id ?? null;
  if (typeof accountId !== 'number') return { error: 'account_id is required' };
  if (ownerId !== null && typeof ownerId !== 'number') {
    return { error: 'owner_id must be a number or null (for shared)' };
  }
  if (typeof ownerId === 'number') {
    const owner = await propertyRepo.getOwner(ownerId);
    if (!owner) return { error: `Owner ${ownerId} not found` };
  }
  const updated = await accountRepo.update(accountId, { ownerId: ownerId as number | null });
  if (!updated) return { error: 'Account not found' };
  return {
    success: true,
    accountId: updated.id,
    accountName: updated.name,
    ownerId: updated.ownerId ?? null,
  };
}

// -------------------------------------------------------------------
// Property-expense tagging
// -------------------------------------------------------------------

async function executeListPropertyExpenseCategories() {
  try {
    const rows = await listPropertyExpenseCategories();
    return { categories: rows, count: rows.length };
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Failed to list property-expense categories' };
  }
}

async function executeTagPropertyExpense(input: Record<string, unknown>) {
  const journalId = input.journal_id;
  const propertyId = input.property_id;
  const categoryId = input.category_id;
  if (typeof journalId !== 'number') return { error: 'journal_id is required' };
  if (typeof propertyId !== 'number') return { error: 'property_id is required' };
  if (categoryId !== undefined && typeof categoryId !== 'number') {
    return { error: 'category_id, when supplied, must be a number' };
  }
  try {
    const result = await tagJournalAsPropertyExpense({
      journalId,
      propertyId,
      categoryId: typeof categoryId === 'number' ? categoryId : undefined,
    });
    return { success: true, ...result };
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Failed to tag property expense' };
  }
}

async function executeTagPropertyExpensesBulk(input: Record<string, unknown>) {
  const items = input.items;
  if (!Array.isArray(items)) {
    return { error: 'items must be an array of { journal_id, property_id, category_id? }' };
  }
  const validated: Array<{ journalId: number; propertyId: number; categoryId?: number }> = [];
  for (const raw of items) {
    if (typeof raw !== 'object' || raw === null) {
      return { error: 'each item must be an object with journal_id and property_id' };
    }
    const r = raw as { journal_id?: unknown; property_id?: unknown; category_id?: unknown };
    if (typeof r.journal_id !== 'number') return { error: 'each item must have a numeric journal_id' };
    if (typeof r.property_id !== 'number') return { error: 'each item must have a numeric property_id' };
    if (r.category_id !== undefined && typeof r.category_id !== 'number') {
      return { error: 'category_id, when supplied, must be a number' };
    }
    validated.push({
      journalId: r.journal_id,
      propertyId: r.property_id,
      categoryId: typeof r.category_id === 'number' ? r.category_id : undefined,
    });
  }
  try {
    const result = await tagJournalsAsPropertyExpensesBulk(validated);
    return { success: true, ...result };
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Failed to tag property expenses' };
  }
}

async function executeUntagPropertyExpense(input: Record<string, unknown>) {
  const journalId = input.journal_id;
  if (typeof journalId !== 'number') return { error: 'journal_id is required' };
  try {
    const result = await untagJournalPropertyExpense(journalId);
    return { success: true, ...result };
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Failed to untag property expense' };
  }
}

const TRANSFER_KINDS = [
  'statement_payment',
  'pot_transfer',
  'cross_bank',
  'self_transfer',
  'refund',
  'manual',
] as const;

async function executeMarkAsTransfer(input: Record<string, unknown>) {
  const journalId = input.journal_id;
  const pairedJournalId = input.paired_journal_id;
  const rawKind = input.kind;
  if (typeof journalId !== 'number') return { error: 'journal_id is required' };
  if (pairedJournalId !== undefined && typeof pairedJournalId !== 'number') {
    return { error: 'paired_journal_id, when supplied, must be a number' };
  }
  if (rawKind !== undefined && (typeof rawKind !== 'string' || !(TRANSFER_KINDS as readonly string[]).includes(rawKind))) {
    return { error: `kind must be one of: ${TRANSFER_KINDS.join(', ')}` };
  }
  const kind = (typeof rawKind === 'string' ? rawKind : 'manual') as typeof TRANSFER_KINDS[number];
  try {
    if (typeof pairedJournalId === 'number') {
      const mergedId = await journalRepo.mergeTransferPair(journalId, pairedJournalId, kind);
      return {
        success: true,
        merged: true,
        journalId: mergedId,
        sourceJournalIds: [journalId, pairedJournalId],
        kind,
      };
    }
    await journalRepo.markAsTransfer(journalId, kind);
    return { success: true, merged: false, journalId, kind };
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Failed to mark as transfer' };
  }
}

async function executeUnmarkTransfer(input: Record<string, unknown>) {
  const journalId = input.journal_id;
  if (typeof journalId !== 'number') return { error: 'journal_id is required' };
  try {
    await journalRepo.unmarkTransfer(journalId);
    return { success: true, journalId };
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Failed to unmark transfer' };
  }
}

async function executeFindTransferPairCandidates(input: Record<string, unknown>) {
  const journalId = input.journal_id;
  const rawWindow = input.window_days;
  if (typeof journalId !== 'number') return { error: 'journal_id is required' };
  const windowDays = typeof rawWindow === 'number' && Number.isFinite(rawWindow)
    ? Math.min(Math.max(Math.trunc(rawWindow), 0), 30)
    : 3;
  try {
    const candidates = await journalRepo.findTransferCandidates(journalId, windowDays, 5);
    return { journalId, windowDays, candidates };
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Failed to find candidates' };
  }
}
