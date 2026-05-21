import { NextRequest, NextResponse } from 'next/server';
import Decimal from 'decimal.js';
import { propertyRepo, tenancyRepo, rentalReportRepo, accountRepo } from '@/lib/repos';
import { currentTaxYear } from '@/lib/tax/ukTaxYear';
import { ClientError } from '@/lib/errors';

/**
 * One-round-trip endpoint for the BTL decision-support page. Returns
 * everything the client-side calc engine needs to evaluate scenarios
 * without re-fetching on every slider drag.
 *
 * Property-shaped so the same shape can drive any BTL the user adds in
 * future, not just Francis Road. The actual scenario evaluation runs
 * in the browser; this endpoint only assembles the context.
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const propertyId = parseInt(id, 10);
    if (Number.isNaN(propertyId)) {
      return NextResponse.json({ error: 'Invalid property id' }, { status: 400 });
    }

    const property = await propertyRepo.getProperty(propertyId);
    if (!property) {
      return NextResponse.json({ error: 'Property not found' }, { status: 404 });
    }

    const today = new Date().toISOString().slice(0, 10);
    const [latestValuation, ownership, mortgages, activeTenancy] = await Promise.all([
      propertyRepo.getLatestValuation(propertyId),
      propertyRepo.getOwnership(propertyId),
      propertyRepo.getMortgages(propertyId),
      tenancyRepo.getActiveOn(propertyId, today),
    ]);

    // Outstanding balance + rate history for each mortgage, in parallel.
    const mortgagesWithDetail = await Promise.all(
      mortgages.map(async m => {
        const [balance, rates] = await Promise.all([
          accountRepo.getBalance(m.liabilityAccountId),
          propertyRepo.getMortgageRates(m.id),
        ]);
        return {
          id: m.id,
          lender: m.lender,
          originalAmount: m.originalAmount,
          startDate: m.startDate,
          termMonths: m.termMonths,
          interestOnly: m.interestOnly ?? false,
          outstandingBalance: new Decimal(balance).abs().toFixed(2),
          rates: rates.map(r => ({ rate: r.rate, effectiveDate: r.effectiveDate })),
        };
      }),
    );

    // Annual running-cost baseline: pull the current tax-year report and
    // use total expenses minus mortgage interest (the scenario explorer
    // models mortgage interest separately via the product spec).
    const range = currentTaxYear();
    const report = await rentalReportRepo.getTaxYearReport({
      propertyId,
      startDate: range.startDate,
      endDate: range.endDate,
    });
    const totalExpenses = new Decimal(report.totals.totalExpenses);
    const mortgageInterest = new Decimal(report.totals.mortgageInterest);
    const runningCostsExMortgageInterest = Decimal.max(
      totalExpenses.minus(mortgageInterest),
      0,
    ).toFixed(2);

    // Annual rent derived from the active tenancy if present, otherwise
    // from rent received over the current tax year.
    let annualRent: string;
    if (activeTenancy) {
      const rent = new Decimal(activeTenancy.rentAmount);
      annualRent = annualiseRent(rent, activeTenancy.rentFrequency).toFixed(2);
    } else {
      const rentTotal = report.income.reduce(
        (acc, line) => acc.plus(line.amount),
        new Decimal(0),
      );
      annualRent = rentTotal.toFixed(2);
    }

    const totalOutstandingBalance = mortgagesWithDetail.reduce(
      (acc, m) => acc.plus(new Decimal(m.outstandingBalance)),
      new Decimal(0),
    );

    return NextResponse.json({
      property: {
        id: property.id,
        name: property.name,
        address: property.address,
        purchasePrice: property.purchasePrice,
        purchaseDate: property.purchaseDate,
      },
      latestValuation: latestValuation
        ? { valuation: latestValuation.valuation, valuationDate: latestValuation.valuationDate }
        : null,
      ownership: ownership.map(o => ({
        ownerId: o.owner_id as number,
        ownerName: o.owner_name as string,
      })),
      ownerCount: ownership.length,
      mortgages: mortgagesWithDetail,
      totalOutstandingBalance: totalOutstandingBalance.toFixed(2),
      activeTenancy: activeTenancy
        ? {
            id: activeTenancy.id,
            tenantName: activeTenancy.tenantName,
            startDate: activeTenancy.startDate,
            endDate: activeTenancy.endDate,
            rentAmount: activeTenancy.rentAmount,
            rentFrequency: activeTenancy.rentFrequency,
          }
        : null,
      annualRent,
      annualRunningCosts: runningCostsExMortgageInterest,
      currentTaxYear: range,
    });
  } catch (error) {
    if (error instanceof ClientError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    const message = error instanceof Error ? error.message : 'Failed to build decision context';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

function annualiseRent(amount: Decimal, frequency: string): Decimal {
  switch (frequency) {
    case 'weekly':
      return amount.mul(52);
    case 'four_weekly':
      return amount.mul(13);
    case 'quarterly':
      return amount.mul(4);
    case 'annual':
      return amount;
    case 'monthly':
    default:
      return amount.mul(12);
  }
}
