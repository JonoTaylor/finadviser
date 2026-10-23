import { and, eq, inArray, sql } from 'drizzle-orm';
import { getDb, schema } from '@/lib/db';
import { NotFoundError } from '@/lib/errors';
import {
  emptyTaxProfileFacts, knownTaxFieldsSchema, ownerTaxProfilePatchSchema, resolveTaxProfileInputs,
  taxFieldSourcesSchema, taxMoneyFields, taxMoneyFieldLabels, taxProfileFactsSchema, TaxProfileConflictError,
  type TaxFieldSource, type TaxMoneyField, type TaxProfileFacts, type OwnerTaxProfilePatch,
} from '@/lib/tax/profileFacts';
import { taxYearRange } from '@/lib/tax/ukTaxYear';
import { otherOwnersReceiveIncome } from '@/lib/tax/rentARoomSharing';
import {
  computeOwnerTax,
  type LettingType,
  type OwnerTaxComputation,
  type PropertyLetting,
} from '@/lib/tax/ownerTaxComputation';
import { ownerReportRepo } from './owner-report.repo';
import { propertyRepo } from './property.repo';

const { ownerTaxProfiles, properties } = schema;

/**
 * The saved per-owner, per-tax-year figures the ledger can't supply. Money
 * is a 2dp decimal string. `saved` is false when no row exists yet (every
 * figure is then zero), so the UI can tell "nothing entered" from "entered 0".
 */
export interface OwnerTaxProfile {
  ownerId: number;
  taxYear: string;
  employmentIncome: string;
  payeTaxPaid: string;
  selfEmploymentIncome: string;
  savingsInterest: string;
  dividends: string;
  otherIncome: string;
  propertyLossesBroughtForward: string;
  financeCostsBroughtForward: string;
  notes: string | null;
  saved: boolean;
  updatedAt: string | null;
  revision: number;
  knownFields: TaxMoneyField[];
  facts: TaxProfileFacts;
  fieldSources: Record<string, TaxFieldSource>;
  /** Older zero defaults are unknown until explicitly confirmed. */
  legacyProfile: boolean;
}

export type OwnerTaxProfileInput = Pick<OwnerTaxProfile, TaxMoneyField | 'notes'>;

export interface OwnerTaxComputationProperty {
  propertyId: number;
  propertyName: string;
  lettingType: LettingType;
  allocationPct: string;
  /** Rent-a-room only: another owner also receives income, so the limit is halved (for all the owner's rent-a-room lettings together, if any one is shared). */
  rentARoomShared: boolean;
  grossIncome: string;
  totalExpenses: string;
  mortgageInterest: string;
}

export interface OwnerTaxComputationResult extends OwnerTaxComputation {
  owner: { id: number; name: string };
  profileSaved: boolean;
  properties: OwnerTaxComputationProperty[];
  profileGaps: string[];
  estimateOnly: boolean;
  profileComplete: boolean;
  payeTaxPaidKnown: boolean;
  /** Unknown PAYE or profile inputs must never produce an authoritative amount to pay. */
  estimatedBalancePayable: string | null;
}

function emptyProfile(ownerId: number, taxYear: string): OwnerTaxProfile {
  return {
    ownerId,
    taxYear,
    employmentIncome: '0.00',
    payeTaxPaid: '0.00',
    selfEmploymentIncome: '0.00',
    savingsInterest: '0.00',
    dividends: '0.00',
    otherIncome: '0.00',
    propertyLossesBroughtForward: '0.00',
    financeCostsBroughtForward: '0.00',
    notes: null,
    saved: false,
    updatedAt: null,
    revision: 0,
    knownFields: [],
    facts: { ...emptyTaxProfileFacts },
    fieldSources: {},
    legacyProfile: false,
  };
}

type ProfileRow = typeof ownerTaxProfiles.$inferSelect;

function rowToProfile(row: ProfileRow): OwnerTaxProfile {
  if (!Number.isSafeInteger(row.revision) || row.revision < 1) throw new Error('Saved tax profile metadata needs review before it can be used');
  const legacyProfile = row.knownFields === null;
  const storedKnownFields = legacyProfile ? null : knownTaxFieldsSchema.parse(row.knownFields);
  const knownFields = legacyProfile
    ? taxMoneyFields.filter(field => Number(row[field]) !== 0)
    : taxMoneyFields.filter(field => storedKnownFields?.includes(field));
  const updatedAt = row.updatedAt.toISOString();
  const fieldSources = taxFieldSourcesSchema.parse(row.fieldSources ?? {});
  if (legacyProfile) for (const field of knownFields) fieldSources[field] ??= { source: 'legacy', updatedAt };
  return {
    ownerId: row.ownerId,
    taxYear: row.taxYear,
    employmentIncome: row.employmentIncome,
    payeTaxPaid: row.payeTaxPaid,
    selfEmploymentIncome: row.selfEmploymentIncome,
    savingsInterest: row.savingsInterest,
    dividends: row.dividends,
    otherIncome: row.otherIncome,
    propertyLossesBroughtForward: row.propertyLossesBroughtForward,
    financeCostsBroughtForward: row.financeCostsBroughtForward,
    notes: row.notes,
    saved: true,
    updatedAt,
    revision: row.revision,
    knownFields,
    facts: taxProfileFactsSchema.parse({ ...emptyTaxProfileFacts, ...row.facts }),
    fieldSources,
    legacyProfile,
  };
}

