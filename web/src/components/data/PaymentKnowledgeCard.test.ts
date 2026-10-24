import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { PayeeMemory } from '@/lib/categorization/payees/types';
import { SavedPaymentMeaning } from './PaymentKnowledgeCard';
import { paymentScopeLabel, samePayeeScope } from './RememberPayeeDialog';

const memory: PayeeMemory = {
  id: '543508bc-71bc-428b-8e0e-f405a64b4983', revision: 1, status: 'active',
  scope: { accountId: 2, accountName: 'Household account', accountType: 'ASSET', ownerId: 1, direction: -1, currency: 'GBP', propertyId: null },
  payeeName: 'Sylvia', purpose: 'Household cleaner', categoryId: 7, categoryName: 'Cleaning', identityKind: 'bank_payee', aliases: ['Sylvia', 'Sylvia Cleaning'],
  sourceJournalId: 12, createdAt: '2026-10-24T18:00:00.000Z', updatedAt: '2026-10-24T18:00:00.000Z',
};
const render = (value: PayeeMemory) => renderToString(createElement(SavedPaymentMeaning, { memory: value, onEdit: () => {}, onDisable: () => {} })).replace(/<!-- -->/g, '');

describe('private payment meaning presentation', () => {
  it('shows confirmed purpose, category and scoped bank identity without a global merchant rule claim', () => {
    const html = render(memory);
    for (const text of ['Sylvia', 'Household cleaner', 'Cleaning', 'Household account', 'outgoing payments', 'Confirmed bank payee names', 'Sylvia Cleaning', 'Remembered', 'Stop reusing']) expect(html).toContain(text);
    expect(html).not.toContain('all accounts');
    expect(html).not.toContain('contains rule');
  });
  it('keeps disabled and conflicted meanings distinct from an active match', () => {
    const disabled = render({ ...memory, status: 'disabled' });
    expect(disabled).toContain('Disabled');
    expect(disabled).not.toContain('Stop reusing');
    const conflicted = render({ ...memory, status: 'conflicted' });
    expect(conflicted).toContain('Needs reconfirming');
    expect(conflicted).toContain('Automatic reuse is paused');
  });
  it('does not offer an edit through a missing source payment', () => {
    const html = render({ ...memory, sourceJournalId: null });
    expect(html).toContain('disabled');
  });
});

describe('editing a payment meaning keeps its saved scope', () => {
  it('distinguishes account, owner, direction, property and currency changes', () => {
    expect(samePayeeScope(memory.scope, { ...memory.scope })).toBe(true);
    for (const change of [{ accountId: 3 }, { ownerId: 2 }, { direction: 1 as const }, { propertyId: 9 }, { currency: 'EUR' }, { accountType: 'LIABILITY' as const }]) {
      expect(samePayeeScope(memory.scope, { ...memory.scope, ...change })).toBe(false);
    }
    expect(paymentScopeLabel(memory.scope)).toContain('not linked to a property');
  });
});
