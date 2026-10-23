import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  owner: vi.fn(), owners: vi.fn(), profile: vi.fn(), patch: vi.fn(),
  context: vi.fn(), writeContext: vi.fn(), memories: vi.fn(), addMemory: vi.fn(), updateMemory: vi.fn(), computation: vi.fn(),
}));
vi.mock('@/lib/repos', () => ({
  propertyRepo: { getOwner: mocks.owner, listOwners: mocks.owners },
  ownerTaxRepo: { getProfile: mocks.profile, patchProfile: mocks.patch, getTaxComputation: mocks.computation },
  aiMemoryRepo: { list: mocks.memories, add: mocks.addMemory, update: mocks.updateMemory },
  accountRepo: {}, journalRepo: {}, categoryRepo: {}, tipRepo: {}, budgetRepo: {}, savingsGoalRepo: {},
}));
vi.mock('@/lib/finance-context', async importOriginal => ({
  ...await importOriginal<typeof import('@/lib/finance-context')>(), loadFinancialContext: mocks.context,
}));
vi.mock('@/lib/finance-workspace/store', async importOriginal => ({
  ...await importOriginal<typeof import('@/lib/finance-workspace/store')>(), writeWorkspace: mocks.writeContext,
}));

import { executeTool, TOOL_DEFINITIONS, TOOL_LABELS } from './tools';
import { AGENT_SYSTEM_PROMPT } from './prompts';
import { contextSchema, FINANCIAL_CONTEXT_KEY } from '@/lib/finance-context';
import { WorkspaceConflictError } from '@/lib/finance-workspace/store';
import { emptyTaxProfileFacts, TaxProfileConflictError } from '@/lib/tax/profileFacts';

const owner = { id: 2, name: 'Jono Taylor' };
const profile = { ownerId: 2, taxYear: '2026-27', revision: 3, saved: true, knownFields: [], facts: emptyTaxProfileFacts };
const update = { owner_id: 2, tax_year: '2026-27', patch: { expectedRevision: 3, facts: { baseSalary: '95000', bonusPercent: 30, bonusIsEstimate: true, employeePensionPercent: 8, employerPensionPercent: 8 } } };

beforeEach(() => {
  vi.resetAllMocks();
  mocks.owner.mockResolvedValue(owner);
  mocks.owners.mockResolvedValue([{ id: 1, name: 'Emily Pun' }, owner]);
  mocks.profile.mockResolvedValue(profile);
  mocks.patch.mockResolvedValue({ ...profile, revision: 4 });
  mocks.context.mockResolvedValue({ revision: 5, updatedAt: '2026-10-23T00:00:00.000Z', data: contextSchema.parse({ ownerId: 2, taxResidence: 'wales', dependants: 1 }) });
  mocks.memories.mockResolvedValue([]);
});

