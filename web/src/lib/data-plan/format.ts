import { createHash } from 'node:crypto';
import Decimal from 'decimal.js';
import { formatGbp, formatGbpDelta } from './money';
import { accountAliasUses, propertyExpenseSubtree, resolveAccountAlias } from './planner';
import { PROFILE_FIELD_COLUMNS, TAX_PROFILE_FIELDS, type Plan } from './schema';
import type { Change, DbState, LedgerLine, OwnerTotals, PlanResult, SkipReason, Totals } from './types';
import { taxYearRange } from '@/lib/tax/ukTaxYear';

/**
 * Text rendering for snapshot, dry-run and apply output. Pure: strings in,
 * strings out, so the layout can be unit-tested and reviewed in a diff.
 */

const SKIP_HEADINGS: Record<SkipReason, string> = {
  already_loaded: 'Already loaded by this plan (re-run is a no-op)',
  duplicate_tagged: 'Already present in the ledger, tagged to the property',
  duplicate_untagged: 'Likely duplicates NOT tagged or created: needs a decision',
  alternate_amount: 'Possible existing record of the same money: needs a decision',
  different_amount: 'A different amount is already recorded for that payment, so the estimate was not added',
  unchanged: 'Already as planned',
  no_updates_allowed: 'Exist and differ, but the plan does not allow updating them',
  excluded: 'Excluded (include: false), listed only',
};

const SKIP_ORDER: SkipReason[] = [
  'duplicate_untagged',
  'alternate_amount',
  'different_amount',
  'no_updates_allowed',
  'already_loaded',
  'duplicate_tagged',
  'unchanged',
  'excluded',
];

function indent(text: string, spaces: number): string {
  const pad = ' '.repeat(spaces);
  return text
    .split('\n')
    .map(l => (l.length ? pad + l : l))
    .join('\n');
}

function clip(text: string, max = 90): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length > max ? `${flat.slice(0, max - 3)}...` : flat;
}

function show(v: string | null | undefined): string {
  return v === null || v === undefined || v === '' ? '(none)' : clip(v);
}

export function renderChange(c: Change): string {
  switch (c.type) {
    case 'letting_type':
      return `[~] letting type  ${c.propertyName}: '${c.from}' -> '${c.to}'   (item ${c.itemId})`;

    case 'tenancy_create': {
      const v = c.values;
      return [
        `[+] tenancy  ${c.propertyName}: "${v.tenantName}"   (item ${c.itemId})`,
        `      ${v.startDate} to ${v.endDate ?? 'open-ended'}, ${formatGbp(v.rentAmount)} ${v.rentFrequency}, deposit ${v.depositAmount ? formatGbp(v.depositAmount) : '(none)'}`,
      ].join('\n');
    }

    case 'tenancy_update': {
      const lines = [`[~] tenancy #${c.tenancyId}  ${c.propertyName}, start ${c.startDate}   (item ${c.itemId})`];
      for (const d of c.diffs) {
        const field = d.field.replace(/[A-Z]/g, m => `_${m.toLowerCase()}`);
        if (d.willUpdate) {
          lines.push(`      UPDATE ${field}: ${show(d.current)} -> ${show(d.planned)}`);
        } else {
          lines.push(`      differs, left alone (update is false) ${field}: db ${show(d.current)} / plan ${show(d.planned)}`);
        }
      }
      return lines.join('\n');
    }

    case 'journal_create': {
      const kind = c.kind === 'mortgage_interest' ? 'mortgage interest' : c.kind;
      const legs = c.legs
        .map(l => {
          const amt = new Decimal(l.amount);
          return `${amt.isNegative() ? 'Cr' : 'Dr'} ${l.accountName} ${formatGbp(amt.abs())}`;
        })
        .join('  /  ');
      return [
        `[+] journal  ${c.date}  ${formatGbp(c.amount)}  ${kind}  ${c.propertyName}   (item ${c.itemId})`,
        `      "${c.description}"   category: ${c.categoryName ?? '(none)'}`,
        `      ${legs}`,
        `      reference ${c.reference}`,
      ].join('\n');
    }

    case 'journal_tag': {
      const cat = c.setCategoryName ? `; category set to "${c.setCategoryName}"` : '';
      return [
        `[~] tag existing journal #${c.journalId}  ${c.date}  ${formatGbp(c.amount)}  "${c.description}"   (item ${c.itemId})`,
        `      on ${c.accountName}: set property to ${c.propertyName}${cat}`,
      ].join('\n');
    }

    case 'tax_profile': {
      const lines = [
        `[${c.existed ? '~' : '+'}] owner tax profile  ${c.ownerName} ${c.taxYear}${c.existed ? '' : ' (no row yet: will be created)'}   (items ${c.itemIds.join(', ')})`,
      ];
      for (const [field, value] of Object.entries(c.set)) {
        const prev = c.previous?.[field as keyof typeof c.previous];
        lines.push(
          `      ${PROFILE_FIELD_COLUMNS[field as keyof typeof PROFILE_FIELD_COLUMNS]}: ${prev !== undefined ? formatGbp(prev) : c.existed ? '(unset)' : '(new row)'} -> ${formatGbp(value as string)}`,
        );
      }
      if (c.notes !== null) {
        lines.push(`      notes: ${c.previousNotes ? 'plan block added/replaced; existing text kept' : '(empty)'} -> set`);
        lines.push(indent(c.notes, 10));
      }
      return lines.join('\n');
    }
  }
}

