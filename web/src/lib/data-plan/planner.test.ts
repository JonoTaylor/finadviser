import { describe, expect, it } from 'vitest';
import { mergeNotesBlock, planChanges, propertyExpenseSubtree } from './planner';
import { simulateChanges } from './simulate';
import { computeOwnerTotals } from './totals';
import { baseState, basePlan, line, ROAD_ID, STREET_ID, type Json } from './test-fixtures';
import type { Change, DbState } from './types';


function changesOf<T extends Change['type']>(changes: Change[], type: T): Array<Extract<Change, { type: T }>> {
  return changes.filter((c): c is Extract<Change, { type: T }> => c.type === type);
}

function skipFor(result: ReturnType<typeof planChanges>, itemId: string) {
  return result.skips.find(s => s.itemId === itemId);
}

describe('planChanges: preconditions', () => {
  it('refuses when the owner does not exist and lists the owners that do', () => {
    const plan = basePlan(j => (j.owner = 'Nobody Here'));
    const r = planChanges(plan, baseState());
    expect(r.refusals).toHaveLength(1);
    expect(r.refusals[0]).toContain('"Nobody Here" does not exist');
    expect(r.refusals[0]).toContain('"Alex Example"');
    expect(r.refusals[0]).toContain('"Sam Sample"');
    expect(r.changes).toEqual([]);
  });

  it('refuses on a property name that is not an exact match', () => {
    const plan = basePlan(j => ((j.properties as Json[])[0].name = '1 example road'));
    const r = planChanges(plan, baseState());
    expect(r.refusals.join('\n')).toContain('"1 example road" does not exist');
    expect(r.refusals.join('\n')).toContain('"1 Example Road"');
  });

  it('refuses when the owner has no stake in a plan property', () => {
    const state = baseState();
    state.ownership = state.ownership.filter(o => !(o.ownerId === 1 && o.propertyId === STREET_ID));
    const r = planChanges(basePlan(), state);
    expect(r.refusals.join('\n')).toMatch(/not an owner of "2 Sample Street"/);
  });

  it('refuses when the system Mortgage Interest account is missing or not a system account', () => {
    const state = baseState();
    state.accounts = state.accounts.map(a => (a.name === 'Mortgage Interest' ? { ...a, isSystem: false } : a));
    expect(planChanges(basePlan(), state).refusals.join('\n')).toContain('"Mortgage Interest"');
  });
});

describe('planChanges: new journals follow the ledger conventions', () => {
  const result = planChanges(basePlan(), baseState());
  const creates = changesOf(result.changes, 'journal_create');

  it('has no refusals or blocked items on an empty ledger', () => {
    expect(result.refusals).toEqual([]);
    expect(result.blocked).toEqual([]);
  });

  it('books an expense Dr Property Expenses / Cr the paying asset account, tagged and referenced', () => {
    const c = creates.find(x => x.itemId === 'example-insurance')!;
    expect(c.kind).toBe('expense');
    expect(c.propertyId).toBe(ROAD_ID);
    expect(c.reference).toBe('plan:example-2025-26-v1:example-insurance');
    expect(c.categoryName).toBe('Property insurance');
    expect(c.legs).toEqual([
      { accountId: 100, accountName: 'Example Current Account', amount: '-300.00' },
      { accountId: 103, accountName: 'Property Expenses', amount: '300.00' },
    ]);
  });

  it('books mortgage interest Dr system Mortgage Interest / Cr bank, with the tracker description and no principal leg', () => {
    const c = creates.find(x => x.itemId === 'example-mortgage-2025-05')!;
    expect(c.kind).toBe('mortgage_interest');
    expect(c.description).toBe('Mortgage payment - Example Building Society');
    expect(c.legs).toEqual([
      { accountId: 100, accountName: 'Example Current Account', amount: '-400.00' },
      { accountId: 102, accountName: 'Mortgage Interest', amount: '400.00' },
    ]);
    expect(c.categoryId).toBeNull();
  });

  it('books income Dr the receiving asset / Cr the INCOME account', () => {
    const c = creates.find(x => x.itemId === 'sample-booking-2025-08-10')!;
    expect(c.kind).toBe('income');
    expect(c.propertyId).toBe(STREET_ID);
    expect(c.legs).toEqual([
      { accountId: 100, accountName: 'Example Current Account', amount: '250.00' },
      { accountId: 105, accountName: 'Uncategorized Income', amount: '-250.00' },
    ]);
    expect(c.categoryName).toBe('Income');
  });

  it('every journal balances to zero', () => {
    for (const c of creates) {
      const sum = c.legs.reduce((acc, l) => acc + Math.round(parseFloat(l.amount) * 100), 0);
      expect(sum, c.itemId).toBe(0);
    }
  });

  it('lists include:false items as skipped and never changes them', () => {
    expect(skipFor(result, 'example-boiler-service')?.reason).toBe('excluded');
    expect(skipFor(result, 'example-tenancy-2')?.reason).toBe('excluded');
    expect(skipFor(result, 'example-dividends')?.reason).toBe('excluded');
    expect(result.changes.some(c => 'itemId' in c && c.itemId === 'example-boiler-service')).toBe(false);
  });

  it('only ever produces add/update change types (no delete exists)', () => {
    const allowed = new Set(['letting_type', 'tenancy_create', 'tenancy_update', 'journal_create', 'journal_tag', 'tax_profile']);
    for (const c of result.changes) expect(allowed.has(c.type)).toBe(true);
  });
});

