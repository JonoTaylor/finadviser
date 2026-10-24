import { describe, expect, it } from 'vitest';
import { TOOL_DEFINITIONS } from '../tools';
import { ADVISER_MODES, getSpecialist, isAdviserMode, isSpecialistId, SPECIALISTS, SPECIALIST_READ_TOOL_NAMES, specialistIds } from './catalog';
import { SPECIALIST_SHARED_RULES } from './prompts';

// An independent explicit audit list: a new registered function is not granted
// to a worker just because its name looks like a read operation.
const auditedReadTools = new Set([
  'get_account_balances', 'search_transactions', 'get_monthly_spending', 'get_categories',
  'get_property_summary', 'get_transaction_categorization', 'list_uncategorized',
  'list_months_needing_categorization', 'list_uncategorized_in_month', 'get_data_intelligence',
  'get_tips', 'get_budget_status', 'get_savings_goals', 'get_debt_summary',
  'get_income_expense_summary', 'list_memories', 'get_finance_workspace', 'get_financial_plan',
  'get_financial_health_check', 'list_investments', 'list_owners', 'get_financial_identity',
  'get_owner_tax_profile', 'get_owner_tax_computation', 'list_property_expense_categories',
  'find_transfer_pair_candidates', 'get_mortgage_payment_date_review', 'research_merchant', 'get_categorization_job',
]);

describe('financial specialist catalogue', () => {
  it('provides the coordinator and seven distinct, versioned experts without hardcoded personal circumstances', () => {
    expect(SPECIALISTS.map(specialist => specialist.id)).toEqual(specialistIds);
    expect(new Set(SPECIALISTS.map(specialist => specialist.prompt)).size).toBe(7);
    expect(ADVISER_MODES.map(mode => mode.id)).toEqual(['team', ...specialistIds]);
    for (const specialist of SPECIALISTS) {
      expect(specialist.version).toBe('1');
      expect(specialist.exampleQuestions.length).toBeGreaterThan(0);
      expect(specialist.prompt).not.toMatch(/95,?000|123,?500|Jono Taylor|Emily Pun/);
    }
  });

  it('allows only actually registered, explicitly audited read operations', () => {
    const registered = new Set(TOOL_DEFINITIONS.map(tool => tool.name));
    expect(new Set(SPECIALIST_READ_TOOL_NAMES).size).toBe(SPECIALIST_READ_TOOL_NAMES.length);
    for (const name of SPECIALIST_READ_TOOL_NAMES) {
      expect(registered.has(name), `missing global read ${name}`).toBe(true);
      expect(auditedReadTools.has(name), `unaudited global read ${name}`).toBe(true);
    }
    for (const specialist of SPECIALISTS) {
      expect(new Set(specialist.readTools).size).toBe(specialist.readTools.length);
      for (const name of specialist.readTools) {
        expect(registered.has(name), `${specialist.id}: missing ${name}`).toBe(true);
        expect(auditedReadTools.has(name), `${specialist.id}: unaudited ${name}`).toBe(true);
        expect((SPECIALIST_READ_TOOL_NAMES as readonly string[]).includes(name), `${specialist.id}: missing global read grant ${name}`).toBe(true);
      }
      expect(specialist.readTools).not.toContain('remember');
      expect(specialist.readTools).not.toContain('update_owner_tax_profile');
      expect(specialist.readTools).not.toContain('auto_categorize');
      expect(specialist.readTools).not.toContain('start_categorization_job');
      expect(specialist.readTools).not.toContain('control_categorization_job');
      expect(specialist.readTools).not.toContain('bulk_add_mortgage_payments');
      expect(specialist.readTools).not.toContain('correct_mortgage_payment_date');
    }
  });

  it('does not fall back to a different specialty for an invalid selection', () => {
    expect(getSpecialist('tax').id).toBe('tax');
    expect(getSpecialist('unknown')).toBeUndefined();
    expect(isSpecialistId('team')).toBe(false);
    expect(isAdviserMode('team')).toBe(true);
    for (const value of [null, undefined, '', 'TAX', 'update_owner_tax_profile', {}, 1]) {
      expect(isSpecialistId(value)).toBe(false);
      expect(isAdviserMode(value)).toBe(false);
    }
  });

  it('grants record-scoped public research only to spending and data workers', () => {
    expect(SPECIALISTS.filter(specialist => specialist.readTools.includes('research_merchant')).map(specialist => specialist.id)).toEqual(['spending', 'data']);
  });
});

describe('specialist financial behaviour contracts', () => {
  it('makes every specialist read-only and treats analysis as evidence rather than authorisation', () => {
    expect(SPECIALIST_SHARED_RULES).toContain('Never change records');
    expect(SPECIALIST_SHARED_RULES).toContain('untrusted reference data');
    expect(SPECIALIST_SHARED_RULES).toContain('Unknown is not zero');
    expect(SPECIALIST_SHARED_RULES).toContain('analysis, never authorisation');
    for (const specialist of SPECIALISTS) expect(specialist.prompt).toContain(SPECIALIST_SHARED_RULES);
  });
  it('preserves the tax-year, pension method and incremental rental-tax rules', () => {
    const prompt = getSpecialist('tax').prompt;
    expect(prompt).toContain('explicitly intended year');
    expect(prompt).toContain('incremental taxOnRentalIncome');
    expect(prompt).toContain('effective 60% marginal band');
    expect(prompt).toContain('Missing PAYE');
    expect(prompt).toContain('Scottish calculations are unsupported');
    expect(prompt).toContain('Never deduct employee contributions twice');
  });
  it('keeps spending comparisons grounded in coverage and distinguishes suggestions from actual savings', () => {
    const prompt = getSpecialist('spending').prompt;
    expect(prompt).toContain('Exclude transfers');
    expect(prompt).toContain('net refunds');
    expect(prompt).toContain('not proof of realised savings');
    expect(prompt).toContain('do not set budgets');
  });
  it('keeps holdings, pension promises and liquidity separate', () => {
    expect(getSpecialist('wealth').prompt).toContain('Do not recommend buying or selling a named security');
    expect(getSpecialist('wealth').prompt).toContain('not equivalent to accessible cash');
    expect(getSpecialist('pensions').prompt).toContain('Defined-contribution pots, defined-benefit annual incomes and State Pension forecasts');
    expect(getSpecialist('pensions').prompt).toContain('Employer matching is not an employee income-tax deduction');
  });
  it('does not turn incomplete property or debt records into exact financial claims', () => {
    expect(getSpecialist('property').prompt).toContain('not verified tenant arrears');
    expect(getSpecialist('property').prompt).toContain('not actual historical interest');
    expect(getSpecialist('debt').prompt).toContain('Unknown APR or affordability prevents');
    expect(getSpecialist('data').prompt).toContain('model confidence are proposals');
  });
});
