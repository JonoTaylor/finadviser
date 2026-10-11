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

/**
 * One CSV with three parts, all in Section / Line / Amount columns: the
 * headline figures, any warnings, then every step of the working so the
 * accountant can follow the number from the receipts to the bill.
 */
export function taxComputationCsv(c: OwnerTaxComputation & { owner: { name: string } }): string {
  const header = csvRow(['Section', 'Line', 'Amount']);
  const sa = c.selfAssessment;
  const summary: Array<[string, string, string]> = [
    ['Summary', 'Owner', c.owner.name],
    ['Summary', 'Tax year', c.taxYear],
    ['Summary', `Rates used${c.rates.assumed ? ' (assumed)' : ''}${c.rates.provisional ? ' (provisional)' : ''}`, c.rates.taxYear],
    ['Summary', 'Property method', c.property.method === 'allowance' ? 'Property allowance' : 'Actual expenses'],
    ...(c.property.rentARoomPool
      ? ([
          ['Summary', 'Rent-a-room treatment', RENT_A_ROOM_TREATMENT_LABEL[c.property.rentARoomPool.treatment]],
          ['Summary', `Rent-a-room pooled receipts (limit ${c.property.rentARoomPool.limit}${c.property.rentARoomPool.shared ? ', shared' : ''})`, c.property.rentARoomPool.receipts],
          ['Summary', 'Rent-a-room effect on property business', c.property.rentARoomPool.taxable],
        ] as Array<[string, string, string]>)
      : []),
    ['Summary', 'Taxable UK property profit', c.property.taxableProfit],
    ['Summary', 'Property losses carried forward', c.property.lossesCarriedForward],
    ['Summary', 'S.24 finance-cost tax reducer', c.financeCosts.reducer],
    ['Summary', 'S.24 finance costs carried forward', c.financeCosts.carriedForward],
    ['Summary', 'Total income', c.income.total],
    ['Summary', 'Income tax before reductions', c.incomeTax.taxBeforeReductions],
    ['Summary', 'Income tax liability', c.incomeTax.liability],
    ['Summary', 'Tax attributable to rental income', c.taxOnRentalIncome.amount],
    ['Summary', 'Tax already paid through PAYE', sa.payeTaxPaid],
    ['Summary', sa.isRefund ? 'Overpaid (repayment due)' : `Balance due through Self Assessment by ${sa.deadline}`, sa.balanceDue],
    ...sa.paymentsOnAccount.instalments.map((i, n): [string, string, string] => [
      'Summary', `Payment on account ${n + 1} due ${i.dueDate}`, i.amount,
    ]),
    ['Summary', 'MTD ITSA qualifying income', c.mtd.qualifyingIncome],
  ];
  const rows = [
    ...summary.map(([section, line, amount]) => csvRow([section, line, amount])),
    ...c.warnings.map(w => csvRow(['Warnings', w, ''])),
    ...c.breakdown.map(l => csvRow([l.section, l.text, l.amount ?? ''])),
    csvRow(['Disclaimer', c.disclaimer, '']),
  ];
  return [header, ...rows].join('\n');
}