describe('planChanges: account and category resolution', () => {
  it('blocks (not crashes) an item whose account alias is unset, and lists candidate accounts', () => {
    const plan = basePlan(j => ((j.accounts as Json).ownerBank = null));
    const r = planChanges(plan, baseState());
    const b = r.blocked.find(x => x.itemId === 'example-insurance')!;
    expect(b.reason).toContain('no account name set');
    expect(b.reason).toContain('"Example Current Account"');
    expect(r.blocked.some(x => x.itemId === 'sample-booking-2025-08-10')).toBe(true);
    // other items still plan normally
    expect(changesOf(r.changes, 'journal_create').some(c => c.itemId === 'example-mortgage-2025-05')).toBe(true);
  });

  it('blocks an account that is the wrong type or missing', () => {
    const plan = basePlan(j => ((j.accounts as Json).ownerBank = 'Example Credit Card'));
    expect(planChanges(plan, baseState()).blocked[0].reason).toContain('is LIABILITY, but ASSET is required');
    const plan2 = basePlan(j => ((j.accounts as Json).ownerBank = 'No Such Account'));
    expect(planChanges(plan2, baseState()).blocked[0].reason).toContain('does not exist');
  });

  it('does not need the account when the item is already present', () => {
    const plan = basePlan(j => ((j.accounts as Json).ownerBank = null));
    const state = baseState();
    state.taggedLines = [
      line({ date: '2025-07-02', amount: '300.00', accountName: 'Property Expenses', accountType: 'EXPENSE', propertyId: ROAD_ID }),
    ];
    const r = planChanges(plan, state);
    expect(skipFor(r, 'example-insurance')?.reason).toBe('duplicate_tagged');
    expect(r.blocked.some(b => b.itemId === 'example-insurance')).toBe(false);
  });

  it('blocks an expense category outside the Property expenses subtree', () => {
    const plan = basePlan(j => ((j.properties as Json[])[0].expenses[0].category = 'Shopping'));
    const r = planChanges(plan, baseState());
    expect(r.blocked.find(b => b.itemId === 'example-insurance')!.reason).toContain('not in the "Property expenses" subtree');
  });

  it('uses the property\'s only mortgage even if the plan names the lender differently (with a warning)', () => {
    const plan = basePlan(j => ((j.properties as Json[])[0].mortgageInterest[0].lender = 'EBS'));
    const r = planChanges(plan, baseState());
    const c = changesOf(r.changes, 'journal_create').find(x => x.itemId === 'example-mortgage-2025-05')!;
    expect(c.description).toBe('Mortgage payment - Example Building Society');
    expect(r.warnings.join('\n')).toContain('differs from the property\'s only mortgage');
  });

  it('with several mortgages on the property, requires the lender to match one of them', () => {
    const state = baseState();
    state.mortgages.push({ id: 2, propertyId: ROAD_ID, lender: 'Second Lender', interestOnly: false });
    const plan = basePlan(j => ((j.properties as Json[])[0].mortgageInterest[0].lender = 'Other Bank'));
    expect(planChanges(plan, state).blocked.find(b => b.itemId === 'example-mortgage-2025-05')!.reason).toContain('matches none of the 2 mortgages');
    const ok = basePlan(j => ((j.properties as Json[])[0].mortgageInterest[0].lender = 'second lender'));
    const c = changesOf(planChanges(ok, state).changes, 'journal_create').find(x => x.itemId === 'example-mortgage-2025-05')!;
    expect(c.description).toBe('Mortgage payment - Second Lender');
  });

  it('warns when the property has no mortgage record at all', () => {
    const state = baseState();
    state.mortgages = [];
    const r = planChanges(basePlan(), state);
    expect(r.warnings.join('\n')).toContain('has no mortgage record');
  });

  it('resolves the property-expense subtree like getPropertyExpenseCategoryIds', () => {
    const state = baseState();
    state.categories.push({ id: 50, name: 'Deep', parentId: 3 });
    const ids = propertyExpenseSubtree(state.categories).map(c => c.id).sort((a, b) => a - b);
    expect(ids).toEqual([1, 2, 3, 4, 50]);
  });
});

