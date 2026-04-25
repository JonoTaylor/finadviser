import { NextRequest, NextResponse } from 'next/server';
import Decimal from 'decimal.js';
import { ownerReportRepo, rentalReportRepo } from '@/lib/repos';
import { currentTaxYear, taxYearRange } from '@/lib/tax/ukTaxYear';
import { ClientError, NotFoundError } from '@/lib/errors';
import type { RentalExpenseLine } from '@/lib/repos/rental-report.repo';

/**
 * End-of-year bridging CSV — flat key/value summary at the owner's share,
 * suitable for ingestion into bridging products and for the HMRC end-of-year
 * return where total expenses are required (rather than the quarterly
 * gross-only updates).
 *
 * Section column groups rows so a bridging product (or human reader) can
 * filter / pivot easily:
 *   Income            — total schedule rent + per-property schedule totals
 *   Other income      — manual non-rent journal entries (separate so they
 *                       are not double-counted against schedule rent)
 *   Expenses          — total expenses + per-category + itemised
 *   Mortgage interest — total restricted under S.24
 *   Summary       — combined totals at owner share
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

    const rollup = await ownerReportRepo.getTaxYearReport({ ownerId, year });
    const perProperty = await Promise.all(
      rollup.properties.map(ps => rentalReportRepo.getTaxYearReport({
        propertyId: ps.propertyId,
        startDate: range.startDate,
        endDate: range.endDate,
        ownerId,
      })),
    );

    const lines: string[][] = [];
    const push = (section: string, item: string, amount: string, ...extras: string[]) =>
      lines.push([section, item, amount, ...extras]);

    push('Section', 'Item', 'Amount', 'Property', 'Date');

    // ps.totals.grossIncome includes BOTH schedule rent AND journal
    // otherIncome — so we can't print it under a "schedule rent" label
    // without misleading the reader. Compute schedule-only and
    // other-income separately, label each clearly, and skip the
    // combined total to avoid implying double-counting.
    let totalScheduleRent = new Decimal(0);
    let totalOtherIncome = new Decimal(0);
    for (const report of perProperty) {
      for (const line of report.income) totalScheduleRent = totalScheduleRent.plus(line.amount);
      for (const line of report.otherIncome) totalOtherIncome = totalOtherIncome.plus(line.amount);
    }

    // ── Income (schedule rent — total + per-property) ────────
    push('Income', 'Total gross rent (schedule, all properties)', totalScheduleRent.toFixed(2), '', '');
    perProperty.forEach((report, i) => {
      const ps = rollup.properties[i];
      const propertyScheduleTotal = report.income.reduce(
        (acc, line) => acc.plus(line.amount),
        new Decimal(0),
      );
      push('Income', `Gross rent (schedule) — ${ps.propertyName}`, propertyScheduleTotal.toFixed(2), ps.propertyName, '');
    });

    // ── Other income (manual journal entries — separate so it's not
    //    double-counted against the schedule total) ───────────────
    if (totalOtherIncome.gt(0) || perProperty.some(r => r.otherIncome.length > 0)) {
      push('Other income', 'Total other (non-rent) income, all properties', totalOtherIncome.toFixed(2), '', '');
      perProperty.forEach((report, i) => {
        const ps = rollup.properties[i];
        for (const line of report.otherIncome) {
          push('Other income (itemised)', line.description ?? '', line.amount, ps.propertyName, line.date);
        }
      });
    }

    // ── Expenses (category totals + itemised) ───────────────
    push('Expenses', 'Total deductible expenses', rollup.combined.totalExpenses, '', '');
    const categoryTotals = aggregateByCategory(perProperty.flatMap(r => r.expenses));
    for (const [category, total] of categoryTotals) {
      push('Expenses (by category)', category, total.toFixed(2), '', '');
    }
    perProperty.forEach((report, i) => {
      const ps = rollup.properties[i];
      for (const line of report.expenses) {
        push('Expenses (itemised)', `${line.category ?? 'Uncategorised'} — ${line.description}`, line.amount, ps.propertyName, line.date);
      }
    });

    // ── Mortgage interest (S.24 restricted) ─────────────────
    push('Mortgage interest', 'Total (S.24, basic-rate relief)', rollup.combined.mortgageInterest, '', '');
    perProperty.forEach((report, i) => {
      const ps = rollup.properties[i];
      for (const line of report.mortgageInterest) {
        push('Mortgage interest (itemised)', line.description, line.amount, ps.propertyName, line.date);
      }
    });

    // ── Summary ─────────────────────────────────────────────
    push('Summary', 'Net before mortgage relief', rollup.combined.netBeforeMortgageRelief, '', '');

    const csv = lines.map(r => r.map(csvEscape).join(',')).join('\n');
    const filename = `mtd-end-of-year-${slug(rollup.owner.name)}-${rollup.taxYear.label}.csv`;
    return new Response(csv, {
      status: 200,
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="${filename}"`,
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

function aggregateByCategory(expenses: RentalExpenseLine[]): Array<[string, Decimal]> {
  const totals = new Map<string, Decimal>();
  for (const e of expenses) {
    const key = e.category ?? 'Uncategorised';
    totals.set(key, (totals.get(key) ?? new Decimal(0)).plus(e.amount));
  }
  return [...totals.entries()].sort((a, b) => a[0].localeCompare(b[0]));
}

function csvEscape(value: string): string {
  return `"${value.replace(/"/g, '""')}"`;
}

function slug(s: string): string {
  return s.replace(/[^a-zA-Z0-9-]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '').toLowerCase() || 'owner';
}