export function renderPlanResult(result: PlanResult, heading = 'Changes it WOULD make'): string {
  const out: string[] = [];

  out.push(`== ${heading} (${result.changes.length}) ==`);
  if (result.changes.length === 0) out.push('  (none: the database already matches the plan)');
  for (const c of result.changes) out.push(indent(renderChange(c), 2));

  const skipsByReason = new Map<SkipReason, typeof result.skips>();
  for (const s of result.skips) {
    const list = skipsByReason.get(s.reason) ?? [];
    list.push(s);
    skipsByReason.set(s.reason, list);
  }
  out.push('');
  out.push(`== Skipped (${result.skips.length}) ==`);
  if (result.skips.length === 0) out.push('  (nothing skipped)');
  for (const reason of SKIP_ORDER) {
    const list = skipsByReason.get(reason);
    if (!list) continue;
    out.push(`  ${SKIP_HEADINGS[reason]} (${list.length})`);
    for (const s of list) {
      out.push(`    [=] ${s.itemId}: ${clip(s.label, 110)}`);
      out.push(`        ${s.reason === 'excluded' ? clip(s.detail, 330) : s.detail}`);
    }
  }

  if (result.blocked.length > 0) {
    out.push('');
    out.push(`== BLOCKED (${result.blocked.length}): included items that cannot be done yet ==`);
    // Many items usually share one cause (an unset account alias): group them.
    const groups = new Map<string, typeof result.blocked>();
    for (const b of result.blocked) {
      const list = groups.get(b.reason) ?? [];
      list.push(b);
      groups.set(b.reason, list);
    }
    for (const [reason, items] of groups) {
      out.push(`  [!] ${items.length} item${items.length === 1 ? '' : 's'}: ${items.map(i => i.itemId).join(', ')}`);
      out.push(`      ${reason}`);
    }
    out.push('  (Blocked items are left out of the predicted totals below.)');
  }

  if (result.warnings.length > 0) {
    out.push('');
    out.push(`== Warnings (${result.warnings.length}) ==`);
    for (const w of result.warnings) out.push(`  * ${w}`);
  }
  return out.join('\n');
}

const TOTAL_ROWS: Array<[keyof Totals, string]> = [
  ['grossIncome', 'Gross income'],
  ['totalExpenses', 'Expenses'],
  ['mortgageInterest', 'Mortgage interest'],
  ['netBeforeMortgageRelief', 'Net before mortgage relief'],
];

function money(v: string, width: number): string {
  return formatGbp(v).padStart(width);
}

export function renderTotalsComparison(before: OwnerTotals, after: OwnerTotals, afterLabel = 'After'): string {
  const out: string[] = [];
  out.push(
    `== ${before.ownerName}: ${before.taxYear} tax-year totals at the owner's share (${before.startDate} to ${before.endDate}) ==`,
  );
  const w = Math.max(14, afterLabel.length + 2);
  const header = `${''.padEnd(34)}${'Before'.padStart(w)}${afterLabel.padStart(w)}${'Change'.padStart(w)}`;
  out.push(header);

  const row = (label: string, b: string, a: string) =>
    `${label.padEnd(34)}${money(b, w)}${money(a, w)}${formatGbpDelta(b, a).padStart(w)}`;

  for (const [key, label] of TOTAL_ROWS) {
    out.push(row(label, before.combined[key], after.combined[key]));
  }

  for (const bp of before.properties) {
    const ap = after.properties.find(p => p.propertyId === bp.propertyId);
    if (!ap) continue;
    out.push('');
    out.push(`  ${bp.propertyName} (owner's share ${bp.allocationPct}%)`);
    out.push(row('    Scheduled rent', bp.scheduledRent, ap.scheduledRent) + `   (${bp.scheduledRentLines} -> ${ap.scheduledRentLines} rent dues in year)`);
    out.push(row('    Other income (journals)', bp.otherIncome, ap.otherIncome));
    out.push(row('    Expenses', bp.totalExpenses, ap.totalExpenses));
    out.push(row('    Mortgage interest', bp.mortgageInterest, ap.mortgageInterest));
  }
  return out.join('\n');
}

