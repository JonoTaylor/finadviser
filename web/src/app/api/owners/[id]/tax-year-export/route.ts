import { NextRequest, NextResponse } from 'next/server';
import JSZip from 'jszip';
import Decimal from 'decimal.js';
import { ownerReportRepo, rentalReportRepo } from '@/lib/repos';
import { taxYearRange, currentTaxYear } from '@/lib/tax/ukTaxYear';
import { ClientError, NotFoundError } from '@/lib/errors';
import type { RentalIncomeLine, RentalExpenseLine } from '@/lib/repos/rental-report.repo';

/**
 * Bundle all the CSVs and a cover sheet that Jane (the accountant) asked
 * for, scoped to one owner's share for one UK tax year. Returned as a
 * single zip download so Emily can attach it to one email instead of
 * stitching together a dozen CSV exports.
 *
 * Bundle contents:
 *   cover.txt                                                 human-readable summary
 *   summary.csv                                               per-property + total
 *   property-<id>-<slug>/income.csv                           rent schedule
 *   property-<id>-<slug>/expenses.csv                         itemised deductible
 *   property-<id>-<slug>/mortgage-interest.csv                S.24 restricted
 *   property-<id>-<slug>/other-income.csv                     only when non-empty
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const ownerId = parseInt(id, 10);
    if (Number.isNaN(ownerId)) {
      return NextResponse.json({ error: 'Invalid owner id' }, { status: 400 });
    }

    const yearParam = request.nextUrl.searchParams.get('year');
    const year = yearParam ?? currentTaxYear().label;
    const range = taxYearRange(year);

    // ownerReportRepo.getTaxYearReport already validates the owner exists
    // (throws NotFoundError) — no need for a separate getOwner round-trip.
    const rollup = await ownerReportRepo.getTaxYearReport({ ownerId, year });

    const zip = new JSZip();

    // Per-property folders + CSVs. We need the full per-property line
    // arrays for the CSVs, not just the totals from the roll-up — fetch
    // each property's full report at the owner's share, in parallel.
    const perProperty = await Promise.all(
      rollup.properties.map(async ps => {
        const report = await rentalReportRepo.getTaxYearReport({
          propertyId: ps.propertyId,
          startDate: range.startDate,
          endDate: range.endDate,
          ownerId,
        });
        return {
          propertyId: ps.propertyId,
          propertyName: ps.propertyName,
          folderName: propertyFolder(ps.propertyId, ps.propertyName),
          allocationPct: ps.allocationPct,
          report,
        };
      }),
    );

    for (const { folderName, report } of perProperty) {
      const folder = zip.folder(folderName);
      if (!folder) continue;

      folder.file('income.csv', incomeCsv(report.income));
      folder.file('expenses.csv', expensesCsv(report.expenses));
      folder.file('mortgage-interest.csv', expensesCsv(report.mortgageInterest));
      if (report.otherIncome.length > 0) {
        folder.file('other-income.csv', otherIncomeCsv(report.otherIncome));
      }
    }

    zip.file('summary.csv', summaryCsv(rollup));
    zip.file('cover.txt', coverSheet(rollup, perProperty));

    // Note on memory: generateAsync builds the zip in memory before we
    // return it. That's fine at the expected scale (1-2 properties, 12
    // monthly rent rows + a few dozen expenses). If this grows to estate
    // scale, switch to the StreamHelper API and pipe to ReadableStream.
    const blob = await zip.generateAsync({ type: 'uint8array' });
    const filename = `accountant-pack-${slug(rollup.owner.name) || `owner-${rollup.owner.id}`}-${range.label}.zip`;

    return new Response(blob as unknown as BodyInit, {
      status: 200,
      headers: {
        'Content-Type': 'application/zip',
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Content-Length': String(blob.byteLength),
      },
    });
  } catch (error) {
    if (error instanceof ClientError || error instanceof NotFoundError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    const message = error instanceof Error ? error.message : 'Failed to build export';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

function slug(s: string): string {
  return s.replace(/[^a-zA-Z0-9-]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '').toLowerCase();
}

/**
 * Property folder name guarantees uniqueness (different properties with
 * the same / colliding names can't overwrite each other) and non-empty
 * (a property whose name is only punctuation still gets a folder).
 */
function propertyFolder(propertyId: number, propertyName: string): string {
  const s = slug(propertyName);
  return s ? `property-${propertyId}-${s}` : `property-${propertyId}`;
}

function csvEscape(value: string | number | null | undefined): string {
  const s = value == null ? '' : String(value);
  return `"${s.replace(/"/g, '""')}"`;
}

function csvRow(cells: Array<string | number | null | undefined>): string {
  return cells.map(csvEscape).join(',');
}

function incomeCsv(rows: RentalIncomeLine[]): string {
  const header = csvRow(['Source', 'Due date', 'Period start', 'Period end', 'Tenant', 'Account', 'Description', 'Amount']);
  const body = rows.map(r => csvRow([
    r.source,
    r.date,
    r.periodStart ?? '',
    r.periodEnd ?? '',
    r.tenantName ?? '',
    r.account ?? '',
    r.description ?? '',
    r.amount,
  ]));
  return [header, ...body].join('\n');
}

