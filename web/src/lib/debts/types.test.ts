import { describe, expect, it } from 'vitest';
import { debtPutSchema, debtRecordSchema, debtWorkspaceSchema } from './types';

const debt = {
  id: 'bd737711-7f63-4e66-9d1b-00c94078801a', name: 'Card', accountId: null, ownerId: null,
  statementBalance: '1200', statementAsOf: '2026-10-11', apr: '19.9', minimumPayment: '35',
  priority: false, inArrears: false, promotionalApr: null, promotionalExpiresOn: null,
  paymentRestrictions: '', feeNotes: '',
};

describe('debt inventory validation', () => {
  it('preserves unknown rates and minimums and normalises money', () => {
    expect(debtRecordSchema.parse({ ...debt, apr: null, minimumPayment: null })).toMatchObject({ statementBalance: '1200.00', apr: null, minimumPayment: null });
  });
  it.each(['NaN', '-1', '2.345', '1e4', '1000000000000', 'Infinity'])('rejects invalid balance %s without throwing outside Zod', amount => {
    expect(debtRecordSchema.safeParse({ ...debt, statementBalance: amount }).success).toBe(false);
  });
  it.each(['-2', 'Infinity', '1e2', '1001', '2.12345'])('rejects invalid rate %s', apr => {
    expect(debtRecordSchema.safeParse({ ...debt, apr }).success).toBe(false);
  });
  it('rejects invalid calendar dates and a one-sided promotional rate', () => {
    expect(debtRecordSchema.safeParse({ ...debt, statementAsOf: '2026-02-30' }).success).toBe(false);
    expect(debtRecordSchema.safeParse({ ...debt, promotionalApr: '0' }).success).toBe(false);
  });
  it('requires the ledger to be the only linked balance source', () => {
    expect(debtRecordSchema.safeParse({ ...debt, accountId: 3 }).success).toBe(false);
    expect(debtRecordSchema.safeParse({ ...debt, accountId: 3, statementBalance: null, statementAsOf: null }).success).toBe(true);
  });
  it('rejects duplicate inventory IDs and duplicate liability links', () => {
    expect(debtWorkspaceSchema.safeParse({ debts: [debt, debt] }).success).toBe(false);
    const linked = { ...debt, accountId: 3, statementBalance: null, statementAsOf: null };
    expect(debtWorkspaceSchema.safeParse({ debts: [linked, { ...linked, id: 'd3fa92cd-4d57-4194-8218-dc93ac995cd4' }] }).success).toBe(false);
  });
  it('requires an explicit revision and rejects unknown write fields', () => {
    expect(debtPutSchema.safeParse({ data: { debts: [debt] }, revision: 0 }).success).toBe(true);
    expect(debtPutSchema.safeParse({ data: { debts: [debt] } }).success).toBe(false);
    expect(debtPutSchema.safeParse({ data: { debts: [debt] }, revision: 0, replace: true }).success).toBe(false);
  });
});