describe('planChanges: idempotency and duplicates', () => {
  it('skips items whose plan reference already exists', () => {
    const state = baseState();
    state.referencedJournals = [
      { journalId: 7, reference: 'plan:example-2025-26-v1:example-insurance', date: '2025-07-02', description: 'x', propertyId: ROAD_ID, amount: '300.00', accountName: 'Property Expenses' },
    ];
    const r = planChanges(basePlan(), state);
    expect(skipFor(r, 'example-insurance')).toMatchObject({ reason: 'already_loaded' });
    expect(skipFor(r, 'example-insurance')!.detail).toContain('journal #7');
  });

  it('warns when a loaded journal now disagrees with the plan, and never edits it', () => {
    const state = baseState();
    state.referencedJournals = [
      { journalId: 7, reference: 'plan:example-2025-26-v1:example-insurance', date: '2025-07-02', description: 'x', propertyId: ROAD_ID, amount: '250.00', accountName: 'Property Expenses' },
    ];
    const r = planChanges(basePlan(), state);
    expect(r.warnings.join('\n')).toContain('holds £250.00 but the plan now says £300.00');
    expect(r.changes.some(c => 'itemId' in c && c.type !== 'journal_create' && c.itemId === 'example-insurance')).toBe(false);
  });

  it('plan -> apply (simulated) -> plan finds nothing left to do', () => {
    const state = baseState();
    const first = planChanges(basePlan(), state);
    expect(first.changes.length).toBeGreaterThan(0);
    const second = planChanges(basePlan(), simulateChanges(state, first.changes));
    expect(second.changes).toEqual([]);
    expect(second.blocked).toEqual([]);
  });

  it('skips a tagged duplicate within the window, creates just outside it', () => {
    const inside = baseState();
    inside.taggedLines = [line({ date: '2025-07-07', amount: '300.00', accountName: 'Property Expenses', accountType: 'EXPENSE', propertyId: ROAD_ID, description: 'INSURER' })];
    const r = planChanges(basePlan(), inside);
    expect(skipFor(r, 'example-insurance')).toMatchObject({ reason: 'duplicate_tagged' });
    expect(skipFor(r, 'example-insurance')!.detail).toContain('5 days from the plan date');

    const outside = baseState();
    outside.taggedLines = [line({ date: '2025-07-08', amount: '300.00', accountName: 'Property Expenses', accountType: 'EXPENSE', propertyId: ROAD_ID })];
    expect(changesOf(planChanges(basePlan(), outside).changes, 'journal_create').some(c => c.itemId === 'example-insurance')).toBe(true);
  });

  it('tags an untagged match instead of creating when the item allows it, and sets the category only if empty', () => {
    const state = baseState();
    const untagged = line({ date: '2025-07-03', amount: '300.00', accountName: 'Uncategorized Expense', accountType: 'EXPENSE', description: 'BANK INSURER' });
    state.candidateLines = [untagged];
    const r = planChanges(basePlan(), state);
    const tag = changesOf(r.changes, 'journal_tag').find(c => c.itemId === 'example-insurance')!;
    expect(tag.journalId).toBe(untagged.journalId);
    expect(tag.propertyId).toBe(ROAD_ID);
    expect(tag.setCategoryName).toBe('Property insurance');
    expect(changesOf(r.changes, 'journal_create').some(c => c.itemId === 'example-insurance')).toBe(false);

    const categorised = baseState();
    categorised.candidateLines = [{ ...untagged, categoryId: 6 }];
    const r2 = planChanges(basePlan(), categorised);
    const tag2 = changesOf(r2.changes, 'journal_tag')[0];
    expect(tag2.setCategoryId).toBeNull();
    expect(r2.warnings.join('\n')).toContain('keeps its existing category');
  });

  it('reports but does not tag an untagged match when the item does not allow it', () => {
    const plan = basePlan(j => ((j.properties as Json[])[0].expenses[0].tagExisting = false));
    const state = baseState();
    state.candidateLines = [line({ date: '2025-07-03', amount: '300.00', accountName: 'Uncategorized Expense', accountType: 'EXPENSE' })];
    const r = planChanges(plan, state);
    expect(skipFor(r, 'example-insurance')).toMatchObject({ reason: 'duplicate_untagged' });
    expect(changesOf(r.changes, 'journal_tag')).toHaveLength(0);
    expect(changesOf(r.changes, 'journal_create').some(c => c.itemId === 'example-insurance')).toBe(false);
  });

  it('never tags an untagged mortgage payment (it would land in the ordinary expenses)', () => {
    const state = baseState();
    state.candidateLines = [line({ date: '2025-05-31', amount: '400.00', accountName: 'Uncategorized Expense', accountType: 'EXPENSE' })];
    const r = planChanges(basePlan(), state);
    expect(skipFor(r, 'example-mortgage-2025-05')).toMatchObject({ reason: 'duplicate_untagged' });
    expect(skipFor(r, 'example-mortgage-2025-05')!.detail).toContain('finance cost');
  });

  it('warns when a mortgage payment was booked to an ordinary expense account', () => {
    const state = baseState();
    state.taggedLines = [line({ date: '2025-06-01', amount: '400.00', accountName: 'Property Expenses', accountType: 'EXPENSE', propertyId: ROAD_ID })];
    const r = planChanges(basePlan(), state);
    expect(skipFor(r, 'example-mortgage-2025-05')).toMatchObject({ reason: 'duplicate_tagged' });
    expect(r.warnings.join('\n')).toContain('booked to "Property Expenses"');
  });

  it('does not add an estimated mortgage payment where a real one is already recorded for another amount', () => {
    const state = baseState();
    state.taggedLines = [line({ date: '2025-06-01', amount: '412.50', accountName: 'Mortgage Interest', accountType: 'EXPENSE', propertyId: ROAD_ID })];
    const r = planChanges(basePlan(), state);
    expect(skipFor(r, 'example-mortgage-2025-05')).toMatchObject({ reason: 'different_amount' });
    expect(skipFor(r, 'example-mortgage-2025-05')!.detail).toContain('£412.50 rather than the plan\'s £400.00');
    expect(changesOf(r.changes, 'journal_create').some(c => c.itemId === 'example-mortgage-2025-05')).toBe(false);
  });

  it('does not create income when the net payout is already in the ledger (alternate amount)', () => {
    const state = baseState();
    state.candidateLines = [line({ date: '2025-08-12', amount: '-240.00', accountName: 'Uncategorized Income', accountType: 'INCOME' })];
    const r = planChanges(basePlan(), state);
    expect(skipFor(r, 'sample-booking-2025-08-10')).toMatchObject({ reason: 'alternate_amount' });
    expect(changesOf(r.changes, 'journal_create').some(c => c.itemId === 'sample-booking-2025-08-10')).toBe(false);
  });

  it('ignores a same-amount journal tagged to a different property, with a warning', () => {
    const state = baseState();
    state.taggedLines = [line({ date: '2025-07-02', amount: '300.00', accountName: 'Property Expenses', accountType: 'EXPENSE', propertyId: STREET_ID })];
    const r = planChanges(basePlan(), state);
    expect(changesOf(r.changes, 'journal_create').some(c => c.itemId === 'example-insurance')).toBe(true);
    expect(r.warnings.join('\n')).toContain('tagged to property id 20');
  });

  it('lets one existing journal satisfy only one plan item', () => {
    const plan = basePlan(j => {
      const second = JSON.parse(JSON.stringify((j.properties as Json[])[0].expenses[0]));
      second.id = 'example-insurance-again';
      (j.properties as Json[])[0].expenses.push(second);
    });
    const state = baseState();
    state.taggedLines = [line({ date: '2025-07-02', amount: '300.00', accountName: 'Property Expenses', accountType: 'EXPENSE', propertyId: ROAD_ID })];
    const r = planChanges(plan, state);
    expect(skipFor(r, 'example-insurance')?.reason).toBe('duplicate_tagged');
    expect(changesOf(r.changes, 'journal_create').some(c => c.itemId === 'example-insurance-again')).toBe(true);
    expect(r.warnings.join('\n')).toContain('are identical');
  });

  it('does not count a transfer-flagged journal as present', () => {
    const state = baseState();
    state.taggedLines = [line({ date: '2025-07-02', amount: '300.00', accountName: 'Property Expenses', accountType: 'EXPENSE', propertyId: ROAD_ID, isTransfer: true })];
    const r = planChanges(basePlan(), state);
    expect(skipFor(r, 'example-insurance')!.detail).toContain('NOT in the totals');
    expect(r.warnings.join('\n')).toContain('is_transfer');
  });
});