function expensesCsv(rows: RentalExpenseLine[]): string {
  const header = csvRow(['Date', 'Description', 'Category', 'Account', 'Reference', 'Amount']);
  const body = rows.map(r => csvRow([
    r.date,
    r.description,
    r.category ?? '',
    r.account,
    r.reference ?? '',
    r.amount,
  ]));
  return [header, ...body].join('\n');
}

function otherIncomeCsv(rows: RentalIncomeLine[]): string {
  const header = csvRow(['Date', 'Description', 'Account', 'Amount']);
  const body = rows.map(r => csvRow([
    r.date,
    r.description ?? '',
    r.account ?? '',
    r.amount,
  ]));
  return [header, ...body].join('\n');
}

interface RollupShape {
  owner: { id: number; name: string };
  taxYear: { label: string; startDate: string; endDate: string };
  properties: Array<{ propertyId: number; propertyName: string; allocationPct: string; totals: {
    grossIncome: string; totalExpenses: string; mortgageInterest: string; netBeforeMortgageRelief: string;
  } }>;
  combined: { grossIncome: string; totalExpenses: string; mortgageInterest: string; netBeforeMortgageRelief: string };
}

interface PerPropertyEntry {
  propertyId: number;
  propertyName: string;
  folderName: string;
  allocationPct: string;
  report: { otherIncome: RentalIncomeLine[] };
}

function summaryCsv(rollup: RollupShape): string {
  const header = csvRow([
    'Property',
    'Owner share %',
    'Gross income',
    'Deductible expenses',
    'Mortgage interest (S.24)',
    'Net before mortgage relief',
  ]);
  const body = rollup.properties.map(p => csvRow([
    p.propertyName,
    parseFloat(p.allocationPct),
    p.totals.grossIncome,
    p.totals.totalExpenses,
    p.totals.mortgageInterest,
    p.totals.netBeforeMortgageRelief,
  ]));
  const total = csvRow([
    'TOTAL',
    '',
    rollup.combined.grossIncome,
    rollup.combined.totalExpenses,
    rollup.combined.mortgageInterest,
    rollup.combined.netBeforeMortgageRelief,
  ]);
  return [header, ...body, total].join('\n');
}

function coverSheet(rollup: RollupShape, perProperty: PerPropertyEntry[]): string {
  const lines: string[] = [];
  const fmt = (v: string) => `£${new Decimal(v).toFixed(2)}`;
  lines.push(`Accountant pack — ${rollup.owner.name}`);
  lines.push(`UK tax year ${rollup.taxYear.label} (${rollup.taxYear.startDate} to ${rollup.taxYear.endDate})`);
  lines.push('');
  lines.push('All figures are at the owner\'s allocated share. Per-line amounts in the');
  lines.push('attached CSVs were allocated server-side at Decimal precision, so');
  lines.push('sum-of-lines matches the totals exactly.');
  lines.push('');
  lines.push('Combined totals');
  lines.push(`  Gross income (from tenancy contracts):    ${fmt(rollup.combined.grossIncome)}`);
  lines.push(`  Itemised deductible expenses:             ${fmt(rollup.combined.totalExpenses)}`);
  lines.push(`  Mortgage interest (S.24, restricted):     ${fmt(rollup.combined.mortgageInterest)}`);
  lines.push(`  Net before mortgage relief:               ${fmt(rollup.combined.netBeforeMortgageRelief)}`);
  lines.push('');
  lines.push('Per property');
  for (const p of rollup.properties) {
    lines.push(`  ${p.propertyName} (${parseFloat(p.allocationPct)}% share)`);
    lines.push(`    Gross income:        ${fmt(p.totals.grossIncome)}`);
    lines.push(`    Deductible expenses: ${fmt(p.totals.totalExpenses)}`);
    lines.push(`    Mortgage interest:   ${fmt(p.totals.mortgageInterest)}`);
    lines.push(`    Net before relief:   ${fmt(p.totals.netBeforeMortgageRelief)}`);
  }
  lines.push('');
  lines.push('Files in this pack');
  lines.push('  summary.csv                              one row per property + total');
  for (const entry of perProperty) {
    lines.push(`  ${entry.folderName}/income.csv             rent schedule from tenancy contracts`);
    lines.push(`  ${entry.folderName}/expenses.csv           itemised deductible expenses`);
    lines.push(`  ${entry.folderName}/mortgage-interest.csv  mortgage interest (S.24)`);
    if (entry.report.otherIncome.length > 0) {
      lines.push(`  ${entry.folderName}/other-income.csv       non-rent INCOME journal entries`);
    }
  }
  lines.push('');
  lines.push('Notes');
  lines.push('  - Mortgage interest is reported separately because under S.24 it gets');
  lines.push('    restricted basic-rate (20%) relief, not full deduction.');
  lines.push('  - Income comes from tenancy contracts (start/end/rent/frequency), not');
  lines.push('    per-receipt journals — the rent has been received consistently per the');
  lines.push('    contract.');
  lines.push('  - other-income.csv only appears for properties with non-rent INCOME');
  lines.push('    journal entries in the year.');
  lines.push('');
  lines.push(`Generated ${new Date().toISOString()}`);
  return lines.join('\n');
}
