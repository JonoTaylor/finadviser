import { and, eq, inArray, sql } from 'drizzle-orm';
import { getDb, schema } from '@/lib/db';
import { NotFoundError } from '@/lib/errors';
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
}

export type OwnerTaxProfileInput = Omit<OwnerTaxProfile, 'ownerId' | 'taxYear' | 'saved' | 'updatedAt'>;

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
  };
}

type ProfileRow = typeof ownerTaxProfiles.$inferSelect;

function rowToProfile(row: ProfileRow): OwnerTaxProfile {
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
    updatedAt: row.updatedAt.toISOString(),
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

  /** Insert or replace the profile for (owner, tax year). Inputs are already validated. */
  async upsertProfile(ownerId: number, year: string, input: OwnerTaxProfileInput): Promise<OwnerTaxProfile> {
    const label = taxYearRange(year).label;
    const owner = await propertyRepo.getOwner(ownerId);
    if (!owner) throw new NotFoundError(`Owner ${ownerId} not found`);

    const values = {
      employmentIncome: input.employmentIncome,
      payeTaxPaid: input.payeTaxPaid,
      selfEmploymentIncome: input.selfEmploymentIncome,
      savingsInterest: input.savingsInterest,
      dividends: input.dividends,
      otherIncome: input.otherIncome,
      propertyLossesBroughtForward: input.propertyLossesBroughtForward,
      financeCostsBroughtForward: input.financeCostsBroughtForward,
      notes: input.notes,
    };
    const db = getDb();
    const [row] = await db
      .insert(ownerTaxProfiles)
      .values({ ownerId, taxYear: label, ...values })
      .onConflictDoUpdate({
        target: [ownerTaxProfiles.ownerId, ownerTaxProfiles.taxYear],
        set: { ...values, updatedAt: sql`now()` },
      })
      .returning();
    return rowToProfile(row);
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

    const computation = computeOwnerTax({
      taxYear: label,
      properties: lettings,
      profile: {
        employmentIncome: profile.employmentIncome,
        payeTaxPaid: profile.payeTaxPaid,
        selfEmploymentIncome: profile.selfEmploymentIncome,
        savingsInterest: profile.savingsInterest,
        dividends: profile.dividends,
        otherIncome: profile.otherIncome,
        propertyLossesBroughtForward: profile.propertyLossesBroughtForward,
        financeCostsBroughtForward: profile.financeCostsBroughtForward,
      },
    });

    if (!profile.saved) {
      computation.warnings.unshift(
        `No tax profile has been saved for ${label}, so employment income, PAYE paid and all other income are treated as nil. Enter them for a realistic figure.`,
      );
    }

    return {
      ...computation,
      owner: report.owner,
      profileSaved: profile.saved,
      properties: detail,
    };
  },
};