/** One-column version of the totals table, for --snapshot. */
export function renderTotals(t: OwnerTotals): string {
  const out: string[] = [];
  out.push(`== ${t.ownerName}: ${t.taxYear} tax-year totals at the owner's share, as the tax report computes them (${t.startDate} to ${t.endDate}) ==`);
  for (const [key, label] of TOTAL_ROWS) out.push(`${label.padEnd(34)}${money(t.combined[key], 14)}`);
  for (const p of t.properties) {
    out.push('');
    out.push(`  ${p.propertyName} (owner's share ${p.allocationPct}%)`);
    out.push(`${'    Scheduled rent'.padEnd(34)}${money(p.scheduledRent, 14)}   (${p.scheduledRentLines} rent dues in year)`);
    out.push(`${'    Other income (journals)'.padEnd(34)}${money(p.otherIncome, 14)}`);
    out.push(`${'    Expenses'.padEnd(34)}${money(p.totalExpenses, 14)}`);
    out.push(`${'    Mortgage interest'.padEnd(34)}${money(p.mortgageInterest, 14)}`);
  }
  return out.join('\n');
}

/** Short stable hash of the change list, for --expect-digest. */
export function changeDigest(changes: readonly Change[]): string {
  const stable = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(stable);
    if (v && typeof v === 'object') {
      return Object.fromEntries(
        Object.entries(v as Record<string, unknown>)
          .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
          .map(([k, val]) => [k, stable(val)]),
      );
    }
    return v;
  };
  const sorted = [...changes].sort((a, b) => JSON.stringify(stable(a)).localeCompare(JSON.stringify(stable(b))));
  return createHash('sha256').update(JSON.stringify(stable(sorted))).digest('hex').slice(0, 16);
}

// ---------------------------------------------------------------------------
// snapshot
// ---------------------------------------------------------------------------

function lineKind(l: LedgerLine): string {
  if (l.accountType === 'INCOME') return 'income';
  return l.accountName === 'Mortgage Interest' && l.accountIsSystem ? 'interest' : 'expense';
}

/** Report-sign amount: income received positive, expense debit positive. */
function reportAmount(l: LedgerLine): Decimal {
  const raw = new Decimal(l.amount);
  return l.accountType === 'INCOME' ? raw.neg() : raw;
}

