import Decimal from 'decimal.js';
import { propertyRepo } from './property.repo';
import { rentalReportRepo, resolveAllocationPct, type RentalReportTotals } from './rental-report.repo';
import { tenancyRepo } from './tenancy.repo';
import { expandTenancies, type RentFrequency } from '@/lib/properties/rent-schedule';
import { taxYearRange, type TaxYearRange } from '@/lib/tax/ukTaxYear';
import { mtdQuartersForTaxYear } from '@/lib/tax/mtdQuarters';
import { NotFoundError } from '@/lib/errors';

export interface OwnerPropertySummary {
  propertyId: number;
  propertyName: string;
  allocationPct: string;
  totals: RentalReportTotals;
}

export interface OwnerTaxYearReport {
  owner: { id: number; name: string };
  taxYear: TaxYearRange;
  properties: OwnerPropertySummary[];
  combined: RentalReportTotals;
}

const ZERO_TOTALS: RentalReportTotals = {
  grossIncome: '0.00',
  totalExpenses: '0.00',
  mortgageInterest: '0.00',
  netBeforeMortgageRelief: '0.00',
};

export interface OwnerQuarterPropertyShare {
  propertyId: number;
  propertyName: string;
  allocationPct: string;
  /** Owner's share of gross income for this property in this quarter. */
  grossIncome: string;
}

export interface OwnerQuarter {
  index: 1 | 2 | 3 | 4;
  label: string;
  startDate: string;
  endDate: string;
  submissionDeadline: string;
  /** Combined gross income at the owner's share for this quarter. */
  grossIncome: string;
  perProperty: OwnerQuarterPropertyShare[];
}

export interface OwnerQuarterlyReport {
  owner: { id: number; name: string };
  taxYear: TaxYearRange;
  quarters: OwnerQuarter[];
}

/**
 * Cross-property tax-year roll-up for one owner. For each property the
 * owner has any stake in, calls the per-property tax-year report at this
 * owner's allocation share — server-side allocation per line means
 * sum-of-properties matches the combined totals exactly. No client-side
 * arithmetic on currency.
 */
export const ownerReportRepo = {
  async getTaxYearReport(params: {
    ownerId: number;
    year: string;
  }): Promise<OwnerTaxYearReport> {
    const { ownerId, year } = params;

    const owner = await propertyRepo.getOwner(ownerId);
    if (!owner) throw new NotFoundError(`Owner ${ownerId} not found`);

    const range = taxYearRange(year);
    const properties = await propertyRepo.listPropertiesByOwner(ownerId);

    // Fan out the per-property reports in parallel — sequential would mean
    // one round-trip to Neon per property, and the queries are independent.
    const propertySummaries: OwnerPropertySummary[] = await Promise.all(
      properties.map(async (p) => {
        const report = await rentalReportRepo.getTaxYearReport({
          propertyId: p.id,
          startDate: range.startDate,
          endDate: range.endDate,
          ownerId,
        });
        // totalsForOwner is the sum of per-line allocated values, which is
        // the figure we want here. Fall back to the (un-allocated) totals
        // if no allocation was applied — shouldn't happen in this code path
        // but defend against it.
        const totals = report.totalsForOwner ?? report.totals;
        return {
          propertyId: p.id,
          propertyName: p.name,
          allocationPct: report.allocationPct,
          totals,
        };
      }),
    );

    let gross = new Decimal(0);
    let expenses = new Decimal(0);
    let interest = new Decimal(0);
    for (const summary of propertySummaries) {
      gross = gross.plus(summary.totals.grossIncome);
      expenses = expenses.plus(summary.totals.totalExpenses);
      interest = interest.plus(summary.totals.mortgageInterest);
    }

    const combined: RentalReportTotals = properties.length === 0 ? ZERO_TOTALS : {
      grossIncome: gross.toFixed(2),
      totalExpenses: expenses.toFixed(2),
      mortgageInterest: interest.toFixed(2),
      netBeforeMortgageRelief: gross.minus(expenses).toFixed(2),
    };

    return {
      owner: { id: owner.id, name: owner.name },
      taxYear: range,
      properties: propertySummaries,
      combined,
    };
  },

  /**
   * MTD-IT quarterly gross-income report for an owner.
   *
   * Per HMRC + Jane's brief, the quarterly update declares gross rent only
   * — schedule-derived income from tenancy contracts. Manual journal-based
   * income (laundry, deposit retention) belongs in the end-of-year return
   * and is intentionally excluded here.
   *
   * Implementation: fetch each property's tenancies + allocation share
   * once, then expand the schedule for each of the four quarters in
   * memory. DB queries scale with property count, not quarter count
   * (was 4×N round-trips, now N×2 + 2 — fixes the fan-out concern and
   * makes the schedule-only contract concrete).
   */
  async getQuarterlyReport(params: {
    ownerId: number;
    year: string;
  }): Promise<OwnerQuarterlyReport> {
    const { ownerId, year } = params;

    const owner = await propertyRepo.getOwner(ownerId);
    if (!owner) throw new NotFoundError(`Owner ${ownerId} not found`);

    const range = taxYearRange(year);
    const properties = await propertyRepo.listPropertiesByOwner(ownerId);
    const quarters = mtdQuartersForTaxYear(range);

    // One fetch per property for both tenancies and allocation pct. After
    // this, all quarter computation is pure in-memory schedule expansion.
    const propertyData = await Promise.all(
      properties.map(async (p) => {
        const [tenancies, allocationPct] = await Promise.all([
          tenancyRepo.listByProperty(p.id),
          resolveAllocationPct(p.id, ownerId),
        ]);
        return { property: p, tenancies, allocationPct };
      }),
    );

    const ownerQuarters: OwnerQuarter[] = quarters.map((q) => {
      const shares: OwnerQuarterPropertyShare[] = propertyData.map((pd) => {
        const schedule = expandTenancies(
          pd.tenancies.map(t => ({
            id: t.id,
            tenantName: t.tenantName,
            startDate: t.startDate,
            endDate: t.endDate,
            rentAmount: t.rentAmount,
            rentFrequency: t.rentFrequency as RentFrequency,
          })),
          q.startDate,
          q.endDate,
        );
        const factor = pd.allocationPct.div(100);
        // Allocate per due-date line then sum, matching the tax-year
        // report's per-line server-side allocation. Means quarter+quarter
        // = annual schedule total exactly, no rounding drift.
        const total = schedule.reduce(
          (acc, line) => acc.plus(new Decimal(line.amount).mul(factor).toFixed(2)),
          new Decimal(0),
        );
        return {
          propertyId: pd.property.id,
          propertyName: pd.property.name,
          allocationPct: pd.allocationPct.toFixed(4),
          grossIncome: total.toFixed(2),
        };
      });
      const grossIncome = shares.reduce(
        (acc, s) => acc.plus(s.grossIncome),
        new Decimal(0),
      );
      return {
        index: q.index,
        label: q.label,
        startDate: q.startDate,
        endDate: q.endDate,
        submissionDeadline: q.submissionDeadline,
        grossIncome: grossIncome.toFixed(2),
        perProperty: shares,
      };
    });

    return {
      owner: { id: owner.id, name: owner.name },
      taxYear: range,
      quarters: ownerQuarters,
    };
  },
};