describe('planChanges: letting type', () => {
  it('changes it, and skips when already set', () => {
    const r = planChanges(basePlan(), baseState());
    expect(changesOf(r.changes, 'letting_type')).toEqual([
      expect.objectContaining({ propertyId: STREET_ID, from: 'standard', to: 'rent_a_room' }),
    ]);
    const state = baseState();
    state.properties[1].lettingType = 'rent_a_room';
    const again = planChanges(basePlan(), state);
    expect(changesOf(again.changes, 'letting_type')).toHaveLength(0);
    expect(skipFor(again, 'sample-letting-type')?.reason).toBe('unchanged');
  });
});

describe('planChanges: tenancies', () => {
  const existing = {
    id: 3,
    propertyId: ROAD_ID,
    tenantName: 'P. Tenant',
    startDate: '2024-09-01',
    endDate: '2026-08-31',
    rentAmount: '1000.00',
    rentFrequency: 'monthly' as const,
    depositAmount: null,
    notes: null,
  };

  it('creates a tenancy that does not exist', () => {
    const t = changesOf(planChanges(basePlan(), baseState()).changes, 'tenancy_create');
    expect(t).toHaveLength(1);
    expect(t[0].values).toMatchObject({ tenantName: 'Pat Tenant', startDate: '2024-09-01', endDate: '2026-03-01', rentAmount: '1000.00', depositAmount: '1000.00' });
  });

  it('matches on property + start date and updates only fields marked update:true', () => {
    const state = baseState();
    state.tenancies = [existing];
    const r = planChanges(basePlan(), state);
    const u = changesOf(r.changes, 'tenancy_update')[0];
    expect(u.tenancyId).toBe(3);
    expect(u.set).toEqual({ endDate: '2026-03-01' });
    // other differences are reported, not applied
    const reported = u.diffs.filter(d => !d.willUpdate).map(d => d.field).sort();
    expect(reported).toEqual(['depositAmount', 'notes', 'tenantName']);
    expect(changesOf(r.changes, 'tenancy_create')).toHaveLength(0);
  });

  it('says so when there are differences but none may be updated', () => {
    const plan = basePlan(j => (((j.properties as Json[])[0].tenancies[0].fields.endDate.update) = false));
    const state = baseState();
    state.tenancies = [existing];
    const r = planChanges(plan, state);
    expect(skipFor(r, 'example-tenancy-1')?.reason).toBe('no_updates_allowed');
    expect(changesOf(r.changes, 'tenancy_update')).toHaveLength(0);
  });

  it('skips a tenancy that already matches', () => {
    const state = baseState();
    state.tenancies = [{ ...existing, tenantName: 'Pat Tenant', endDate: '2026-03-01', depositAmount: '1000', notes: 'Example tenancy agreement ref 123.' }];
    const r = planChanges(basePlan(), state);
    expect(skipFor(r, 'example-tenancy-1')?.reason).toBe('unchanged');
  });

  it('blocks when two tenancies share the start date', () => {
    const state = baseState();
    state.tenancies = [existing, { ...existing, id: 4 }];
    expect(planChanges(basePlan(), state).blocked[0].reason).toContain('cannot tell which to update');
  });

  it('blocks a NEW tenancy that overlaps an existing one, including a shared boundary day', () => {
    const state = baseState();
    state.tenancies = [{ ...existing, id: 9, startDate: '2024-05-01', endDate: '2024-09-01' }]; // ends on the new start date
    const r = planChanges(basePlan(), state);
    expect(r.blocked.find(b => b.itemId === 'example-tenancy-1')!.reason).toContain('overlaps existing #9');
    expect(changesOf(r.changes, 'tenancy_create')).toHaveLength(0);

    // one day apart is fine
    state.tenancies = [{ ...existing, id: 9, startDate: '2024-05-01', endDate: '2024-08-31' }];
    expect(changesOf(planChanges(basePlan(), state).changes, 'tenancy_create')).toHaveLength(1);
  });

  it('lets allowOverlap override the block', () => {
    const plan = basePlan(j => (((j.properties as Json[])[0].tenancies[0].allowOverlap) = true));
    const state = baseState();
    state.tenancies = [{ ...existing, id: 9, startDate: '2024-05-01', endDate: '2024-09-01' }];
    expect(changesOf(planChanges(plan, state).changes, 'tenancy_create')).toHaveLength(1);
  });

  it('does not treat tenancies of other properties as overlapping', () => {
    const state = baseState();
    state.tenancies = [{ ...existing, id: 9, propertyId: STREET_ID }];
    expect(changesOf(planChanges(basePlan(), state).changes, 'tenancy_create')).toHaveLength(1);
  });

  it('warns when updating an existing tenancy leaves it overlapping a neighbour', () => {
    const state = baseState();
    state.tenancies = [existing, { ...existing, id: 4, startDate: '2026-01-15', endDate: null }];
    const r = planChanges(basePlan(), state);
    expect(changesOf(r.changes, 'tenancy_update')).toHaveLength(1);
    expect(r.warnings.join('\n')).toContain('overlaps tenancy #4');
  });
});

