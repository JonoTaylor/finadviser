import type { OwnerTaxComputation } from './ownerTaxComputation';

function csvEscape(value: string | number | null | undefined): string {
  const s = value == null ? '' : String(value);
  return `"${s.replace(/"/g, '""')}"`;
}

function csvRow(cells: Array<string | number | null | undefined>): string {
  return cells.map(csvEscape).join(',');
}

const RENT_A_ROOM_TREATMENT_LABEL = {
  exempt: 'Exempt (within the limit)',
  alternative: 'Alternative method (receipts less limit)',
  normal: 'Normal method (receipts less expenses)',
} as const;

/** Repository readiness is optional so pure-engine exports remain compatible. */
interface TaxExportReadiness {
  profileGaps?: string[];
  estimateOnly?: boolean;
  profileComplete?: boolean;
  payeTaxPaidKnown?: boolean;
  estimatedBalancePayable?: string | null;
}

/**
 * One CSV with three parts, all in Section / Line / Amount columns: the
 * headline figures, any warnings, then every step of the working so the
 * accountant can follow the number from the receipts to the bill.
 */
export function taxComputationCsv(c: OwnerTaxComputation & { owner: { name: string } } & TaxExportReadiness): string {
  const header = csvRow(['Section', 'Line', 'Amount']);
  const sa = c.selfAssessment;
  const hasReadiness = c.estimateOnly !== undefined || c.profileComplete !== undefined
    || c.estimatedBalancePayable !== undefined || c.payeTaxPaidKnown !== undefined || c.profileGaps !== undefined;
  const payeKnown = !hasReadiness || c.payeTaxPaidKnown === true;
  const settlementKnown = !hasReadiness || (payeKnown && c.profileComplete === true && c.estimateOnly === false
    && (c.profileGaps?.length ?? 0) === 0 && typeof c.estimatedBalancePayable === 'string');
  const scenario = hasReadiness && !settlementKnown;
  const figureLabel = (label: string) => scenario ? `${label} (scenario)` : label;
  const summary: Array<[string, string, string]> = [
    ['Summary', 'Owner', c.owner.name],
    ['Summary', 'Tax year', c.taxYear],
    ...(hasReadiness ? [[
      'Summary', 'Calculation status',
      scenario
        ? `Illustrative scenario: ${c.profileComplete === false ? 'incomplete tax profile' : 'estimated or unconfirmed inputs'}. Amounts are not confirmed for filing or payment.`
        : 'Estimate from saved profile inputs. Check recorded property amounts for completeness before filing or paying.',
    ] as [string, string, string]] : []),
    ['Summary', `Rates used${c.rates.assumed ? ' (assumed)' : ''}${c.rates.provisional ? ' (provisional)' : ''}`, c.rates.taxYear],
    ['Summary', 'Property method', c.property.method === 'allowance' ? 'Property allowance' : 'Actual expenses'],
    ...(c.property.rentARoomPool
      ? ([
          ['Summary', 'Rent-a-room treatment', RENT_A_ROOM_TREATMENT_LABEL[c.property.rentARoomPool.treatment]],
          ['Summary', `Rent-a-room pooled receipts (limit ${c.property.rentARoomPool.limit}${c.property.rentARoomPool.shared ? ', shared' : ''})`, c.property.rentARoomPool.receipts],
          ['Summary', 'Rent-a-room effect on property business', c.property.rentARoomPool.taxable],
        ] as Array<[string, string, string]>)
      : []),
    ['Summary', figureLabel('Taxable UK property profit'), c.property.taxableProfit],
    ['Summary', figureLabel('Property losses carried forward'), c.property.lossesCarriedForward],
    ['Summary', figureLabel('S.24 finance-cost tax reducer'), c.financeCosts.reducer],
    ['Summary', figureLabel('S.24 finance costs carried forward'), c.financeCosts.carriedForward],
    ['Summary', figureLabel('Total income'), c.income.total],
    ...(c.income.adjustedNetIncome ? [['Summary', figureLabel('Adjusted net income'), c.income.adjustedNetIncome] as [string, string, string]] : []),
    ['Summary', figureLabel('Income tax before reductions'), c.incomeTax.taxBeforeReductions],
    ['Summary', figureLabel('Income tax liability'), c.incomeTax.liability],
    ['Summary', figureLabel('Tax attributable to rental income'), c.taxOnRentalIncome.amount],
    ['Summary', payeKnown ? 'Tax already paid through PAYE' : 'Tax already paid through PAYE — unknown', payeKnown ? sa.payeTaxPaid : ''],
    ...(settlementKnown ? [
      ['Summary', sa.isRefund ? 'Overpaid (repayment due)' : `Balance due through Self Assessment by ${sa.deadline}`, sa.balanceDue] as [string, string, string],
      ...sa.paymentsOnAccount.instalments.map((i, n): [string, string, string] => [
        'Summary', `Payment on account ${n + 1} due ${i.dueDate}`, i.amount,
      ]),
    ] : [
      ['Summary', 'Self Assessment balance — unknown: incomplete or estimated profile', ''] as [string, string, string],
      ['Summary', 'Payments on account — unknown: incomplete or estimated profile', ''] as [string, string, string],
    ]),
    ['Summary', 'MTD ITSA qualifying income', c.mtd.qualifyingIncome],
  ];
  const rows = [
    ...summary.map(([section, line, amount]) => csvRow([section, line, amount])),
    ...(c.profileGaps ?? []).map(gap => csvRow(['Profile gaps', gap, ''])),
    ...c.warnings.map(w => csvRow(['Warnings', scenario ? `Scenario warning: ${w}` : w, ''])),
    ...c.breakdown
      // Zero placeholders must not reappear as PAYE paid or as a payment
      // instruction in the detailed working after being hidden above.
      .filter(l => settlementKnown || l.section !== 'Self Assessment')
      .filter(l => payeKnown || !(l.section === 'Inputs' && l.text.startsWith('Tax already paid through PAYE ')))
      .map(l => csvRow([scenario ? `${l.section} (scenario)` : l.section, l.text, l.amount ?? ''])),
    csvRow(['Disclaimer', c.disclaimer, '']),
  ];
  return [header, ...rows].join('\n');
}