describe('AI tax profile tools', () => {
  it('exposes strict read/write tools with explicit years and no editable source attribution', () => {
    for (const name of ['get_financial_identity', 'save_financial_identity', 'get_owner_tax_profile', 'update_owner_tax_profile', 'update_memory']) {
      const definition = TOOL_DEFINITIONS.find(tool => tool.name === name)!;
      expect(definition.input_schema.additionalProperties).toBe(false);
      expect(TOOL_LABELS[name]).toBeTruthy();
    }
    const updateDefinition = TOOL_DEFINITIONS.find(tool => tool.name === 'update_owner_tax_profile')!;
    expect(updateDefinition.input_schema.required).toContain('tax_year');
    const patch = updateDefinition.input_schema.properties.patch as { properties: Record<string, unknown> };
    expect(patch.properties.source).toBeUndefined();
  });

  it('reads the actual owner/year and preserves unknown and estimated facts', async () => {
    expect(await executeTool('get_owner_tax_profile', { owner_id: 2, tax_year: '2026-27' })).toMatchObject({ owner, profile });
    expect(mocks.profile).toHaveBeenCalledExactlyOnceWith(2, '2026-27');
    expect(mocks.patch).not.toHaveBeenCalled();
  });

  it('persists only supplied salary, bonus and pension facts, with the exact revision and AI source', async () => {
    const result = await executeTool('update_owner_tax_profile', update);
    expect(mocks.patch).toHaveBeenCalledExactlyOnceWith(2, '2026-27', {
      expectedRevision: 3, source: 'ai', facts: { ...update.patch.facts, baseSalary: '95000.00' },
    });
    expect(result).toMatchObject({ saved: true, owner, profile: { revision: 4, taxYear: '2026-27' } });
    const passed = mocks.patch.mock.calls[0][2];
    expect(passed).not.toHaveProperty('payeTaxPaid');
    expect(passed.facts).not.toHaveProperty('pensionMethod');
    expect(passed.facts).not.toHaveProperty('pensionAnnualAmount');
    expect(mocks.addMemory).not.toHaveBeenCalled();
  });

  it('preserves an explicit unknown rather than writing a confirmed zero', async () => {
    await executeTool('update_owner_tax_profile', { owner_id: 2, tax_year: '2025-26', patch: { expectedRevision: 0, payeTaxPaid: null } });
    expect(mocks.patch).toHaveBeenCalledExactlyOnceWith(2, '2025-26', { expectedRevision: 0, source: 'ai', payeTaxPaid: null });
  });

  it.each([
    { ...update, tax_year: undefined }, { ...update, tax_year: '2025-27' }, { ...update, owner_id: 2.5 },
    { ...update, patch: { facts: { baseSalary: '95000' } } },
    { ...update, patch: { expectedRevision: 3 } },
    { ...update, patch: { expectedRevision: 3, source: 'user', payeTaxPaid: '0' } },
    { ...update, patch: { expectedRevision: 3, facts: { bonusPercent: 30, bonusAmount: '28500' } } },
    { ...update, patch: { expectedRevision: 3, facts: { employeePensionPercent: 101 } } },
    { ...update, patch: { expectedRevision: 3, facts: { pensionMethod: 'pre_tax' } } },
    { ...update, patch: { expectedRevision: 3, employmentIncome: '-1' } },
    { ...update, patch: { expectedRevision: 3, facts: { invented: 'data' } } },
  ])('rejects ambiguous or invalid profile writes before touching records: %j', async input => {
    expect(await executeTool('update_owner_tax_profile', input)).toHaveProperty('error');
    expect(mocks.owner).not.toHaveBeenCalled();
    expect(mocks.patch).not.toHaveBeenCalled();
  });

  it('rejects unknown owners and does not save to a similarly named household member', async () => {
    mocks.owner.mockResolvedValue(null);
    expect(await executeTool('update_owner_tax_profile', update)).toMatchObject({ status: 'rejected' });
    expect(mocks.patch).not.toHaveBeenCalled();
  });

  it('reports revision conflicts without retrying or claiming success', async () => {
    mocks.patch.mockRejectedValue(new TaxProfileConflictError());
    const result = await executeTool('update_owner_tax_profile', update);
    expect(result).toMatchObject({ status: 'conflict' });
    expect(result).not.toHaveProperty('saved');
    expect(mocks.patch).toHaveBeenCalledTimes(1);
  });

  it('does not leak database details or claim a failed write succeeded', async () => {
    mocks.patch.mockRejectedValue(new Error('postgres://private-finance secret'));
    const result = await executeTool('update_owner_tax_profile', update);
    expect(result).toMatchObject({ status: 'unavailable' });
    expect(JSON.stringify(result)).not.toContain('private-finance');
    expect(result).not.toHaveProperty('saved');
  });

  it.each([undefined, '', '2025-27'])('refuses to compute with a missing or inconsistent tax year: %j', async year => {
    expect(await executeTool('get_owner_tax_computation', { owner_id: 2, tax_year: year })).toHaveProperty('error');
    expect(mocks.computation).not.toHaveBeenCalled();
    expect(mocks.owners).not.toHaveBeenCalled();
  });
});