describe('planChanges: owner tax profile', () => {
  const profile = (over: Record<string, string> = {}) => ({
    ownerId: 1,
    taxYear: '2025-26',
    values: {
      employmentIncome: '0.00',
      payeTaxPaid: '0.00',
      selfEmploymentIncome: '0.00',
      savingsInterest: '0.00',
      dividends: '0.00',
      otherIncome: '0.00',
      propertyLossesBroughtForward: '0.00',
      financeCostsBroughtForward: '0.00',
      ...over,
    },
    notes: null as string | null,
  });

  it('creates the row with only the included fields when none exists', () => {
    const r = planChanges(basePlan(), baseState());
    const p = changesOf(r.changes, 'tax_profile')[0];
    expect(p.existed).toBe(false);
    expect(p.set).toEqual({ employmentIncome: '30000.00' });
    expect(p.notes).toContain('--- plan:example-2025-26-v1 ---');
    expect(skipFor(r, 'example-dividends')?.reason).toBe('excluded');
  });

  it('updates only the fields that differ and leaves the others alone', () => {
    const state = baseState();
    state.taxProfile = profile({ employmentIncome: '25000.00', dividends: '500.00' });
    const r = planChanges(basePlan(), state);
    const p = changesOf(r.changes, 'tax_profile')[0];
    expect(p.set).toEqual({ employmentIncome: '30000.00' });
    expect(p.previous).toEqual({ employmentIncome: '25000.00' });
    expect('dividends' in p.set).toBe(false);
  });

  it('does nothing when the profile already matches, notes block included', () => {
    const state = baseState();
    state.taxProfile = {
      ...profile({ employmentIncome: '30000.00' }),
      notes: mergeNotesBlock(null, 'example-2025-26-v1', 'Open question: full-year dividends.'),
    };
    const r = planChanges(basePlan(), state);
    expect(changesOf(r.changes, 'tax_profile')).toHaveLength(0);
    expect(skipFor(r, 'example-employment-income')?.reason).toBe('unchanged');
    expect(skipFor(r, 'example-profile-notes')?.reason).toBe('unchanged');
  });

  it('warns when the merged notes would exceed the 2,000 character form limit', () => {
    const plan = basePlan(j => (((j.ownerTaxProfile as Json).notes.value) = 'x'.repeat(2100)));
    expect(planChanges(plan, baseState()).warnings.join('\n')).toContain('at most 2,000');
  });
});

