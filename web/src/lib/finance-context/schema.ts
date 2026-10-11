import { z } from 'zod';

const calendarDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use a date in YYYY-MM-DD format').refine(value => {
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}, 'Choose a valid calendar date');

export const financePriorities = ['spending', 'wealth', 'property', 'pensions'] as const;
export const contextSchema = z.object({
  preferredName: z.string().trim().min(1, 'Enter the name you want to use').max(80).default('Jono'),
  ownerId: z.number().int().positive().nullable().default(null),
  taxResidence: z.enum(['england', 'wales', 'scotland', 'northern_ireland']).nullable().default(null),
  dependants: z.number().int().min(0).max(20).nullable().default(null),
  employmentStability: z.enum(['stable', 'variable', 'not_working']).nullable().default(null),
  priorities: z.array(z.enum(financePriorities)).min(1, 'Choose at least one priority').max(financePriorities.length).default([...financePriorities]),
  nextReviewDate: calendarDate.nullable().default(null),
  accountAccessibility: z.array(z.object({
    accountId: z.number().int().positive(),
    accessibility: z.enum(['available', 'restricted', 'excluded']),
  }).strict()).max(500).default([]),
}).strict().superRefine((context, ctx) => {
  if (new Set(context.priorities).size !== context.priorities.length) {
    ctx.addIssue({ code: 'custom', path: ['priorities'], message: 'Each priority can be selected once' });
  }
  const seen = new Set<number>();
  for (const [index, override] of context.accountAccessibility.entries()) {
    if (seen.has(override.accountId)) ctx.addIssue({ code: 'custom', path: ['accountAccessibility', index, 'accountId'], message: 'Each account can have one accessibility setting' });
    seen.add(override.accountId);
  }
});

export type FinancialContext = z.infer<typeof contextSchema>;
export const defaultContext: FinancialContext = contextSchema.parse({});
export const contextWriteSchema = z.object({ data: contextSchema, revision: z.number().int().min(0).max(999_999_999) }).strict();

export interface AccessibilityAccount {
  id: number;
  name: string;
  accountType: string;
  isInvestment: boolean;
  investmentKind: string | null;
  isPropertyAsset?: boolean;
}

/** Assets that must never be treated as an accessible emergency reserve. */
export function cashExclusionReason(account: AccessibilityAccount): string | null {
  if (account.accountType !== 'ASSET') return 'Only cash assets can be included in an emergency reserve';
  if (account.isPropertyAsset) return 'Property equity is not accessible cash';
  if (account.investmentKind === 'pension' || /\bpension\b/i.test(account.name)) return 'Pensions are not accessible emergency cash';
  if (account.investmentKind !== null && account.investmentKind !== 'savings') return 'Market investments are not accessible emergency cash';
  if (account.isInvestment && account.investmentKind !== 'savings') return 'Market investments are not accessible emergency cash';
  if (!account.isInvestment && /\b(crypto|shares|stocks|investment|investments)\b|s\s*&\s*s\s*isa/i.test(account.name)) return 'Review this market investment classification before treating it as cash';
  return null;
}

export function resolveCashAccessibility(account: AccessibilityAccount, context: Pick<FinancialContext, 'accountAccessibility'>): {
  eligible: boolean;
  source: 'confirmed' | 'inferred';
  accessibility: 'available' | 'restricted' | 'excluded' | null;
} {
  const override = context.accountAccessibility.find(item => item.accountId === account.id);
  // User confirmation can restrict any account, but cannot make a pension,
  // property or market asset liquid. Retain the saved override for auditing.
  if (cashExclusionReason(account)) return { eligible: false, source: override ? 'confirmed' : 'inferred', accessibility: override?.accessibility ?? null };
  if (override) return { eligible: override.accessibility === 'available', source: 'confirmed', accessibility: override.accessibility };
  const restrictedName = /\b(fixed|term|notice|locked|bond)\b/i.test(account.name);
  const candidate = account.isInvestment
    ? account.investmentKind === 'savings'
    : /\b(bank|cash|current|savings|monzo|barclays|natwest|hsbc|lloyds|starling|revolut|santander)\b/i.test(account.name);
  return { eligible: !restrictedName && candidate, source: 'inferred', accessibility: null };
}

export interface ContextOwner { id: number; name: string }
export interface ContextAccount extends AccessibilityAccount {
  ownerId: number | null;
  balance: string;
  latestJournalDate: string | null;
  postingCount: number;
  futurePostingCount: number;
}
export interface ContextLookup {
  asOf: string;
  owners: ContextOwner[];
  accounts: ContextAccount[];
}
export interface ContextWorkspace {
  version: 1;
  revision: number;
  updatedAt: string | null;
  data: FinancialContext;
  lookup: ContextLookup;
}
