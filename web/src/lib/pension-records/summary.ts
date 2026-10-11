import Decimal from 'decimal.js';
import type { PensionAccount, PensionRecord } from './schema';

export interface PensionAmountSummary {
  /** Sum of known amounts only. Null means that no amount was recorded. */
  knownTotal: string | null;
  knownCount: number;
  unknownCount: number;
  complete: boolean;
}

function amounts(values: (string | null)[]): PensionAmountSummary {
  const known = values.filter((value): value is string => value !== null);
  return {
    knownTotal: known.length ? known.reduce((sum, value) => sum.plus(value), new Decimal(0)).toFixed(2) : null,
    knownCount: known.length,
    unknownCount: values.length - known.length,
    complete: values.length > 0 && known.length === values.length,
  };
}

export function pensionRecordOwnerId(record: PensionRecord, accounts: PensionAccount[]): number | null {
  if (record.type !== 'dc' || record.linkedAccountId === null) return record.ownerId;
  // A linked ledger's ownership remains authoritative if it changes later.
  return accounts.find(account => account.id === record.linkedAccountId)?.ownerId ?? null;
}

export function pensionRecordPot(record: PensionRecord, accounts: PensionAccount[]): string | null {
  if (record.type !== 'dc') return null;
  if (record.linkedAccountId === null) return record.potAmount;
  return accounts.find(account => account.id === record.linkedAccountId)?.balance ?? null;
}

/** Keep pots and promised incomes separate; this inventory never adds net worth. */
export function summarizePensionRecords(records: PensionRecord[], accounts: PensionAccount[], selectedOwnerId: number | null = null) {
  const unknownOwnership = records.filter(record => pensionRecordOwnerId(record, accounts) === null).length;
  const selected = selectedOwnerId === null ? records : records.filter(record => pensionRecordOwnerId(record, accounts) === selectedOwnerId);
  const dc = selected.filter(record => record.type === 'dc');
  const db = selected.filter(record => record.type === 'db');
  const state = selected.filter(record => record.type === 'state');
  const warnings: string[] = [];
  const missingLinks = selected.filter(record => record.type === 'dc' && record.linkedAccountId !== null && !accounts.some(account => account.id === record.linkedAccountId));
  if (missingLinks.length) warnings.push(`${missingLinks.length} linked ledger pension account(s) are unavailable; their pot values and ownership are unknown.`);
  if (selected.some(record => record.type === 'dc' && new Decimal(pensionRecordPot(record, accounts) ?? '0').lt(0))) warnings.push('A linked pension ledger has a negative balance. Check its entries before using it in a retirement scenario.');
  if (selected.some(record => record.type === 'state' && record.forecastAnnualIncome !== null && record.forecastSourceDate === null)) warnings.push('An entered State Pension forecast has no source date. Check the official forecast and record its date and qualifying-year conditions.');
  if (selected.some(record => record.type === 'dc' && record.linkedAccountId === null && record.potAmount !== null && record.statementAsOf === null)) warnings.push('A statement-only DC pot has no statement date. Its value may be out of date.');
  if (unknownOwnership) warnings.push(selectedOwnerId === null
    ? `${unknownOwnership} scheme(s) have unknown ownership. Household figures include them; assign an owner before using a personal total.`
    : `${unknownOwnership} scheme(s) with unknown ownership are excluded from this person's figures.`);
  return {
    scope: selectedOwnerId === null ? 'household' as const : 'owner' as const,
    selectedOwnerId,
    recordCount: selected.length,
    unknownOwnershipCount: unknownOwnership,
    excludedForMissingOwnership: selectedOwnerId === null ? 0 : unknownOwnership,
    dc: {
      recordCount: dc.length,
      linkedAccountCount: dc.filter(record => record.linkedAccountId !== null).length,
      pot: amounts(dc.map(record => pensionRecordPot(record, accounts))),
      personalMonthlyContributions: amounts(dc.map(record => record.personalMonthlyContribution)),
      employerMonthlyContributions: amounts(dc.map(record => record.employerMonthlyContribution)),
      // A combined amount needs both components for each scheme: unknown is not zero.
      totalMonthlyContributions: amounts(dc.map(record => record.personalMonthlyContribution !== null && record.employerMonthlyContribution !== null
        ? new Decimal(record.personalMonthlyContribution).plus(record.employerMonthlyContribution).toFixed(2)
        : null)),
    },
    db: { recordCount: db.length, annualIncome: amounts(db.map(record => record.promisedAnnualIncome)) },
    state: { recordCount: state.length, annualForecast: amounts(state.map(record => record.forecastAnnualIncome)) },
    warnings,
    methodology: 'Defined contribution pots, defined benefit promised annual incomes and official State Pension forecast annual incomes are separate recorded figures. Unknown amounts remain unknown. Linked DC pots use current ledger balances. Statement-only pots and scheme incomes are descriptive records, never extra net worth. Gross monthly contributions are recorded amounts credited to the pot, with no assumed tax relief or employer match. Start ages and income conditions come from your records. Recorded annual income figures are not inflation-adjusted or guaranteed to start together; no statutory age is inferred.',
  };
}

export type PensionRecordsSummary = ReturnType<typeof summarizePensionRecords>;