export function renderSnapshot(plan: Plan, state: DbState): string {
  const out: string[] = [];
  const range = taxYearRange(plan.taxYear);
  const owner = state.owners.find(o => o.name === plan.owner);
  const planProps = plan.properties.map(s => ({ section: s, row: state.properties.find(p => p.name === s.name) }));

  out.push('== Owners ==');
  for (const o of state.owners) out.push(`  #${o.id} ${o.name}${o.name === plan.owner ? '   <- plan owner' : ''}`);
  if (!owner) out.push(`  !! plan owner "${plan.owner}" does not exist`);

  out.push('');
  out.push('== Properties (letting type, owners, allocation rules) ==');
  for (const p of state.properties) {
    const inPlan = planProps.some(pp => pp.row?.id === p.id);
    const owners = state.ownership
      .filter(o => o.propertyId === p.id)
      .map(o => {
        const rules = state.allocationRules.filter(r => r.propertyId === p.id && r.ownerId === o.ownerId);
        const rule = rules.map(r => `${r.expenseType}=${r.allocationPct}%`).join(',');
        return `${o.ownerName}${rule ? ` [${rule}]` : ' [no rule: equal split]'}`;
      })
      .join('; ');
    out.push(`  #${p.id} ${p.name}  letting_type=${p.lettingType}${inPlan ? '   <- in plan' : ''}`);
    out.push(`        owners: ${owners || '(none)'}`);
  }
  for (const pp of planProps) {
    if (!pp.row) out.push(`  !! plan property "${pp.section.name}" does not exist`);
  }

  for (const pp of planProps) {
    if (!pp.row) continue;
    const p = pp.row;

    out.push('');
    out.push(`== Tenancies: ${p.name} ==`);
    const tenancies = state.tenancies.filter(t => t.propertyId === p.id);
    if (tenancies.length === 0) out.push('  (none)');
    for (const t of tenancies) {
      out.push(
        `  #${t.id} "${t.tenantName}"  ${t.startDate} to ${t.endDate ?? 'open-ended'}  ${formatGbp(t.rentAmount)} ${t.rentFrequency}  deposit ${t.depositAmount ? formatGbp(t.depositAmount) : '(none)'}`,
      );
      if (t.notes) out.push(`        notes: ${t.notes.length > 100 ? `${t.notes.slice(0, 100)}...` : t.notes}`);
    }

    out.push('');
    out.push(`== Journals tagged to ${p.name}, ${plan.taxYear} (income / expense / mortgage interest accounts) ==`);
    const lines = state.taggedLines
      .filter(l => l.propertyId === p.id && l.date >= range.startDate && l.date <= range.endDate)
      .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.journalId - b.journalId));
    if (lines.length === 0) out.push('  (none)');
    for (const l of lines) {
      const flags = [l.isTransfer ? 'TRANSFER (excluded from report)' : '', l.reference?.startsWith('plan:') ? l.reference : '']
        .filter(Boolean)
        .join(' ');
      out.push(
        `  #${String(l.journalId).padEnd(6)} ${l.date}  ${lineKind(l).padEnd(8)} ${formatGbp(reportAmount(l)).padStart(12)}  ${l.accountName}  "${l.description}"${flags ? `  [${flags}]` : ''}`,
      );
    }
  }

  out.push('');
  out.push(`== Owner tax profile: ${plan.owner} ${plan.taxYear} ==`);
  if (!state.taxProfile) {
    out.push('  (no row saved: the app treats every figure as nil)');
  } else {
    for (const f of TAX_PROFILE_FIELDS) {
      out.push(`  ${PROFILE_FIELD_COLUMNS[f].padEnd(34)} ${formatGbp(state.taxProfile.values[f]).padStart(14)}`);
    }
    out.push(`  notes: ${state.taxProfile.notes ? indent(state.taxProfile.notes, 8).trimStart() : '(none)'}`);
  }

  out.push('');
  out.push('== Accounts the plan would use ==');
  const sys = (name: string) => {
    const a = state.accounts.find(x => x.name === name);
    return a ? `#${a.id} ${a.accountType}${a.isSystem ? ', system' : ', NOT a system account'}` : 'MISSING';
  };
  out.push(`  "Mortgage Interest" (read by the tax report by name + is_system): ${sys('Mortgage Interest')}`);
  out.push(`  "Property Expenses" (debit side of itemised expenses):           ${sys('Property Expenses')}`);
  for (const use of accountAliasUses(plan)) {
    const r = resolveAccountAlias(plan.accounts, state.accounts, use.alias, use.expected);
    const wanted = plan.accounts[use.alias];
    if ('account' in r) {
      const a = r.account;
      const ownerName = a.ownerId !== null ? state.owners.find(o => o.id === a.ownerId)?.name : undefined;
      out.push(`  ${use.alias} -> "${a.name}" #${a.id} ${a.accountType}${ownerName ? ` (owner ${ownerName})` : ''}   used by ${use.itemIds.length} item(s)`);
    } else {
      out.push(`  ${use.alias} -> ${wanted === null ? '(not set)' : `"${wanted}" NOT FOUND / wrong type`}   needed as ${use.expected} by ${use.itemIds.length} item(s)`);
      const candidates = state.accounts.filter(a => a.accountType === use.expected);
      out.push(`        ${use.expected} accounts that exist: ${candidates.length ? candidates.map(a => `"${a.name}"${a.ownerId !== null ? ` (owner ${state.owners.find(o => o.id === a.ownerId)?.name ?? a.ownerId})` : ''}`).join(', ') : '(none)'}`);
    }
  }

  const subtree = propertyExpenseSubtree(state.categories);
  const wantedCategories = [
    ...new Set(plan.properties.flatMap(s => s.expenses.filter(e => e.include).map(e => e.category))),
  ];
  if (wantedCategories.length > 0) {
    out.push('');
    out.push('== Expense categories the plan would use ==');
    for (const name of wantedCategories) {
      const hit = subtree.find(c => c.name === name);
      out.push(`  "${name}": ${hit ? `#${hit.id} (under Property expenses)` : 'NOT FOUND under "Property expenses"'}`);
    }
  }

  if (state.referencedJournals.length > 0) {
    out.push('');
    out.push(`== Journals already carrying plan:${plan.planId}:* references ==`);
    for (const j of state.referencedJournals) {
      out.push(`  #${j.journalId} ${j.date} ${j.amount ? formatGbp(new Decimal(j.amount).abs()) : '(no income/expense leg)'}  ${j.reference}`);
    }
  }
  return out.join('\n');
}