describe('AI personal identity', () => {
  it('reuses a saved confirmed selection and returns actual owners', async () => {
    expect(await executeTool('get_financial_identity', {})).toMatchObject({ saved: true, revision: 5, selectedOwner: owner });
  });

  it('does not turn the unsaved Jono default into identity evidence', async () => {
    mocks.context.mockResolvedValue({ revision: 0, data: contextSchema.parse({}) });
    expect(await executeTool('get_financial_identity', {})).toMatchObject({ saved: false, selectedOwner: null, preferredName: null });
  });

  it('saves the confirmed owner with CAS and preserves all other personal context', async () => {
    const before = (await mocks.context()).data;
    mocks.writeContext.mockResolvedValue({ revision: 6, data: { ...before, ownerId: 2, preferredName: 'Jono' } });
    expect(await executeTool('save_financial_identity', { owner_id: 2, owner_name: 'Jono Taylor', expected_revision: 5, preferred_name: 'Jono' })).toMatchObject({ saved: true, selectedOwner: owner, revision: 6 });
    expect(mocks.writeContext).toHaveBeenCalledExactlyOnceWith(FINANCIAL_CONTEXT_KEY, contextSchema, { ...before, ownerId: 2, preferredName: 'Jono' }, 5);
  });

  it('rejects mismatched owner identity and stale context without a write', async () => {
    expect(await executeTool('save_financial_identity', { owner_id: 1, owner_name: 'Jono Taylor', expected_revision: 5 })).toMatchObject({ status: 'rejected' });
    expect(await executeTool('save_financial_identity', { owner_id: 2, owner_name: 'Jono Taylor', expected_revision: 4 })).toMatchObject({ status: 'conflict' });
    expect(mocks.writeContext).not.toHaveBeenCalled();
  });

  it('reports an atomic context write conflict without replaying it', async () => {
    mocks.writeContext.mockRejectedValue(new WorkspaceConflictError());
    expect(await executeTool('save_financial_identity', { owner_id: 2, owner_name: 'Jono Taylor', expected_revision: 5 })).toMatchObject({ status: 'conflict' });
    expect(mocks.writeContext).toHaveBeenCalledTimes(1);
  });
});

describe('AI durable personal facts', () => {
  it('saves explicitly supplied employment facts as memory without inventing a tax year', async () => {
    const content = 'Jono reports a £95,000 base salary and an estimated 30% bonus. Tax year and bonus payment timing are unconfirmed.';
    mocks.addMemory.mockResolvedValue({ id: 9, content, source: 'ai' });
    expect(await executeTool('remember', { content })).toMatchObject({ id: 9, content, source: 'ai' });
    expect(mocks.addMemory).toHaveBeenCalledExactlyOnceWith(content, 'ai');
    expect(mocks.patch).not.toHaveBeenCalled();
  });

  it('does not duplicate an identical remembered fact', async () => {
    mocks.memories.mockResolvedValue([{ id: 9, content: 'Jono has an 8% employer pension match.', source: 'user' }]);
    expect(await executeTool('remember', { content: '  Jono has an 8% employer pension match.  ' })).toMatchObject({ id: 9, alreadySaved: true });
    expect(mocks.addMemory).not.toHaveBeenCalled();
  });

  it('updates the exact previously read fact with AI attribution', async () => {
    mocks.updateMemory.mockResolvedValue({ id: 9, content: 'Employee pension is now 10%.', source: 'ai' });
    expect(await executeTool('update_memory', { memory_id: 9, content: 'Employee pension is now 10%.', expected_content: 'Employee pension is 8%.' })).toMatchObject({ id: 9, updated: true });
    expect(mocks.updateMemory).toHaveBeenCalledExactlyOnceWith(9, 'Employee pension is now 10%.', 'Employee pension is 8%.', 'ai');
  });

  it('does not claim an outdated memory was replaced when CAS fails', async () => {
    mocks.updateMemory.mockResolvedValue(null);
    expect(await executeTool('update_memory', { memory_id: 9, content: 'New fact', expected_content: 'Old fact' })).toMatchObject({ status: 'conflict' });
    expect(mocks.updateMemory).toHaveBeenCalledTimes(1);
  });

  it('prompt instructs actual saves and keeps memories, estimates and tax years distinct', () => {
    expect(AGENT_SYSTEM_PROMPT).toContain('update_owner_tax_profile');
    expect(AGENT_SYSTEM_PROMPT).toContain('get_financial_identity');
    expect(AGENT_SYSTEM_PROMPT).toContain('update_memory');
    expect(AGENT_SYSTEM_PROMPT).toContain('Do not assign current salary to a past year');
    expect(AGENT_SYSTEM_PROMPT).toContain('A successful memory save does not mean the tax profile was saved');
    expect(AGENT_SYSTEM_PROMPT).toContain('Pension contributions can lower total tax while increasing the incremental tax attributed to rent');
  });
});
