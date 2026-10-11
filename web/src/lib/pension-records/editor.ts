import type { PensionRecord, PensionRecordType } from './schema';

export interface PensionRecordDraft {
  id: string;
  type: PensionRecordType;
  name: string;
  provider: string;
  ownerId: string;
  statementAsOf: string;
  notes: string;
  linkedAccountId: string;
  potAmount: string;
  personalMonthlyContribution: string;
  employerMonthlyContribution: string;
  annualFeeRate: string;
  promisedAnnualIncome: string;
  forecastAnnualIncome: string;
  forecastSourceDate: string;
  startAge: string;
}

export function pensionRecordDraft(record: PensionRecord | null, newId: string): PensionRecordDraft {
  const base: PensionRecordDraft = {
    id: record?.id ?? newId, type: record?.type ?? 'dc', name: record?.name ?? '', provider: record?.provider ?? '',
    ownerId: record?.ownerId?.toString() ?? '', statementAsOf: record?.statementAsOf ?? '', notes: record?.notes ?? '',
    linkedAccountId: '', potAmount: '', personalMonthlyContribution: '', employerMonthlyContribution: '', annualFeeRate: '',
    promisedAnnualIncome: '', forecastAnnualIncome: '', forecastSourceDate: '', startAge: '',
  };
  if (record?.type === 'dc') return {
    ...base, linkedAccountId: record.linkedAccountId?.toString() ?? '', potAmount: record.potAmount ?? '',
    personalMonthlyContribution: record.personalMonthlyContribution ?? '', employerMonthlyContribution: record.employerMonthlyContribution ?? '', annualFeeRate: record.annualFeeRate ?? '',
  };
  if (record?.type === 'db') return { ...base, promisedAnnualIncome: record.promisedAnnualIncome ?? '', startAge: record.startAge?.toString() ?? '' };
  if (record?.type === 'state') return { ...base, forecastAnnualIncome: record.forecastAnnualIncome ?? '', forecastSourceDate: record.forecastSourceDate ?? '', startAge: record.startAge?.toString() ?? '' };
  return base;
}

/** Blank fields remain unknown; explicit zero amounts and ages remain zero. */
export function pensionRecordFromDraft(draft: PensionRecordDraft): unknown {
  const blank = (value: string) => value.trim() === '' ? null : value.trim();
  const numeric = (value: string) => value.trim() === '' ? null : Number(value);
  const common = {
    id: draft.id, type: draft.type, name: draft.name, provider: blank(draft.provider),
    ownerId: numeric(draft.ownerId), statementAsOf: blank(draft.statementAsOf), notes: blank(draft.notes),
  };
  if (draft.type === 'dc') return {
    ...common, linkedAccountId: numeric(draft.linkedAccountId),
    potAmount: draft.linkedAccountId ? null : blank(draft.potAmount),
    personalMonthlyContribution: blank(draft.personalMonthlyContribution), employerMonthlyContribution: blank(draft.employerMonthlyContribution), annualFeeRate: blank(draft.annualFeeRate),
  };
  if (draft.type === 'db') return { ...common, promisedAnnualIncome: blank(draft.promisedAnnualIncome), startAge: numeric(draft.startAge) };
  return { ...common, forecastAnnualIncome: blank(draft.forecastAnnualIncome), forecastSourceDate: blank(draft.forecastSourceDate), startAge: numeric(draft.startAge) };
}
