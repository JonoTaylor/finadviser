import Decimal from 'decimal.js';
import { z } from 'zod';
import { accountRepo, propertyRepo } from '@/lib/repos';
import { londonTodayIso } from '@/lib/dates/today';
import { readWorkspace, writeWorkspace } from '@/lib/finance-workspace/store';
import { debtWorkspaceSchema, type DebtWorkspaceData, type DebtWorkspaceResponse, type LiabilityChoice } from './types';

export const DEBT_WORKSPACE_KEY = 'finance.debts.v1';

async function loadChoices(asOf: string) {
  const [accounts, balances, owners] = await Promise.all([
    accountRepo.listByType('LIABILITY'), accountRepo.getBalances(asOf), propertyRepo.listOwners(),
  ]);
  const byId = new Map(balances.map(balance => [balance.account_id, balance.balance]));
  if (accounts.some(account => !byId.has(account.id))) throw new Error('A current liability balance is unavailable');
  return {
    accounts: accounts.map(account => ({ id: account.id, name: account.name, ownerId: account.ownerId, balance: byId.get(account.id)! })) satisfies LiabilityChoice[],
    owners: owners.map(owner => ({ id: owner.id, name: owner.name })),
  };
}

function resolveWorkspace(workspace: DebtWorkspaceResponse['workspace'], choices: Awaited<ReturnType<typeof loadChoices>>, asOf: string): DebtWorkspaceResponse {
  const accounts = new Map(choices.accounts.map(account => [account.id, account]));
  return {
    workspace, ...choices, asOf,
    debts: workspace.data.debts.map(debt => {
      const account = debt.accountId === null ? null : accounts.get(debt.accountId);
      if (debt.accountId !== null && !account) return { ...debt, effectiveBalance: null, balanceAsOf: null, balanceSource: 'unavailable', accountName: null, sourceWarning: 'Linked liability account is unavailable. Review the link.' };
      if (!account && debt.statementAsOf !== null && debt.statementAsOf > asOf) return { ...debt, effectiveBalance: null, balanceAsOf: debt.statementAsOf, balanceSource: 'unavailable', accountName: null, sourceWarning: 'Statement date is in the future. Review the balance before planning.' };
      const balance = account ? Decimal.max(0, new Decimal(account.balance).negated()).toFixed(2) : debt.statementBalance;
      return {
        ...debt, ownerId: account ? account.ownerId : debt.ownerId, effectiveBalance: balance,
        balanceAsOf: account ? asOf : debt.statementAsOf, balanceSource: account ? 'ledger' : 'statement',
        accountName: account?.name ?? null,
        sourceWarning: account && new Decimal(account.balance).gt(0) ? 'The liability ledger is in credit; no amount owed is projected.' : null,
      };
    }),
  };
}

export async function loadDebtWorkspace(): Promise<DebtWorkspaceResponse> {
  const asOf = londonTodayIso();
  const [workspace, choices] = await Promise.all([
    readWorkspace(DEBT_WORKSPACE_KEY, debtWorkspaceSchema, { debts: [] }), loadChoices(asOf),
  ]);
  return resolveWorkspace(workspace, choices, asOf);
}

export async function saveDebtWorkspace(data: unknown, expectedRevision: number): Promise<DebtWorkspaceResponse> {
  const parsed: DebtWorkspaceData = debtWorkspaceSchema.parse(data);
  const asOf = londonTodayIso();
  const choices = await loadChoices(asOf);
  const owners = new Set(choices.owners.map(owner => owner.id));
  const accounts = new Map(choices.accounts.map(account => [account.id, account]));
  const issues: z.core.$ZodIssue[] = [];
  parsed.debts.forEach((debt, index) => {
    if (debt.ownerId !== null && !owners.has(debt.ownerId)) issues.push({ code: 'custom', path: ['debts', index, 'ownerId'], message: 'Choose an existing owner' });
    if (debt.statementAsOf !== null && debt.statementAsOf > asOf) issues.push({ code: 'custom', path: ['debts', index, 'statementAsOf'], message: 'A statement date cannot be in the future' });
    if (debt.accountId !== null) {
      const account = accounts.get(debt.accountId);
      if (!account) issues.push({ code: 'custom', path: ['debts', index, 'accountId'], message: 'Choose an existing liability account' });
      else if (debt.ownerId !== null && debt.ownerId !== account.ownerId) issues.push({ code: 'custom', path: ['debts', index, 'ownerId'], message: 'Linked debt ownership must match the liability account; update ownership in account settings' });
    }
  });
  if (issues.length) throw new z.ZodError(issues);
  const workspace = await writeWorkspace(DEBT_WORKSPACE_KEY, debtWorkspaceSchema, parsed, expectedRevision);
  return resolveWorkspace(workspace, choices, asOf);
}
