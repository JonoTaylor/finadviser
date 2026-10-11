import { readWorkspace } from '@/lib/finance-workspace/store';
import { contextSchema, defaultContext } from './schema';

export * from './schema';
export const FINANCIAL_CONTEXT_KEY = 'finance.context.v1';

export function loadFinancialContext() {
  return readWorkspace(FINANCIAL_CONTEXT_KEY, contextSchema, defaultContext);
}
