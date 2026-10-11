import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parsePlan, type Plan } from './schema';
import type { DbState, LedgerLine } from './types';

/**
 * Made-up fixtures for the data-plan unit tests. Nothing here is real
 * personal data: the people, properties, lenders and figures are fictional.
 */

export const EXAMPLE_PLAN_PATH = join(process.cwd(), 'scripts', 'data-plan.example.json');

export function exampleJson(): Record<string, unknown> {
  return JSON.parse(readFileSync(EXAMPLE_PLAN_PATH, 'utf-8')) as Record<string, unknown>;
}

/** The example plan with its account aliases pointed at accounts that exist in baseState(). */
export function basePlan(mutate?: (json: Record<string, unknown>) => void): Plan {
  const json = exampleJson();
  json.accounts = {
    ownerBank: 'Example Current Account',
    mortgageBank: 'Example Current Account',
    lettingIncome: 'Uncategorized Income',
  };
  mutate?.(json);
  return parsePlan(json);
}

/** Loosely typed JSON for tests that poke at plan documents by path. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Json = Record<string, any>;

export const OWNER_ID = 1;
export const ROAD_ID = 10; // '1 Example Road'
export const STREET_ID = 20; // '2 Sample Street'

export function baseState(): DbState {
  return {
    owners: [
      { id: 1, name: 'Alex Example' },
      { id: 2, name: 'Sam Sample' },
    ],
    properties: [
      { id: ROAD_ID, name: '1 Example Road', lettingType: 'standard' },
      { id: STREET_ID, name: '2 Sample Street', lettingType: 'standard' },
    ],
    ownership: [
      { propertyId: ROAD_ID, ownerId: 1, ownerName: 'Alex Example', capitalAccount: 'Capital - Alex' },
      { propertyId: ROAD_ID, ownerId: 2, ownerName: 'Sam Sample', capitalAccount: 'Capital - Sam' },
      { propertyId: STREET_ID, ownerId: 1, ownerName: 'Alex Example', capitalAccount: 'Capital - Alex 2' },
      { propertyId: STREET_ID, ownerId: 2, ownerName: 'Sam Sample', capitalAccount: 'Capital - Sam 2' },
    ],
    allocationRules: [
      { propertyId: STREET_ID, ownerId: 1, allocationPct: '60.0000', expenseType: 'all' },
      { propertyId: STREET_ID, ownerId: 2, allocationPct: '40.0000', expenseType: 'all' },
    ],
    tenancies: [],
    mortgages: [{ id: 1, propertyId: ROAD_ID, lender: 'Example Building Society', interestOnly: true }],
    accounts: [
      { id: 100, name: 'Example Current Account', accountType: 'ASSET', isSystem: false, ownerId: 1 },
      { id: 101, name: 'Spare Savings', accountType: 'ASSET', isSystem: false, ownerId: 2 },
      { id: 102, name: 'Mortgage Interest', accountType: 'EXPENSE', isSystem: true, ownerId: null },
      { id: 103, name: 'Property Expenses', accountType: 'EXPENSE', isSystem: true, ownerId: null },
      { id: 104, name: 'Uncategorized Expense', accountType: 'EXPENSE', isSystem: true, ownerId: null },
      { id: 105, name: 'Uncategorized Income', accountType: 'INCOME', isSystem: true, ownerId: null },
      { id: 106, name: 'Example Credit Card', accountType: 'LIABILITY', isSystem: false, ownerId: 1 },
    ],
    categories: [
      { id: 1, name: 'Property expenses', parentId: null },
      { id: 2, name: 'Property insurance', parentId: 1 },
      { id: 3, name: 'Repairs & maintenance', parentId: 1 },
      { id: 4, name: 'Letting agent fees', parentId: 1 },
      { id: 5, name: 'Income', parentId: null },
      { id: 6, name: 'Shopping', parentId: null },
    ],
    taggedLines: [],
    candidateLines: [],
    referencedJournals: [],
    taxProfile: null,
  };
}

let nextId = 9000;

/** A ledger line on the INCOME/EXPENSE side of a journal. */
export function line(partial: Partial<LedgerLine> & Pick<LedgerLine, 'date' | 'amount' | 'accountName' | 'accountType'>): LedgerLine {
  const id = nextId++;
  return {
    bookEntryId: id,
    journalId: id,
    description: 'existing entry',
    reference: null,
    categoryId: null,
    propertyId: null,
    isTransfer: false,
    accountId: partial.accountType === 'INCOME' ? 105 : 104,
    accountIsSystem: true,
    ...partial,
  };
}
