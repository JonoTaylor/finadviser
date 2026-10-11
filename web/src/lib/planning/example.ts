import type { PlanningInput, PlanningTransaction } from './types';
import { londonTodayIso } from '@/lib/dates/today';

/** Fictional, opt-in illustration. Never written to the user's ledger. */
export function examplePlanningInput(asOf = londonTodayIso()): PlanningInput {
  const anchor = new Date(`${asOf.slice(0, 7)}-01T12:00:00Z`);
  const transactions: PlanningTransaction[] = [];
  let id = 0;
  for (let offset = 6; offset >= 1; offset--) {
    const month = new Date(Date.UTC(anchor.getUTCFullYear(), anchor.getUTCMonth() - offset, 1)).toISOString().slice(0, 7);
    const recent = offset <= 3;
    const add = (day: string, description: string, category: string, amount: number, propertyId?: number) => transactions.push({
      id: ++id, date: `${month}-${day}`, description, merchant: description, category, amount,
      cashflowType: amount >= 0 ? 'income' : 'expense', propertyId,
    });
    add('01', 'Salary', 'Employment income', 4200);
    add('02', 'Home costs', 'Housing', -1250);
    add('05', 'Fresh food market', 'Groceries', recent ? -460 : -380);
    add('07', 'Local restaurants', 'Eating out', recent ? -240 : -150);
    add('09', 'Transport', 'Transport', -160);
    add('12', 'Home energy', 'Utilities', -140);
    add('14', 'Film club', 'Entertainment', -18);
    add('18', 'Weekend shopping', 'Shopping', recent ? -290 : -160);
    add('20', 'Rental income', 'Rent', 1450, 1);
    add('22', 'Property running costs', 'Property expenses', -360, 1);
    add('25', 'Mortgage interest', 'Mortgage interest', -680, 1);
  }
  return {
    asOf, transactions,
    accounts: [
      { id: 1, name: 'Current account', balance: 2600, accountType: 'ASSET', isLiquidCash: true },
      { id: 2, name: 'Emergency savings', balance: 4200, accountType: 'ASSET', isInvestment: true, investmentKind: 'savings', isLiquidCash: true },
      { id: 3, name: 'Long-term ISA', balance: 32000, accountType: 'ASSET', isInvestment: true, investmentKind: 'isa' },
      { id: 4, name: 'Workplace pension', balance: 68000, accountType: 'ASSET', isInvestment: true, investmentKind: 'pension' },
      { id: 5, name: 'Credit card', balance: -2400, accountType: 'LIABILITY' },
    ],
    properties: [{ id: 1, name: 'Example rental property', value: 320000, debt: 205000, monthlyRent: 1450, monthlyCosts: 1040 }],
    budgets: [{ category: 'Eating out', monthlyLimit: 180 }, { category: 'Shopping', monthlyLimit: 200 }],
    profile: { essentialMonthlySpending: 2300, emergencyFundMonths: 6, monthlySavingsTarget: 1000, investmentHorizonYears: 15, riskTolerance: 'medium' },
  };
}
