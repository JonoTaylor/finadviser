import Decimal from 'decimal.js';
import { propertyRepo } from './property.repo';
import { rentalReportRepo, type RentalReportTotals } from './rental-report.repo';
import { taxYearRange, type TaxYearRange } from '@/lib/tax/ukTaxYear';
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
};