function asLettingType(value: string | null | undefined): LettingType {
  return value === 'rent_a_room' ? 'rent_a_room' : 'standard';
}

/** Loads the ownership and 'all' allocation rules, then asks the pure rule. */
async function othersShareIncome(propertyId: number, ownerId: number): Promise<boolean> {
  const [ownership, rules] = await Promise.all([
    propertyRepo.getOwnership(propertyId),
    propertyRepo.getAllocationRules(propertyId),
  ]);
  return otherOwnersReceiveIncome({
    ownerId,
    ownerIds: ownership.map(o => Number(o.owner_id)),
    allocations: rules.filter(r => r.expenseType === 'all'),
  });
}

export const ownerTaxRepo = {
  /**
   * The saved profile for an owner and tax year, or a zeroed one with
   * `saved: false` when none has been entered. Throws NotFoundError for an
   * unknown owner and ClientError for a malformed year.
   */
  async getProfile(ownerId: number, year: string): Promise<OwnerTaxProfile> {
    const label = taxYearRange(year).label;
    const owner = await propertyRepo.getOwner(ownerId);
    if (!owner) throw new NotFoundError(`Owner ${ownerId} not found`);

    const db = getDb();
    const [row] = await db
      .select()
      .from(ownerTaxProfiles)
      .where(and(eq(ownerTaxProfiles.ownerId, ownerId), eq(ownerTaxProfiles.taxYear, label)));
    return row ? rowToProfile(row) : emptyProfile(ownerId, label);
  },

  /** Compatibility for older callers; partial omissions are preserved, never zeroed. */
  async upsertProfile(ownerId: number, year: string, input: OwnerTaxProfileInput): Promise<OwnerTaxProfile> {
    const current = await this.getProfile(ownerId, year);
    return this.patchProfile(ownerId, year, { ...input, expectedRevision: current.revision, source: 'user' });
  },

  /** A single-row compare-and-swap keeps monetary inputs and their evidence atomic. */
  async patchProfile(ownerId: number, year: string, input: OwnerTaxProfilePatch): Promise<OwnerTaxProfile> {
    const patch = ownerTaxProfilePatchSchema.parse(input);
    const label = taxYearRange(year).label;
    const current = await this.getProfile(ownerId, label);
    if (current.revision !== patch.expectedRevision) throw new TaxProfileConflictError();
    const knownFields = new Set(current.knownFields);
    const fieldSources = { ...current.fieldSources };
    const facts = { ...current.facts, ...patch.facts };
    const source = { source: patch.source, updatedAt: new Date().toISOString() } as const;
    // A newly supplied bonus representation supersedes its stale alternative.
    if (patch.facts?.bonusAmount != null) facts.bonusPercent = null;
    if (patch.facts?.bonusPercent != null) facts.bonusAmount = null;
    const values: Record<TaxMoneyField, string> = {} as Record<TaxMoneyField, string>;
    for (const field of taxMoneyFields) {
      const value = patch[field];
      values[field] = value === undefined ? current[field] : value ?? '0.00';
      if (value !== undefined) {
        if (value === null) knownFields.delete(field); else knownFields.add(field);
        fieldSources[field] = source;
      }
    }
    for (const field of Object.keys(patch.facts ?? {})) fieldSources[`facts.${field}`] = source;
    if (patch.facts?.bonusAmount != null) fieldSources['facts.bonusPercent'] = source;
    if (patch.facts?.bonusPercent != null) fieldSources['facts.bonusAmount'] = source;
    const changes = {
      ...values,
      notes: patch.notes === undefined ? current.notes : patch.notes || null,
      facts: taxProfileFactsSchema.parse(facts),
      knownFields: [...knownFields],
      fieldSources,
      revision: current.revision + 1,
    };
    const db = getDb();
    const rows = patch.expectedRevision === 0
      ? await db.insert(ownerTaxProfiles).values({ ownerId, taxYear: label, ...changes })
          .onConflictDoNothing({ target: [ownerTaxProfiles.ownerId, ownerTaxProfiles.taxYear] }).returning()
      : await db.update(ownerTaxProfiles).set({ ...changes, updatedAt: sql`now()` }).where(and(
          eq(ownerTaxProfiles.ownerId, ownerId), eq(ownerTaxProfiles.taxYear, label),
          eq(ownerTaxProfiles.revision, patch.expectedRevision),
        )).returning();
    if (rows.length !== 1) throw new TaxProfileConflictError();
    return rowToProfile(rows[0]);
  },

  /**
   * Full tax computation for one owner and tax year. Takes the owner-share
   * per-property totals from ownerReportRepo (so the allocation rules are
   * already applied, line by line, server-side), joins each property's
   * letting type and the saved profile, and runs the pure engine.
   */
  async getTaxComputation(params: { ownerId: number; year: string }): Promise<OwnerTaxComputationResult> {
    const { ownerId } = params;
    const label = taxYearRange(params.year).label;

    // The report throws NotFoundError for an unknown owner.
    const [report, profile] = await Promise.all([
      ownerReportRepo.getTaxYearReport({ ownerId, year: label }),
      this.getProfile(ownerId, label),
    ]);

    const propertyIds = report.properties.map(p => p.propertyId);
    const db = getDb();
    const typeRows = propertyIds.length === 0
      ? []
      : await db
          .select({ id: properties.id, lettingType: properties.lettingType })
          .from(properties)
          .where(inArray(properties.id, propertyIds));
    const typeById = new Map(typeRows.map(r => [r.id, asLettingType(r.lettingType)]));

    const detail: OwnerTaxComputationProperty[] = await Promise.all(
      report.properties.map(async p => {
        const lettingType = typeById.get(p.propertyId) ?? 'standard';
        return {
          propertyId: p.propertyId,
          propertyName: p.propertyName,
          lettingType,
          allocationPct: p.allocationPct,
          rentARoomShared: lettingType === 'rent_a_room'
            ? await othersShareIncome(p.propertyId, ownerId)
            : false,
          grossIncome: p.totals.grossIncome,
          totalExpenses: p.totals.totalExpenses,
          mortgageInterest: p.totals.mortgageInterest,
        };
      }),
    );

    const lettings: PropertyLetting[] = detail.map(p => ({
      name: p.propertyName,
      lettingType: p.lettingType,
      grossIncome: p.grossIncome,
      totalExpenses: p.totalExpenses,
      mortgageInterest: p.mortgageInterest,
      rentARoomShared: p.rentARoomShared,
    }));

    const resolved = resolveTaxProfileInputs(profile);
    const computation = computeOwnerTax({
      taxYear: label,
      properties: lettings,
      profile: {
        employmentIncome: resolved.employmentIncome,
        payeTaxPaid: profile.payeTaxPaid,
        selfEmploymentIncome: profile.selfEmploymentIncome,
        savingsInterest: profile.savingsInterest,
        dividends: profile.dividends,
        otherIncome: profile.otherIncome,
        propertyLossesBroughtForward: profile.propertyLossesBroughtForward,
        financeCostsBroughtForward: profile.financeCostsBroughtForward,
        pensionMethod: resolved.pensionMethod,
        employmentIncomeBasis: resolved.employmentIncomeBasis,
        pensionAnnualAmount: resolved.pensionAnnualAmount,
      },
    });

    const profileGaps: string[] = [];
    if (!resolved.employmentKnown) profileGaps.push('Employment income for this tax year is unknown.');
    for (const field of taxMoneyFields.filter(field => field !== 'employmentIncome')) {
      if (!profile.knownFields.includes(field)) profileGaps.push(`${taxMoneyFieldLabels[field]} has not been confirmed (including whether it is zero).`);
    }
    if (profile.facts.jurisdiction !== 'england_wales_ni') profileGaps.push('Supported tax residence (England, Wales or Northern Ireland) has not been confirmed.');
    const pensionAlreadyInPay = resolved.employmentIncomeBasis === 'taxable_pay_after_pension'
      && ['net_pay', 'salary_sacrifice'].includes(resolved.pensionMethod);
    const confirmedNoPension = profile.facts.pensionAnnualAmount === '0.00';
    if (!confirmedNoPension && !pensionAlreadyInPay && (profile.facts.pensionAnnualAmount === null
      || resolved.pensionAnnualAmount === undefined
      || resolved.pensionMethod === 'unknown' || resolved.employmentIncomeBasis === 'unknown')) {
      profileGaps.push('The pension tax method, pay basis or gross annual employee contribution is unknown.');
    }
    if (profile.legacyProfile) computation.warnings.unshift('This is a legacy profile: zero defaults are not treated as confirmed zero. Review and confirm the missing inputs.');
    computation.warnings.unshift(...resolved.warnings);
    if (profileGaps.length > 0) computation.warnings.unshift('Missing profile inputs are represented by zero placeholders in this scenario. The tax liability, Self Assessment balance, payments on account and carry-forwards are not confirmed.');
    if (!profile.saved) {
      computation.warnings.unshift(
        `No tax profile has been saved for ${label}. The figures below are a scenario using zero placeholders for missing inputs, not your tax bill.`,
      );
    }

    computation.warnings.push('Property figures are recorded amounts, not proof that this tax year is complete. Check rent, deductible expenses and actual dated mortgage interest against statements; current balance × rate is only a scenario.');
    const estimateOnly = profileGaps.length > 0 || resolved.estimated || computation.rates.assumed || computation.rates.provisional;
    return {
      ...computation,
      owner: report.owner,
      profileSaved: profile.saved,
      properties: detail,
      profileGaps,
      estimateOnly,
      profileComplete: profileGaps.length === 0,
      payeTaxPaidKnown: profile.knownFields.includes('payeTaxPaid'),
      estimatedBalancePayable: estimateOnly ? null : computation.selfAssessment.amountDue,
    };
  },
};
