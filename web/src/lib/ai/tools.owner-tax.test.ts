import { describe, it, expect, vi, beforeEach } from 'vitest';
import { computeOwnerTax } from '@/lib/tax/ownerTaxComputation';

const listOwners = vi.fn();
const getTaxComputation = vi.fn();
vi.mock('@/lib/repos', () => ({
  propertyRepo: { listOwners: (...a: unknown[]) => listOwners(...a) },
  ownerTaxRepo: { getTaxComputation: (...a: unknown[]) => getTaxComputation(...a) },
  accountRepo: {},
  journalRepo: {},
  categoryRepo: {},
  tipRepo: {},
  budgetRepo: {},
  savingsGoalRepo: {},
  aiMemoryRepo: {},
}));
// tools.ts imports the model client for categorisation; none of it is needed here.
vi.mock('./claude-client', () => ({ categorizeBatch: vi.fn() }));

import { TOOL_DEFINITIONS, TOOL_LABELS, executeTool } from './tools';

// Only the fields these tests read from the tool's answer.
interface TaxToolAnswer {
  owner: { id: number; name: string };
  taxOnRentalIncome: string;
  propertyIncome: { methodUsed: string };
  financeCostRelief: { reducer: string };
  selfAssessment: {
    balanceDue: string;
    deadline: string;
    paymentsOnAccountRequired: boolean;
    dueOnDeadline: string;
  };
  estimate: string;
  breakdown: string[];
}

const OWNERS = [
  { id: 1, name: 'Emily Pun' },
  { id: 2, name: 'Jono Taylor' },
];

// Emily-like scenario from the engine tests: salary 12,570 and half a buy-to-let.
function emilyResult() {
  const computation = computeOwnerTax({
    taxYear: '2025-26',
    properties: [{ name: '249 Francis Road', lettingType: 'standard', grossIncome: '10000.00', totalExpenses: '1800.00', mortgageInterest: '2400.00' }],
    profile: {
      employmentIncome: '12570.00', payeTaxPaid: '0.00', selfEmploymentIncome: '0.00', savingsInterest: '0.00',
      dividends: '0.00', otherIncome: '0.00', propertyLossesBroughtForward: '0.00', financeCostsBroughtForward: '0.00',
    },
  });
  return {
    ...computation,
    owner: { id: 1, name: 'Emily Pun' },
    profileSaved: true,
    properties: [{
      propertyId: 10, propertyName: '249 Francis Road', lettingType: 'standard' as const, allocationPct: '50.0000',
      rentARoomShared: false, grossIncome: '10000.00', totalExpenses: '1800.00', mortgageInterest: '2400.00',
    }],
  };
}

beforeEach(() => {
  listOwners.mockReset().mockResolvedValue(OWNERS);
  getTaxComputation.mockReset();
});

describe('get_owner_tax_computation tool', () => {
  it('is registered with a label and an owner/year schema', () => {
    const def = TOOL_DEFINITIONS.find(t => t.name === 'get_owner_tax_computation');
    expect(def).toBeDefined();
    expect(Object.keys(def!.input_schema.properties)).toEqual(['owner_name', 'owner_id', 'tax_year']);
    expect(def!.description).toContain('not tax advice');
    expect(TOOL_LABELS.get_owner_tax_computation).toBeTruthy();
  });

  it('resolves the owner by name fragment, runs the computation and formats the answer', async () => {
    getTaxComputation.mockResolvedValue(emilyResult());
    const r = (await executeTool('get_owner_tax_computation', { owner_name: 'emily', tax_year: '2025-26' })) as TaxToolAnswer;
    expect(getTaxComputation).toHaveBeenCalledWith({ ownerId: 1, year: '2025-26' });
    expect(r.owner).toEqual({ id: 1, name: 'Emily Pun' });
    expect(r.taxOnRentalIncome).toBe('£1,160.00');
    expect(r.propertyIncome.methodUsed).toBe('actual expenses');
    expect(r.financeCostRelief.reducer).toBe('£480.00');
    expect(r.selfAssessment.balanceDue).toBe('£1,160.00');
    expect(r.selfAssessment.deadline).toBe('2027-01-31');
    expect(r.selfAssessment.paymentsOnAccountRequired).toBe(true);
    expect(r.selfAssessment.dueOnDeadline).toBe('£1,740.00');
    expect(r.estimate).toContain('not tax advice');
    expect(r.breakdown.length).toBeGreaterThan(10);
  });

  it('accepts owner_id and defaults the year to the current tax year', async () => {
    getTaxComputation.mockResolvedValue(emilyResult());
    await executeTool('get_owner_tax_computation', { owner_id: 2 });
    const call = getTaxComputation.mock.calls[0][0];
    expect(call.ownerId).toBe(2);
    expect(call.year).toMatch(/^\d{4}-\d{2}$/);
  });

  it('refuses ambiguous, unknown and missing owners without computing', async () => {
    listOwners.mockResolvedValue([...OWNERS, { id: 3, name: 'Jono Taylor Jr' }]);
    const ambiguous = (await executeTool('get_owner_tax_computation', { owner_name: 'taylor' })) as { error: string };
    expect(ambiguous.error).toContain('ambiguous');
    // An exact name still wins over a longer name that merely contains it.
    getTaxComputation.mockResolvedValue(emilyResult());
    await executeTool('get_owner_tax_computation', { owner_name: 'Jono Taylor' });
    expect(getTaxComputation.mock.calls[0][0].ownerId).toBe(2);

    getTaxComputation.mockClear();
    expect(((await executeTool('get_owner_tax_computation', { owner_name: 'nobody' })) as { error: string }).error).toContain('No owner matched');
    expect(((await executeTool('get_owner_tax_computation', { owner_id: 99 })) as { error: string }).error).toContain('not found');
    expect(((await executeTool('get_owner_tax_computation', {})) as { error: string }).error).toContain('owner_name or owner_id');
    expect(getTaxComputation).not.toHaveBeenCalled();
  });

  it('returns the repo error message (e.g. a bad tax year) instead of throwing', async () => {
    getTaxComputation.mockRejectedValue(new Error('Invalid tax year label: 2025 (expected YYYY-YY, e.g. 2024-25)'));
    const r = (await executeTool('get_owner_tax_computation', { owner_name: 'Emily', tax_year: '2025' })) as { error: string };
    expect(r.error).toContain('Invalid tax year label');
  });
});