describe('mergeNotesBlock', () => {
  it('appends below existing notes, keeping them', () => {
    const merged = mergeNotesBlock('My own note.', 'plan-a', 'Plan text');
    expect(merged.startsWith('My own note.\n\n--- plan:plan-a ---\nPlan text\n--- end plan:plan-a ---')).toBe(true);
  });

  it('replaces only its own block on a re-run, so the result is stable', () => {
    const once = mergeNotesBlock('My own note.', 'plan-a', 'Plan text');
    const twice = mergeNotesBlock(once, 'plan-a', 'Plan text');
    expect(twice).toBe(once);
    const edited = mergeNotesBlock(once, 'plan-a', 'New text');
    expect(edited).toContain('My own note.');
    expect(edited).toContain('New text');
    expect(edited).not.toContain('Plan text');
  });

  it('keeps separate blocks for separate plans', () => {
    const a = mergeNotesBlock(null, 'plan-a', 'A');
    const ab = mergeNotesBlock(a, 'plan-b', 'B');
    expect(ab).toContain('A');
    expect(ab).toContain('B');
  });
});

describe('DbState isolation', () => {
  it('planChanges does not mutate the state it is given', () => {
    const state: DbState = baseState();
    const snapshot = JSON.stringify(state);
    planChanges(basePlan(), state);
    expect(JSON.stringify(state)).toBe(snapshot);
  });
});

