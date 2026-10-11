import Decimal from 'decimal.js';
import { findMatches, isMortgageInterestLine, type Match } from './matching';
import { decimalEquals, formatGbp } from './money';
import {
  itemReference,
  money2,
  type ExpenseItem,
  type IncomeItem,
  type MortgageInterestItem,
  type Plan,
  type PropertySection,
  type TaxProfileField,
  type TenancyItem,
} from './schema';
import type {
  AccountRow,
  AccountType,
  Blocked,
  CategoryRow,
  DbState,
  FieldDiff,
  JournalKind,
  Leg,
  OwnerRow,
  PlanResult,
  PropertyRow,
  Skip,
  SkipReason,
  TenancyRow,
  TenancyUpdatable,
  TenancyValues,
} from './types';

/**
 * Turns (plan, database state) into the list of changes the loader would
 * make, the items it would skip (with reasons) and the items it cannot do.
 * Pure: it never touches the database, which is what makes the dry run
 * trustworthy and every rule here unit-testable.
 *
 * It only ever produces additions and in-place updates. There is no change
 * type that deletes anything.
 */

const MORTGAGE_INTEREST_ACCOUNT = 'Mortgage Interest';
const PROPERTY_EXPENSES_ACCOUNT = 'Property Expenses';
const PROPERTY_EXPENSES_ROOT_CATEGORY = 'Property expenses';

const TENANCY_FIELDS: TenancyUpdatable[] = [
  'tenantName',
  'endDate',
  'rentAmount',
  'rentFrequency',
  'depositAmount',
  'notes',
];

const MAX_LISTED = 40;

/** What the dry run says about an item that needs a table or column the migration has not created yet. */
export const PENDING_MIGRATION_NOTE = 'pending migration: would apply after `npm run db:migrate` or the next deploy';

function listNames(names: string[]): string {
  if (names.length === 0) return '(none)';
  const shown = names.slice(0, MAX_LISTED).map(n => `"${n}"`).join(', ');
  return names.length > MAX_LISTED ? `${shown} (+${names.length - MAX_LISTED} more)` : shown;
}

export type AccountResolution = { account: AccountRow } | { error: string };

/** Resolve a plan account alias to a database account of the expected type. */
export function resolveAccountAlias(
  aliases: Record<string, string | null>,
  accounts: AccountRow[],
  alias: string,
  expected: AccountType,
): AccountResolution {
  const name = aliases[alias];
  const candidates = accounts.filter(a => a.accountType === expected).map(a => a.name);
  if (name === null || name === undefined) {
    return {
      error: `account alias "${alias}" has no account name set. Pass --account ${alias}="<exact name>" or set it in the plan. ${expected} accounts that exist: ${listNames(candidates)}.`,
    };
  }
  const account = accounts.find(a => a.name === name);
  if (!account) {
    return {
      error: `account "${name}" (alias "${alias}") does not exist. ${expected} accounts that exist: ${listNames(candidates)}.`,
    };
  }
  if (account.accountType !== expected) {
    return {
      error: `account "${name}" (alias "${alias}") is ${account.accountType}, but ${expected} is required here. ${expected} accounts that exist: ${listNames(candidates)}.`,
    };
  }
  return { account };
}

export interface AliasUse {
  alias: string;
  expected: AccountType;
  itemIds: string[];
}

/** Which account aliases the plan's included journal items use, and as what type. */
export function accountAliasUses(plan: Plan): AliasUse[] {
  const uses = new Map<string, AliasUse>();
  const add = (alias: string, expected: AccountType, itemId: string) => {
    const key = `${alias}|${expected}`;
    const use = uses.get(key) ?? { alias, expected, itemIds: [] };
    use.itemIds.push(itemId);
    uses.set(key, use);
  };
  for (const s of plan.properties) {
    for (const it of s.income) if (it.include) { add(it.receivedInto, 'ASSET', it.id); add(it.incomeAccount, 'INCOME', it.id); }
    for (const it of s.expenses) if (it.include) add(it.paidFrom, 'ASSET', it.id);
    for (const it of s.mortgageInterest) if (it.include) add(it.paidFrom, 'ASSET', it.id);
  }
  return [...uses.values()];
}

