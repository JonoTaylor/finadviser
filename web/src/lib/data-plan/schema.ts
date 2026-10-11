import { z } from 'zod';
import Decimal from 'decimal.js';
import { LETTING_TYPES } from '@/lib/tax/apiSchemas';
import { taxYearRange } from '@/lib/tax/ukTaxYear';

/**
 * Data plan: a reviewable, versioned JSON description of ledger changes to
 * load (tenancies, journal entries, letting type, owner tax profile) for one
 * owner and one tax year. The loader script (scripts/apply-data-plan.ts)
 * diffs it against the database and only ever adds or updates rows.
 *
 * Every item carries the same three review fields:
 *   - `note`        what it is and where the figure came from
 *   - `confidence`  how much the source can be trusted (high / medium / low)
 *   - `include`     false = list it in the diff but never apply it
 *
 * Objects are strict: a misspelt key is an error rather than a silently
 * ignored field, because "only the fields present in the plan are set" is
 * the contract for updates.
 */

export const CONFIDENCE_LEVELS = ['high', 'medium', 'low'] as const;
export type Confidence = (typeof CONFIDENCE_LEVELS)[number];

export const RENT_FREQUENCIES = ['monthly', 'weekly', 'four_weekly', 'quarterly', 'annual'] as const;
export type PlanRentFrequency = (typeof RENT_FREQUENCIES)[number];

export const TAX_PROFILE_FIELDS = [
  'employmentIncome',
  'payeTaxPaid',
  'selfEmploymentIncome',
  'savingsInterest',
  'dividends',
  'otherIncome',
  'propertyLossesBroughtForward',
  'financeCostsBroughtForward',
] as const;
export type TaxProfileField = (typeof TAX_PROFILE_FIELDS)[number];

/** owner_tax_profiles column for each profile field. */
export const PROFILE_FIELD_COLUMNS: Record<TaxProfileField, string> = {
  employmentIncome: 'employment_income',
  payeTaxPaid: 'paye_tax_paid',
  selfEmploymentIncome: 'self_employment_income',
  savingsInterest: 'savings_interest',
  dividends: 'dividends',
  otherIncome: 'other_income',
  propertyLossesBroughtForward: 'property_losses_brought_forward',
  financeCostsBroughtForward: 'finance_costs_brought_forward',
};

export function emptyProfileValues(): Record<TaxProfileField, string> {
  const out = {} as Record<TaxProfileField, string>;
  for (const f of TAX_PROFILE_FIELDS) out[f] = '0.00';
  return out;
}

/** Lower-case words and hyphens only: ids end up inside `plan:<planId>:<itemId>`. */
const SLUG = /^[a-z0-9][a-z0-9-]{0,63}$/;
const slug = z.string().regex(SLUG, 'must be lower-case letters, digits and hyphens (max 64 chars)');