describe('planChanges: schema not migrated yet', () => {
  const pending = (over: Partial<NonNullable<DbState['pendingMigration']>> = {}): DbState => {
    const state = baseState();
    state.pendingMigration = { lettingType: true, taxProfile: true, ...over };
    return state;
  };

  it('reports the letting-type and profile items as pending migration, not as changes', () => {
    const r = planChanges(basePlan(), pending());
    expect(r.refusals).toEqual([]);
    expect(changesOf(r.changes, 'letting_type')).toHaveLength(0);
    expect(changesOf(r.changes, 'tax_profile')).toHaveLength(0);
    expect(skipFor(r, 'sample-letting-type')).toMatchObject({ reason: 'pending_migration' });
    expect(skipFor(r, 'sample-letting-type')!.detail).toContain('pending migration: would apply after `npm run db:migrate` or the next deploy');
    expect(skipFor(r, 'sample-letting-type')!.detail).toContain("Would set 'rent_a_room'");
    expect(skipFor(r, 'example-employment-income')).toMatchObject({ reason: 'pending_migration' });
    expect(skipFor(r, 'example-profile-notes')).toMatchObject({ reason: 'pending_migration' });
  });

  it('still plans everything else normally, identically to a migrated database', () => {
    const migrated = planChanges(basePlan(), baseState()).changes.filter(c => c.type !== 'letting_type' && c.type !== 'tax_profile');
    const r = planChanges(basePlan(), pending());
    expect(r.changes).toEqual(migrated);
    expect(r.changes.length).toBeGreaterThan(3);
    expect(r.blocked).toEqual([]);
  });

  it('items excluded in the plan stay "excluded", and the two pieces are independent', () => {
    const r = planChanges(basePlan(), pending({ taxProfile: false }));
    expect(skipFor(r, 'sample-letting-type')).toMatchObject({ reason: 'pending_migration' });
    expect(skipFor(r, 'example-dividends')).toMatchObject({ reason: 'excluded' });
    expect(changesOf(r.changes, 'tax_profile')).toHaveLength(1);
    const other = planChanges(basePlan(), pending({ lettingType: false }));
    expect(changesOf(other.changes, 'letting_type')).toHaveLength(1);
    expect(skipFor(other, 'example-dividends')).toMatchObject({ reason: 'excluded' });
    expect(skipFor(other, 'example-employment-income')).toMatchObject({ reason: 'pending_migration' });
  });

  it('the predicted totals are the same as for a migrated database: they do not depend on those items', () => {
    const totals = (state: DbState) => {
      const r = planChanges(basePlan(), state);
      return computeOwnerTotals({ ownerId: 1, taxYear: '2025-26', state: simulateChanges(state, r.changes) }).combined;
    };
    expect(totals(pending())).toEqual(totals(baseState()));
    expect(totals(pending()).mortgageInterest).not.toBe('0.00');
  });
});

describe('planChanges: tenancy update keeps the database text it was based on', () => {
  it('records each overwritten field exactly as read, for the optimistic write guard', () => {
    const state = baseState();
    state.tenancies = [{ id: 3, propertyId: ROAD_ID, tenantName: 'Pat Tenant', startDate: '2024-09-01', endDate: '2026-02-01', rentAmount: '1000.00', rentFrequency: 'monthly', depositAmount: '1000.00', notes: 'Example tenancy agreement ref 123.' }];
    const u = changesOf(planChanges(basePlan(), state).changes, 'tenancy_update')[0];
    expect(u.set).toEqual({ endDate: '2026-03-01' });
    expect(u.before).toEqual({ endDate: '2026-02-01' });
  });
});
