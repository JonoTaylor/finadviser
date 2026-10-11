import { emptyProfileValues } from './schema';
import type { Change, DbState, LedgerLine, TaxProfileRow, TenancyRow } from './types';

/**
 * Apply planned changes to an in-memory copy of the database state, so the
 * dry run can show the owner's "after" totals without writing anything.
 * The effects mirror the SQL in statements.ts one for one; the real apply
 * path double-checks the prediction against what the database then says.
 */
export function simulateChanges(state: DbState, changes: readonly Change[]): DbState {
  const next: DbState = {
    ...state,
    properties: state.properties.map(p => ({ ...p })),
    tenancies: state.tenancies.map(t => ({ ...t })),
    taggedLines: state.taggedLines.map(l => ({ ...l })),
    candidateLines: state.candidateLines.map(l => ({ ...l })),
    referencedJournals: state.referencedJournals.map(j => ({ ...j })),
    taxProfile: state.taxProfile
      ? { ...state.taxProfile, values: { ...state.taxProfile.values } }
      : null,
  };

  let tempId = -1;
  const accountById = new Map(state.accounts.map(a => [a.id, a]));

  for (const change of changes) {
    switch (change.type) {
      case 'letting_type': {
        const p = next.properties.find(x => x.id === change.propertyId);
        if (!p) throw new Error(`simulate: property ${change.propertyId} not found`);
        p.lettingType = change.to;
        break;
      }
      case 'tenancy_create': {
        const row: TenancyRow = {
          id: tempId--,
          propertyId: change.propertyId,
          tenantName: change.values.tenantName,
          startDate: change.values.startDate,
          endDate: change.values.endDate,
          rentAmount: change.values.rentAmount,
          rentFrequency: change.values.rentFrequency,
          depositAmount: change.values.depositAmount,
          notes: change.values.notes,
        };
        next.tenancies.push(row);
        break;
      }
      case 'tenancy_update': {
        const row = next.tenancies.find(t => t.id === change.tenancyId);
        if (!row) throw new Error(`simulate: tenancy ${change.tenancyId} not found`);
        Object.assign(row, change.set);
        break;
      }
      case 'journal_create': {
        const journalId = tempId--;
        for (const leg of change.legs) {
          const account = accountById.get(leg.accountId);
          if (!account) throw new Error(`simulate: account ${leg.accountId} not found`);
          if (account.accountType !== 'INCOME' && account.accountType !== 'EXPENSE') continue;
          const line: LedgerLine = {
            bookEntryId: tempId--,
            journalId,
            date: change.date,
            description: change.description,
            reference: change.reference,
            categoryId: change.categoryId,
            propertyId: change.propertyId,
            isTransfer: false,
            accountId: account.id,
            accountName: account.name,
            accountType: account.accountType,
            accountIsSystem: account.isSystem,
            amount: leg.amount,
          };
          next.taggedLines.push(line);
        }
        next.referencedJournals.push({
          journalId,
          reference: change.reference,
          date: change.date,
          description: change.description,
          propertyId: change.propertyId,
          amount: change.legs.find(l => {
            const a = accountById.get(l.accountId);
            return a && (a.accountType === 'INCOME' || a.accountType === 'EXPENSE');
          })?.amount ?? null,
          accountName: null,
        });
        break;
      }
      case 'journal_tag': {
        const moved: LedgerLine[] = [];
        next.candidateLines = next.candidateLines.filter(l => {
          if (l.journalId !== change.journalId) return true;
          moved.push({
            ...l,
            propertyId: change.propertyId,
            categoryId: l.categoryId ?? change.setCategoryId,
          });
          return false;
        });
        if (moved.length === 0) throw new Error(`simulate: journal ${change.journalId} not found among candidates`);
        next.taggedLines.push(...moved);
        break;
      }
      case 'tax_profile': {
        const base: TaxProfileRow = next.taxProfile ?? {
          ownerId: change.ownerId,
          taxYear: change.taxYear,
          values: emptyProfileValues(),
          notes: null,
        };
        Object.assign(base.values, change.set);
        if (change.notes !== null) base.notes = change.notes;
        next.taxProfile = base;
        break;
      }
    }
  }
  return next;
}