export function isRealIsoDate(value: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!m) return false;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  const date = new Date(Date.UTC(y, mo - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === mo - 1 && date.getUTCDate() === d;
}

const isoDate = z.string().refine(isRealIsoDate, 'must be a real calendar date, YYYY-MM-DD');

// NUMERIC(14,2) ceiling is 999,999,999,999.99.
const MONEY_RE = /^\d{1,12}(\.\d{1,2})?$/;
const MONEY_MESSAGE = 'must be a non-negative amount with at most 2 decimal places, as a string';
// One refinement per type, not a regex followed by a refine: zod still runs
// the later check after the regex fails, and new Decimal('abc') would throw.
const moneyNonNegative = z.string().superRefine((v, ctx) => {
  if (!MONEY_RE.test(v)) ctx.addIssue({ code: 'custom', message: MONEY_MESSAGE });
});
const moneyPositive = z.string().superRefine((v, ctx) => {
  if (!MONEY_RE.test(v)) {
    ctx.addIssue({ code: 'custom', message: MONEY_MESSAGE });
  } else if (new Decimal(v).isZero()) {
    ctx.addIssue({ code: 'custom', message: 'must be greater than zero' });
  }
});

/** Normalise a money string to 2dp. */
export function money2(value: string): string {
  return new Decimal(value).toFixed(2);
}

const itemMeta = {
  id: slug,
  include: z.boolean(),
  confidence: z.enum(CONFIDENCE_LEVELS),
  note: z.string().trim().min(1, 'note is required: say what this is and where it came from'),
};

/** A tenancy field. `update: true` lets the loader overwrite an existing row's value. */
function tenancyField<T extends z.ZodType>(value: T) {
  return z.strictObject({ value, update: z.boolean() });
}

const tenancyItem = z
  .strictObject({
    ...itemMeta,
    /** Match key together with the property. null only for an include:false placeholder. */
    startDate: isoDate.nullable(),
    /**
     * A NEW tenancy whose dates overlap an existing one for the same property
     * is blocked, because the rent schedule counts every tenancy and would
     * count the overlap twice (a shared boundary day included, since end_date
     * is inclusive). Set true only if that is really what you want.
     */
    allowOverlap: z.boolean().default(false),
    fields: z.strictObject({
      tenantName: tenancyField(z.string().trim().min(1)).optional(),
      endDate: tenancyField(isoDate.nullable()).optional(),
      rentAmount: tenancyField(moneyPositive).optional(),
      rentFrequency: tenancyField(z.enum(RENT_FREQUENCIES)).optional(),
      depositAmount: tenancyField(moneyNonNegative.nullable()).optional(),
      notes: tenancyField(z.string().nullable()).optional(),
    }),
  })
  .superRefine((t, ctx) => {
    if (!t.include) return;
    if (t.startDate === null) {
      ctx.addIssue({ code: 'custom', path: ['startDate'], message: 'startDate is required when include is true' });
    }
    if (!t.fields.tenantName) {
      ctx.addIssue({ code: 'custom', path: ['fields', 'tenantName'], message: 'tenantName is required when include is true' });
    }
    if (!t.fields.rentAmount) {
      ctx.addIssue({ code: 'custom', path: ['fields', 'rentAmount'], message: 'rentAmount is required when include is true' });
    }
    if (t.startDate && t.fields.endDate?.value && t.fields.endDate.value < t.startDate) {
      ctx.addIssue({ code: 'custom', path: ['fields', 'endDate'], message: 'endDate is before startDate' });
    }
  });

const journalBase = {
  ...itemMeta,
  date: isoDate,
  /** null only for an include:false placeholder whose amount is not known yet. */
  amount: moneyPositive.nullable(),
};
const journalMeta = { ...journalBase, description: z.string().trim().min(1) };

const incomeItem = z.strictObject({
  ...journalMeta,
  /** Alias (a key of `accounts`) of the ASSET account that received the money. */
  receivedInto: slugAlias(),
  /** Alias of the INCOME account that is credited. */
  incomeAccount: slugAlias(),
  /** Category name; optional. */
  category: z.string().trim().min(1).nullable().default(null),
  /** Tag an existing untagged match to the property instead of creating a duplicate. */
  tagExisting: z.boolean().default(false),
  /**
   * Other amounts the same real-world receipt may appear as in the ledger,
   * e.g. the net payout after the platform fee. A match on one of these is
   * reported for review and the item is NOT created, because creating it
   * would double-count the cash.
   */
  alternateAmounts: z.array(moneyPositive).default([]),
});

const expenseItem = z.strictObject({
  ...journalMeta,
  /** Alias of the ASSET account that paid (the owner's own account if paid personally). */
  paidFrom: slugAlias(),
  /** Name of a category under 'Property expenses'. */
  category: z.string().trim().min(1),
  tagExisting: z.boolean().default(false),
  alternateAmounts: z.array(moneyPositive).default([]),
});

const mortgageInterestItem = z.strictObject({
  // No description: the loader writes the mortgage tracker's own
  // 'Mortgage payment - <lender>', which the cash-flow code looks for.
  ...journalBase,
  paidFrom: slugAlias(),
  /** Lender name; the description becomes 'Mortgage payment - <lender>' like the mortgage tracker. */
  lender: z.string().trim().min(1),
});

const lettingTypeItem = z.strictObject({
  ...itemMeta,
  value: z.enum(LETTING_TYPES),
});

const propertySection = z.strictObject({
  /** Exact property name as stored in the database. */
  name: z.string().trim().min(1),
  lettingType: lettingTypeItem.optional(),
  tenancies: z.array(tenancyItem).default([]),
  income: z.array(incomeItem).default([]),
  expenses: z.array(expenseItem).default([]),
  mortgageInterest: z.array(mortgageInterestItem).default([]),
});

const taxProfileItem = z.strictObject({
  ...itemMeta,
  field: z.enum(TAX_PROFILE_FIELDS),
  value: moneyNonNegative,
});

const taxProfileNotes = z.strictObject({
  ...itemMeta,
  value: z.string().trim().min(1),
});

const ownerTaxProfileSection = z.strictObject({
  items: z.array(taxProfileItem).default([]),
  notes: taxProfileNotes.optional(),
});

function slugAlias() {
  return z.string().regex(/^[A-Za-z][A-Za-z0-9_-]{0,63}$/, 'must be an alias defined in "accounts"');
}

export const planSchema = z
  .strictObject({
    planId: slug,
    description: z.string().optional(),
    /** Tax year label, e.g. '2025-26' (6 April to 5 April). */
    taxYear: z.string().refine(v => {
      try {
        taxYearRange(v);
        return true;
      } catch {
        return false;
      }
    }, "must be a tax-year label like '2025-26'"),
    /** Exact owner name as stored in the database. */
    owner: z.string().trim().min(1),
    /**
     * Alias -> exact account name. null means "not decided yet": the loader
     * will list candidate accounts and refuse to create anything that needs it.
     * Can be overridden on the command line with --account alias="Exact name".
     */
    accounts: z.record(slugAlias(), z.string().trim().min(1).nullable()).default({}),
    dedupe: z
      .strictObject({
        /** Likely-duplicate window either side of an item's date, in days. */
        windowDays: z.number().int().min(0).max(31).default(5),
      })
      .default({ windowDays: 5 }),
    properties: z.array(propertySection).min(1),
    ownerTaxProfile: ownerTaxProfileSection.optional(),
  })
  .superRefine((plan, ctx) => {
    const range = taxYearRangeOrNull(plan.taxYear);
    const seenIds = new Map<string, string>();
    const claim = (id: string, path: (string | number)[]) => {
      const prev = seenIds.get(id);
      if (prev) {
        ctx.addIssue({ code: 'custom', path, message: `duplicate item id '${id}' (also used at ${prev}); ids must be unique across the plan` });
      } else {
        seenIds.set(id, path.join('.'));
      }
    };

    const propertyNames = new Set<string>();
    plan.properties.forEach((p, pi) => {
      if (propertyNames.has(p.name)) {
        ctx.addIssue({ code: 'custom', path: ['properties', pi, 'name'], message: `property '${p.name}' listed twice` });
      }
      propertyNames.add(p.name);

      if (p.lettingType) claim(p.lettingType.id, ['properties', pi, 'lettingType']);
      p.tenancies.forEach((t, i) => claim(t.id, ['properties', pi, 'tenancies', i]));

      const journalSections = [
        ['income', p.income],
        ['expenses', p.expenses],
        ['mortgageInterest', p.mortgageInterest],
      ] as const;
      for (const [section, items] of journalSections) {
        items.forEach((it, i) => {
          claim(it.id, ['properties', pi, section, i]);
          if (it.include && it.amount === null) {
            ctx.addIssue({ code: 'custom', path: ['properties', pi, section, i, 'amount'], message: 'amount is required when include is true' });
          }
          if (it.include && range && (it.date < range.startDate || it.date > range.endDate)) {
            ctx.addIssue({
              code: 'custom',
              path: ['properties', pi, section, i, 'date'],
              message: `${it.date} is outside tax year ${plan.taxYear} (${range.startDate} to ${range.endDate}); the tax report would not see it`,
            });
          }
          const aliases: string[] = [];
          if ('paidFrom' in it) aliases.push(it.paidFrom);
          if ('receivedInto' in it) aliases.push(it.receivedInto, it.incomeAccount);
          for (const alias of aliases) {
            if (!(alias in plan.accounts)) {
              ctx.addIssue({
                code: 'custom',
                path: ['properties', pi, section, i],
                message: `account alias '${alias}' is not defined in "accounts"`,
              });
            }
          }
        });
      }
    });

    const profile = plan.ownerTaxProfile;
    if (profile) {
      const fields = new Set<string>();
      profile.items.forEach((it, i) => {
        claim(it.id, ['ownerTaxProfile', 'items', i]);
        if (fields.has(it.field)) {
          ctx.addIssue({ code: 'custom', path: ['ownerTaxProfile', 'items', i, 'field'], message: `field '${it.field}' listed twice` });
        }
        fields.add(it.field);
      });
      if (profile.notes) claim(profile.notes.id, ['ownerTaxProfile', 'notes']);
    }
  });

function taxYearRangeOrNull(label: string) {
  try {
    return taxYearRange(label);
  } catch {
    return null;
  }
}

export type Plan = z.output<typeof planSchema>;
export type PropertySection = Plan['properties'][number];
export type TenancyItem = PropertySection['tenancies'][number];
export type IncomeItem = PropertySection['income'][number];
export type ExpenseItem = PropertySection['expenses'][number];
export type MortgageInterestItem = PropertySection['mortgageInterest'][number];
export type LettingTypeItem = NonNullable<PropertySection['lettingType']>;
export type TaxProfileItem = NonNullable<Plan['ownerTaxProfile']>['items'][number];
export type TaxProfileNotesItem = NonNullable<NonNullable<Plan['ownerTaxProfile']>['notes']>;

export class PlanValidationError extends Error {
  readonly issues: string[];
  constructor(issues: string[]) {
    super(`Plan is not valid:\n${issues.map(i => `  - ${i}`).join('\n')}`);
    this.name = 'PlanValidationError';
    this.issues = issues;
  }
}

/** Parse and validate plan JSON. Throws PlanValidationError listing every problem. */
export function parsePlan(raw: unknown): Plan {
  const result = planSchema.safeParse(raw);
  if (!result.success) {
    throw new PlanValidationError(
      result.error.issues.map(i => `${i.path.length ? i.path.join('.') : '(plan)'}: ${i.message}`),
    );
  }
  return result.data;
}

/** The reference stamped on every journal entry the loader creates. */
export function itemReference(planId: string, itemId: string): string {
  return `plan:${planId}:${itemId}`;
}