/** Every category in the 'Property expenses' subtree, root included (mirrors getPropertyExpenseCategoryIds). */
export function propertyExpenseSubtree(categories: CategoryRow[]): CategoryRow[] {
  const roots = categories.filter(c => c.name === PROPERTY_EXPENSES_ROOT_CATEGORY && c.parentId === null);
  const included = new Map<number, CategoryRow>(roots.map(r => [r.id, r]));
  let grew = true;
  while (grew) {
    grew = false;
    for (const c of categories) {
      if (!included.has(c.id) && c.parentId !== null && included.has(c.parentId)) {
        included.set(c.id, c);
        grew = true;
      }
    }
  }
  return [...included.values()];
}

export function notesBlockMarkers(planId: string): { start: string; end: string } {
  return { start: `--- plan:${planId} ---`, end: `--- end plan:${planId} ---` };
}

/**
 * Merge a plan's notes into the existing profile notes without clobbering
 * anything the user wrote: the plan owns one delimited block, which is
 * replaced in place on a re-run and appended the first time.
 */
export function mergeNotesBlock(existing: string | null, planId: string, text: string): string {
  const { start, end } = notesBlockMarkers(planId);
  const block = `${start}\n${text.trim()}\n${end}`;
  const current = existing ?? '';
  const s = current.indexOf(start);
  const e = current.indexOf(end);
  if (s !== -1 && e !== -1 && e > s) {
    return current.slice(0, s) + block + current.slice(e + end.length);
  }
  return current.trim() === '' ? block : `${current.replace(/\s+$/, '')}\n\n${block}`;
}

function normaliseTenancyValue(field: TenancyUpdatable, value: string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  if (field === 'rentAmount' || field === 'depositAmount') {
    try {
      return new Decimal(value).toFixed(2);
    } catch {
      return value;
    }
  }
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
}

function tenancyRowValue(row: TenancyRow, field: TenancyUpdatable): string | null {
  return normaliseTenancyValue(field, row[field]);
}

function periodsOverlap(
  a: { start: string; end: string | null },
  b: { start: string; end: string | null },
): boolean {
  // The rent schedule treats end_date as inclusive for the last due date.
  return a.start <= (b.end ?? '9999-12-31') && b.start <= (a.end ?? '9999-12-31');
}

