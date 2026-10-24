import { SPECIALIST_PROMPTS } from './prompts';

export const specialistIds = ['tax', 'spending', 'wealth', 'pensions', 'property', 'debt', 'data'] as const;
export type SpecialistId = typeof specialistIds[number];
export type AdviserMode = 'team' | SpecialistId;

export interface SpecialistDefinition {
  id: SpecialistId;
  name: string;
  description: string;
  exampleQuestions: readonly string[];
  /** Explicit read-only tool allowlist; the runtime must also enforce it. */
  readTools: readonly string[];
  prompt: string;
  version: '1';
}

export interface AdviserModeDefinition {
  id: AdviserMode;
  name: string;
  description: string;
  exampleQuestions: readonly string[];
}

/** Independent runtime safety boundary; never infer read permission from a name prefix. */
export const SPECIALIST_READ_TOOL_NAMES = [
  'get_account_balances', 'search_transactions', 'get_monthly_spending', 'get_categories',
  'get_property_summary', 'get_transaction_categorization', 'list_uncategorized',
  'list_months_needing_categorization', 'list_uncategorized_in_month', 'get_data_intelligence',
  'get_tips', 'get_budget_status', 'get_savings_goals', 'get_debt_summary',
  'get_income_expense_summary', 'list_memories', 'get_finance_workspace', 'get_financial_plan',
  'get_financial_health_check', 'list_investments', 'list_owners', 'get_financial_identity',
  'get_owner_tax_profile', 'get_owner_tax_computation', 'list_property_expense_categories',
  'find_transfer_pair_candidates', 'get_mortgage_payment_date_review', 'research_merchant', 'get_categorization_job',
  'get_payee_learning_context', 'list_payee_meanings',
] as const;

const commonReadTools = ['get_financial_identity', 'get_data_intelligence', 'get_finance_workspace'] as const;

/** Read-only specialist workers; all record changes remain with the coordinator. */
export const SPECIALISTS: readonly SpecialistDefinition[] = [
  {
    id: 'tax', name: 'Tax specialist',
    description: 'Income tax, rental profit, pension relief and the evidence needed before filing.',
    exampleQuestions: ['How much rental tax should I set aside?', 'What is missing from my tax profile?'],
    readTools: [...commonReadTools, 'list_owners', 'get_owner_tax_profile', 'get_owner_tax_computation', 'get_property_summary', 'list_property_expense_categories'],
    prompt: SPECIALIST_PROMPTS.tax, version: '1',
  },
  {
    id: 'spending', name: 'Spending specialist',
    description: 'Understand spending, review recurring costs and find realistic budget improvements.',
    exampleQuestions: ['Where could I reduce spending?', 'Which recurring costs should I review?'],
    readTools: [...commonReadTools, 'get_financial_plan', 'get_monthly_spending', 'get_income_expense_summary', 'get_budget_status', 'search_transactions', 'get_categories', 'get_savings_goals', 'research_merchant', 'get_categorization_job', 'get_payee_learning_context', 'list_payee_meanings'],
    prompt: SPECIALIST_PROMPTS.spending, version: '1',
  },
  {
    id: 'wealth', name: 'Wealth specialist',
    description: 'Build a financial plan around accessible reserves, goals, diversification and fees.',
    exampleQuestions: ['How should I use a sustainable monthly surplus?', 'Where is my wealth concentrated?'],
    readTools: [...commonReadTools, 'get_financial_plan', 'get_financial_health_check', 'get_account_balances', 'list_investments', 'get_savings_goals'],
    prompt: SPECIALIST_PROMPTS.wealth, version: '1',
  },
  {
    id: 'pensions', name: 'Pensions specialist',
    description: 'Review workplace matching, pension records and explicit retirement scenarios.',
    exampleQuestions: ['Am I using my employer pension match?', 'What do I need for a retirement projection?'],
    readTools: [...commonReadTools, 'get_financial_plan', 'list_investments', 'get_account_balances', 'list_owners', 'get_owner_tax_profile'],
    prompt: SPECIALIST_PROMPTS.pensions, version: '1',
  },
  {
    id: 'property', name: 'Property specialist',
    description: 'Rental cash flow, mortgage terms, property reserves and operating evidence.',
    exampleQuestions: ['How resilient is my rental property cash flow?', 'Are my mortgage payment records complete?'],
    readTools: [...commonReadTools, 'get_property_summary', 'get_debt_summary', 'get_financial_plan', 'search_transactions', 'list_owners', 'get_mortgage_payment_date_review'],
    prompt: SPECIALIST_PROMPTS.property, version: '1',
  },
  {
    id: 'debt', name: 'Debt specialist',
    description: 'Payment priorities, borrowing costs and affordable repayment choices.',
    exampleQuestions: ['Which debts should I prioritise?', 'What is missing from a reliable repayment plan?'],
    readTools: [...commonReadTools, 'get_debt_summary', 'get_financial_plan', 'get_financial_health_check', 'get_account_balances', 'get_income_expense_summary', 'get_budget_status'],
    prompt: SPECIALIST_PROMPTS.debt, version: '1',
  },
  {
    id: 'data', name: 'Data specialist',
    description: 'Missing statements, uncertain categories and records that need reconciliation.',
    exampleQuestions: ['Which missing information matters most?', 'What needs reviewing before I trust my reports?'],
    readTools: [...commonReadTools, 'search_transactions', 'get_categories', 'get_transaction_categorization', 'list_uncategorized', 'list_months_needing_categorization', 'list_uncategorized_in_month', 'find_transfer_pair_candidates', 'get_mortgage_payment_date_review', 'research_merchant', 'get_categorization_job', 'get_payee_learning_context', 'list_payee_meanings'],
    prompt: SPECIALIST_PROMPTS.data, version: '1',
  },
];

export const ADVISER_MODES: readonly AdviserModeDefinition[] = [
  {
    id: 'team', name: 'Financial adviser',
    description: 'Coordinates the relevant specialists and brings their evidence into one practical plan.',
    exampleQuestions: ['Review my finances and prioritise my next steps.', 'Help me reduce spending and build wealth.'],
  },
  ...SPECIALISTS,
];

export function isSpecialistId(value: unknown): value is SpecialistId {
  return typeof value === 'string' && specialistIds.some(id => id === value);
}

export function isAdviserMode(value: unknown): value is AdviserMode {
  return value === 'team' || isSpecialistId(value);
}

export function getSpecialist(id: SpecialistId): SpecialistDefinition;
export function getSpecialist(id: string): SpecialistDefinition | undefined;
export function getSpecialist(id: string): SpecialistDefinition | undefined {
  return SPECIALISTS.find(specialist => specialist.id === id);
}