export function planChanges(plan: Plan, state: DbState): PlanResult {
  const result: PlanResult = { refusals: [], changes: [], skips: [], blocked: [], warnings: [] };

  // ---------------------------------------------------------------- owner
  const owner: OwnerRow | undefined = state.owners.find(o => o.name === plan.owner);
  if (!owner) {
    result.refusals.push(
      `Owner "${plan.owner}" does not exist (matched by exact name). Owners that exist: ${listNames(state.owners.map(o => o.name))}.`,
    );
  }

  // ----------------------------------------------------------- properties
  const resolvedProperties = new Map<string, PropertyRow>();
  for (const section of plan.properties) {
    const property = state.properties.find(p => p.name === section.name);
    if (!property) {
      result.refusals.push(
        `Property "${section.name}" does not exist (matched by exact name). Properties that exist: ${listNames(state.properties.map(p => p.name))}.`,
      );
      continue;
    }
    resolvedProperties.set(section.name, property);
    if (owner && !state.ownership.some(o => o.propertyId === property.id && o.ownerId === owner.id)) {
      const owners = state.ownership.filter(o => o.propertyId === property.id).map(o => o.ownerName);
      result.refusals.push(
        `Owner "${owner.name}" is not an owner of "${property.name}", so the owner tax report would never include it. Owners of this property: ${listNames(owners)}.`,
      );
    }
  }

  // ------------------------------------------------------ system accounts
  const anyIncluded = (pick: (s: PropertySection) => { include: boolean }[]) =>
    plan.properties.some(s => pick(s).some(i => i.include));
  const mortgageInterestAccount = state.accounts.find(
    a => a.name === MORTGAGE_INTEREST_ACCOUNT && a.accountType === 'EXPENSE' && a.isSystem,
  );
  if (anyIncluded(s => s.mortgageInterest) && !mortgageInterestAccount) {
    result.refusals.push(
      `The system account "${MORTGAGE_INTEREST_ACCOUNT}" (EXPENSE, is_system = true) is missing, and the tax report identifies mortgage interest by it. Run "npm run db:migrate" first.`,
    );
  }
  const propertyExpensesAccount = state.accounts.find(
    a => a.name === PROPERTY_EXPENSES_ACCOUNT && a.accountType === 'EXPENSE' && a.isSystem,
  );
  if (anyIncluded(s => s.expenses) && !propertyExpensesAccount) {
    result.refusals.push(
      `The system account "${PROPERTY_EXPENSES_ACCOUNT}" (EXPENSE, is_system = true) is missing. Run "npm run db:migrate" first.`,
    );
  }

  if (result.refusals.length > 0 || !owner) return result;

  // ------------------------------------------------------------- helpers
  const subtree = propertyExpenseSubtree(state.categories);
  const allLines = [...state.taggedLines, ...state.candidateLines];
  const referencePrefix = `plan:${plan.planId}:`;

  const refMap = new Map<string, typeof state.referencedJournals>();
  for (const j of state.referencedJournals) {
    const list = refMap.get(j.reference) ?? [];
    list.push(j);
    refMap.set(j.reference, list);
  }

  // Journals that belong to this plan are never fuzzy-matched by other items.
  const claimed = new Set<number>(
    state.referencedJournals.filter(j => j.reference.startsWith(referencePrefix)).map(j => j.journalId),
  );

  const skip = (itemId: string, label: string, reason: SkipReason, detail: string) => {
    result.skips.push({ itemId, label, reason, detail } satisfies Skip);
  };
  const block = (itemId: string, label: string, reason: string) => {
    result.blocked.push({ itemId, label, reason } satisfies Blocked);
  };

  const resolveAccount = (alias: string, expected: AccountType) =>
    resolveAccountAlias(plan.accounts, state.accounts, alias, expected);

  const resolveCategory = (
    name: string | null,
    scope: 'property_expenses' | 'any',
  ): { category: CategoryRow | null } | { error: string } => {
    if (name === null) return { category: null };
    const pool = scope === 'property_expenses' ? subtree : state.categories;
    const matches = pool.filter(c => c.name === name);
    if (matches.length === 1) return { category: matches[0] };
    if (matches.length > 1) {
      const topLevel = matches.filter(c => c.parentId === null);
      if (topLevel.length === 1) return { category: topLevel[0] };
      return { error: `category "${name}" is ambiguous (${matches.length} categories share that name)` };
    }
    const hint =
      scope === 'property_expenses'
        ? `Categories under "${PROPERTY_EXPENSES_ROOT_CATEGORY}": ${listNames(subtree.map(c => c.name))}.`
        : `Categories that exist: ${listNames(state.categories.map(c => c.name))}.`;
    return {
      error:
        scope === 'property_expenses'
          ? `category "${name}" is not in the "${PROPERTY_EXPENSES_ROOT_CATEGORY}" subtree. ${hint}`
          : `category "${name}" does not exist. ${hint}`,
    };
  };

  // ------------------------------------------------- plan-internal clashes
  const seenKeys = new Map<string, string>();
  for (const section of plan.properties) {
    const groups: Array<[JournalKind, Array<IncomeItem | ExpenseItem | MortgageInterestItem>]> = [
      ['income', section.income],
      ['expense', section.expenses],
      ['mortgage_interest', section.mortgageInterest],
    ];
    for (const [kind, items] of groups) {
      for (const it of items) {
        if (!it.include) continue;
        const key = `${section.name}|${kind}|${it.date}|${money2(it.amount!)}`;
        const prev = seenKeys.get(key);
        if (prev) {
          result.warnings.push(
            `Plan items "${prev}" and "${it.id}" are identical (${kind} ${formatGbp(it.amount!)} on ${it.date} for ${section.name}); both will be created. Is one a mistake?`,
          );
        } else {
          seenKeys.set(key, it.id);
        }
      }
    }
  }

  // ------------------------------------------------------------ properties
  for (const section of plan.properties) {
    const property = resolvedProperties.get(section.name)!;

    // Letting type -------------------------------------------------------
    if (section.lettingType) {
      const it = section.lettingType;
      const label = `letting type of ${property.name} -> ${it.value}`;
      if (!it.include) {
        skip(it.id, label, 'excluded', `include is false. ${it.note}`);
      } else if (state.pendingMigration?.lettingType) {
        skip(it.id, label, 'pending_migration', `${PENDING_MIGRATION_NOTE} (properties.letting_type does not exist yet, so the current value is unknown). Would set '${it.value}'`);
      } else if (property.lettingType === it.value) {
        skip(it.id, label, 'unchanged', `already "${it.value}"`);
      } else {
        result.changes.push({
          type: 'letting_type',
          itemId: it.id,
          propertyId: property.id,
          propertyName: property.name,
          from: property.lettingType,
          to: it.value,
        });
      }
    }

    // Tenancies ----------------------------------------------------------
    for (const t of section.tenancies) {
      planTenancy(t, property);
    }

    // Journals -----------------------------------------------------------
    for (const it of section.income) planJournal('income', it, property);
    for (const it of section.expenses) planJournal('expense', it, property);
    for (const it of section.mortgageInterest) planJournal('mortgage_interest', it, property);
  }

  // Owner tax profile ------------------------------------------------------
  planTaxProfile();

  return result;

  // ======================================================================
  // tenancies
  // ======================================================================
  function planTenancy(t: TenancyItem, property: PropertyRow) {
    const label = `tenancy ${t.fields.tenantName?.value ?? '(unnamed)'} starting ${t.startDate ?? '(unknown)'} at ${property.name}`;
    if (!t.include) {
      skip(t.id, label, 'excluded', `include is false. ${t.note}`);
      return;
    }
    const startDate = t.startDate as string; // schema guarantees non-null when included
    const existing = state.tenancies.filter(r => r.propertyId === property.id && r.startDate === startDate);

    if (existing.length > 1) {
      block(
        t.id,
        label,
        `${existing.length} tenancies already exist at ${property.name} starting ${startDate} (ids ${existing.map(e => `#${e.id}`).join(', ')}); cannot tell which to update. Resolve in the app first.`,
      );
      return;
    }

    if (existing.length === 0) {
      const f = t.fields;
      const values: TenancyValues = {
        tenantName: f.tenantName!.value,
        startDate,
        endDate: f.endDate?.value ?? null,
        rentAmount: money2(f.rentAmount!.value),
        rentFrequency: f.rentFrequency?.value ?? 'monthly',
        depositAmount: f.depositAmount?.value != null ? money2(f.depositAmount.value) : null,
        notes: f.notes?.value ?? null,
      };
      const overlaps = state.tenancies.filter(
        r =>
          r.propertyId === property.id &&
          periodsOverlap({ start: values.startDate, end: values.endDate }, { start: r.startDate, end: r.endDate }),
      );
      if (overlaps.length > 0 && !t.allowOverlap) {
        block(
          t.id,
          label,
          `new tenancy ${values.startDate} to ${values.endDate ?? 'open'} overlaps existing ${overlaps
            .map(o => `#${o.id} "${o.tenantName}" (${o.startDate} to ${o.endDate ?? 'open'})`)
            .join(', ')} at ${property.name}. The rent schedule counts every tenancy, so the overlap would be counted twice (end_date is inclusive, so a shared boundary day counts too). Fix the dates, or set allowOverlap: true on this item.`,
        );
        return;
      }
      result.changes.push({
        type: 'tenancy_create',
        itemId: t.id,
        propertyId: property.id,
        propertyName: property.name,
        values,
      });
      return;
    }

    const row = existing[0];
    const diffs: FieldDiff[] = [];
    const set: Partial<Omit<TenancyValues, 'startDate'>> = {};
    const before: Partial<Record<TenancyUpdatable, string | null>> = {};
    for (const field of TENANCY_FIELDS) {
      const planned = t.fields[field];
      if (!planned) continue;
      const plannedValue = normaliseTenancyValue(field, planned.value);
      const currentValue = tenancyRowValue(row, field);
      if (plannedValue === currentValue) continue;
      diffs.push({ field, current: currentValue, planned: plannedValue, willUpdate: planned.update });
      if (planned.update) {
        (set as Record<string, string | null>)[field] = plannedValue;
        before[field] = row[field] ?? null;
      }
    }

    if (diffs.length === 0) {
      skip(t.id, label, 'unchanged', `tenancy #${row.id} already exists and matches the plan`);
      return;
    }
    if (Object.keys(set).length === 0) {
      skip(
        t.id,
        label,
        'no_updates_allowed',
        `tenancy #${row.id} exists; differs from the plan in ${diffs
          .map(d => `${d.field} (db ${d.current ?? 'null'}, plan ${d.planned ?? 'null'})`)
          .join('; ')}; none of those fields is marked update: true, so nothing is changed`,
      );
      return;
    }
    const resultingEnd = 'endDate' in set ? (set.endDate ?? null) : row.endDate;
    for (const other of state.tenancies.filter(r => r.propertyId === property.id && r.id !== row.id)) {
      if (periodsOverlap({ start: row.startDate, end: resultingEnd }, { start: other.startDate, end: other.endDate })) {
        result.warnings.push(
          `Tenancy #${row.id} (${row.startDate} to ${resultingEnd ?? 'open'}) overlaps tenancy #${other.id} "${other.tenantName}" (${other.startDate} to ${other.endDate ?? 'open'}) at ${property.name}; the overlap is counted twice in the rent schedule.`,
        );
      }
    }
    result.changes.push({
      type: 'tenancy_update',
      itemId: t.id,
      propertyId: property.id,
      propertyName: property.name,
      tenancyId: row.id,
      startDate,
      set,
      diffs,
      before,
    });
  }

  // ======================================================================
  // journal items (income / expenses / mortgage interest)
  // ======================================================================
  function planJournal(
    kind: JournalKind,
    item: IncomeItem | ExpenseItem | MortgageInterestItem,
    property: PropertyRow,
  ) {
    const kindWord = kind === 'mortgage_interest' ? 'mortgage interest' : kind;
    const itemDescription = 'description' in item ? item.description : `Mortgage payment - ${item.lender}`;
    const label = `${kindWord} ${item.amount === null ? '(amount unknown)' : formatGbp(item.amount)} on ${item.date}: ${itemDescription}`;
    if (!item.include) {
      skip(item.id, label, 'excluded', `include is false. ${item.note}`);
      return;
    }

    const amount = money2(item.amount!); // schema: amount is non-null when include is true
    const reference = itemReference(plan.planId, item.id);

    // Resolve the category up front so a bad name is reported even when the
    // item turns out to be skippable.
    let category: CategoryRow | null = null;
    if (kind === 'expense' || kind === 'income') {
      const wantedName = 'category' in item ? item.category : null;
      const r = resolveCategory(wantedName, kind === 'expense' ? 'property_expenses' : 'any');
      if ('error' in r) {
        block(item.id, label, r.error);
        return;
      }
      category = r.category;
    }

    // 1. Already loaded by this plan (reference match) ---------------------
    const loaded = refMap.get(reference);
    if (loaded && loaded.length > 0) {
      const j = [...loaded].sort((a, b) => a.journalId - b.journalId)[0];
      const loadedAmount = j.amount === null ? null : new Decimal(j.amount).abs().toFixed(2);
      skip(
        item.id,
        label,
        'already_loaded',
        `already present: journal #${j.journalId} ${j.date} ${loadedAmount ? formatGbp(loadedAmount) : '(no income/expense leg)'} (reference ${reference})`,
      );
      if (loaded.length > 1) {
        result.warnings.push(`Reference ${reference} is on ${loaded.length} journals (${loaded.map(l => `#${l.journalId}`).join(', ')}); expected one.`);
      }
      if (loadedAmount !== null && loadedAmount !== amount) {
        result.warnings.push(
          `Journal #${j.journalId} (${reference}) holds ${formatGbp(loadedAmount)} but the plan now says ${formatGbp(amount)}. The loader never edits an existing journal; correct it in the app.`,
        );
      }
      if (j.propertyId !== property.id) {
        result.warnings.push(
          `Journal #${j.journalId} (${reference}) is tagged to property id ${j.propertyId ?? 'none'}, not ${property.name}.`,
        );
      }
      return;
    }

    // 2. Likely duplicates not created by the loader ----------------------
    const alternateAmounts = 'alternateAmounts' in item ? item.alternateAmounts.map(money2) : [];
    const matches = findMatches(allLines, {
      kind,
      propertyId: property.id,
      date: item.date,
      amount,
      alternateAmounts,
      windowDays: plan.dedupe.windowDays,
      claimedJournalIds: claimed,
    });
    const describeMatch = (m: Match) => {
      const l = m.line;
      const amt = formatGbp(new Decimal(l.amount).abs());
      const when = m.dayDiff === 0 ? 'same day' : `${m.dayDiff} day${m.dayDiff === 1 ? '' : 's'} from the plan date`;
      return `journal #${l.journalId} ${l.date} ${amt} on ${l.accountName} ("${l.description}"), ${when}`;
    };

    for (const m of matches.otherProperty) {
      result.warnings.push(
        `${item.id}: journal #${m.line.journalId} (${m.line.date}, ${formatGbp(new Decimal(m.line.amount).abs())}) has a matching amount but is tagged to property id ${m.line.propertyId}; ignored.`,
      );
    }

    if (matches.tagged.length > 0) {
      const m = matches.tagged[0];
      claimed.add(m.line.journalId);
      let detail = `already present: ${describeMatch(m)}, already tagged to ${property.name}`;
      if (m.line.isTransfer) {
        detail += '. WARNING: it is flagged as an inter-account transfer, which the tax report ignores, so this item is NOT in the totals';
        result.warnings.push(
          `${item.id}: journal #${m.line.journalId} is flagged is_transfer, so the tax report ignores it; the item is still missing from the totals.`,
        );
      }
      if (kind === 'mortgage_interest' && !isMortgageInterestLine(m.line)) {
        detail += `. WARNING: it is booked to "${m.line.accountName}", not "${MORTGAGE_INTEREST_ACCOUNT}", so the tax report counts it as an ordinary expense`;
        result.warnings.push(
          `${item.id}: journal #${m.line.journalId} looks like this mortgage payment but is booked to "${m.line.accountName}", so the report treats it as a deductible expense instead of finance cost.`,
        );
      }
      if (matches.tagged.length > 1) detail += ` (+${matches.tagged.length - 1} more match)`;
      skip(item.id, label, 'duplicate_tagged', detail);
      return;
    }

    if (matches.differentAmount.length > 0) {
      const m = matches.differentAmount[0];
      claimed.add(m.line.journalId);
      skip(
        item.id,
        label,
        'different_amount',
        `already recorded: ${describeMatch(m)}, tagged to ${property.name}, but for ${formatGbp(new Decimal(m.line.amount).abs())} rather than the plan's ${formatGbp(amount)}. Not added: the estimate would count that payment twice. If the recorded figure is wrong, correct it in the app`,
      );
      return;
    }

    if (matches.alternate.length > 0) {
      const m = matches.alternate[0];
      claimed.add(m.line.journalId);
      skip(
        item.id,
        label,
        'alternate_amount',
        `possible existing record of the same money: ${describeMatch(m)}${m.line.propertyId === null ? ', untagged' : ''}. It matches an alternate amount (not ${formatGbp(amount)}), so creating this item would double-count the cash. Review it in the app, or delete alternateAmounts from this plan item to create anyway`,
      );
      return;
    }

    if (matches.untagged.length > 0) {
      const m = matches.untagged[0];
      claimed.add(m.line.journalId);
      const allowTag =
        (kind === 'income' || kind === 'expense') && 'tagExisting' in item && item.tagExisting && !m.line.isTransfer;
      if (allowTag) {
        const hasCategory = m.line.categoryId !== null;
        result.changes.push({
          type: 'journal_tag',
          itemId: item.id,
          kind,
          propertyId: property.id,
          propertyName: property.name,
          journalId: m.line.journalId,
          date: m.line.date,
          description: m.line.description,
          accountName: m.line.accountName,
          amount: new Decimal(m.line.amount).abs().toFixed(2),
          setCategoryId: !hasCategory && category ? category.id : null,
          setCategoryName: !hasCategory && category ? category.name : null,
        });
        if (hasCategory && category && m.line.categoryId !== category.id) {
          result.warnings.push(
            `${item.id}: journal #${m.line.journalId} keeps its existing category (plan wanted "${category.name}"); only the property tag is added.`,
          );
        }
        if (matches.untagged.length > 1) {
          result.warnings.push(
            `${item.id}: ${matches.untagged.length} untagged journals match (${matches.untagged.map(x => `#${x.line.journalId}`).join(', ')}); tagging the closest, #${m.line.journalId}.`,
          );
        }
      } else {
        const why = m.line.isTransfer
          ? 'it is flagged as an inter-account transfer, which the tax report ignores, so tagging it would not make it count'
          : kind === 'mortgage_interest'
            ? 'tagging it would leave the payment in an ordinary expense account, where the report treats it as a deductible expense instead of finance cost'
            : 'this plan item does not allow tagging an existing journal (tagExisting is false)';
        const remedy = m.line.isTransfer
          ? 'Un-flag the transfer in the app if it is really a property payment'
          : kind === 'mortgage_interest'
            ? 'Re-book that payment to Mortgage Interest in the app, or leave it out of the plan'
            : 'Tag it in the app, or set tagExisting: true on this plan item';
        skip(
          item.id,
          label,
          'duplicate_untagged',
          `likely duplicate: ${describeMatch(m)}, untagged. Not created and not tagged: ${why}. ${remedy}`,
        );
      }
      return;
    }

    // 3. Create -----------------------------------------------------------
    let legs: Leg[];
    let description = itemDescription;
    if (kind === 'expense') {
      const paid = resolveAccount((item as ExpenseItem).paidFrom, 'ASSET');
      if ('error' in paid) return block(item.id, label, paid.error);
      legs = [
        { accountId: paid.account.id, accountName: paid.account.name, amount: new Decimal(amount).neg().toFixed(2) },
        { accountId: propertyExpensesAccount!.id, accountName: propertyExpensesAccount!.name, amount },
      ];
    } else if (kind === 'income') {
      const inc = item as IncomeItem;
      const into = resolveAccount(inc.receivedInto, 'ASSET');
      if ('error' in into) return block(item.id, label, into.error);
      const incomeAccount = resolveAccount(inc.incomeAccount, 'INCOME');
      if ('error' in incomeAccount) return block(item.id, label, incomeAccount.error);
      legs = [
        { accountId: into.account.id, accountName: into.account.name, amount },
        { accountId: incomeAccount.account.id, accountName: incomeAccount.account.name, amount: new Decimal(amount).neg().toFixed(2) },
      ];
    } else {
      const mi = item as MortgageInterestItem;
      const paid = resolveAccount(mi.paidFrom, 'ASSET');
      if ('error' in paid) return block(item.id, label, paid.error);
      const propertyMortgages = state.mortgages.filter(m => m.propertyId === property.id);
      let lender = mi.lender;
      if (propertyMortgages.length === 1) {
        // Like the bulk-payments tool: with one mortgage on the property, use it.
        lender = propertyMortgages[0].lender;
        if (lender.trim().toLowerCase() !== mi.lender.trim().toLowerCase()) {
          result.warnings.push(
            `${item.id}: plan lender "${mi.lender}" differs from the property's only mortgage, "${lender}"; using the mortgage record's name.`,
          );
        }
      } else if (propertyMortgages.length > 1) {
        const hit = propertyMortgages.find(m => m.lender.trim().toLowerCase() === mi.lender.trim().toLowerCase());
        if (!hit) {
          return block(
            item.id,
            label,
            `lender "${mi.lender}" matches none of the ${propertyMortgages.length} mortgages on ${property.name}: ${listNames(propertyMortgages.map(m => m.lender))}.`,
          );
        }
        lender = hit.lender;
      } else {
        result.warnings.push(`${item.id}: ${property.name} has no mortgage record; the description uses the plan's lender text.`);
      }
      // Same description the mortgage tracker writes; btl-profitability
      // finds recorded payments by this prefix.
      description = `Mortgage payment - ${lender}`;
      legs = [
        { accountId: paid.account.id, accountName: paid.account.name, amount: new Decimal(amount).neg().toFixed(2) },
        { accountId: mortgageInterestAccount!.id, accountName: mortgageInterestAccount!.name, amount },
      ];
    }

    result.changes.push({
      type: 'journal_create',
      itemId: item.id,
      kind,
      propertyId: property.id,
      propertyName: property.name,
      date: item.date,
      description,
      reference,
      categoryId: category?.id ?? null,
      categoryName: category?.name ?? null,
      amount,
      legs,
    });
  }

  // ======================================================================
  // owner tax profile
  // ======================================================================
  function planTaxProfile() {
    const section = plan.ownerTaxProfile;
    if (!section) return;
    if (state.pendingMigration?.taxProfile) {
      // The table does not exist yet: nothing can be compared or written.
      const pending = (itemId: string, label: string, include: boolean, note: string) => {
        if (!include) skip(itemId, label, 'excluded', `include is false. ${note}`);
        else skip(itemId, label, 'pending_migration', `${PENDING_MIGRATION_NOTE} (owner_tax_profiles does not exist yet)`);
      };
      for (const it of section.items) pending(it.id, `tax profile ${it.field} = ${formatGbp(it.value)}`, it.include, it.note);
      if (section.notes) pending(section.notes.id, 'tax profile notes', section.notes.include, section.notes.note);
      return;
    }
    const existing = state.taxProfile;
    const set: Partial<Record<TaxProfileField, string>> = {};
    const previous: Partial<Record<TaxProfileField, string>> = {};
    const itemIds: string[] = [];

    for (const it of section.items) {
      const label = `tax profile ${it.field} = ${formatGbp(it.value)}`;
      if (!it.include) {
        skip(it.id, label, 'excluded', `include is false. ${it.note}`);
        continue;
      }
      const planned = money2(it.value);
      const current = existing?.values[it.field];
      if (existing && decimalEquals(current, planned)) {
        skip(it.id, label, 'unchanged', `already ${formatGbp(planned)}`);
        continue;
      }
      set[it.field] = planned;
      if (existing && current !== undefined) previous[it.field] = current;
      itemIds.push(it.id);
    }

    let notes: string | null = null;
    if (section.notes) {
      const n = section.notes;
      const label = 'tax profile notes';
      if (!n.include) {
        skip(n.id, label, 'excluded', `include is false. ${n.note}`);
      } else {
        const merged = mergeNotesBlock(existing?.notes ?? null, plan.planId, n.value);
        if (merged.length > 2000) {
          result.warnings.push(
            `Tax profile notes would be ${merged.length} characters; the app's tax-profile form accepts at most 2,000, so saving the profile in the UI would be rejected until the notes are shortened.`,
          );
        }
        if (existing && merged === (existing.notes ?? '')) {
          skip(n.id, label, 'unchanged', 'notes block already up to date');
        } else {
          notes = merged;
          itemIds.push(n.id);
        }
      }
    }

    if (Object.keys(set).length === 0 && notes === null) return;
    result.changes.push({
      type: 'tax_profile',
      itemIds,
      ownerId: owner!.id,
      ownerName: owner!.name,
      taxYear: plan.taxYear,
      existed: existing !== null,
      set,
      previous: existing ? previous : null,
      notes,
      previousNotes: existing?.notes ?? null,
    });
  }
}
