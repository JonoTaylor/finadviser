import Decimal from 'decimal.js';
import { cashExclusionReason } from '@/lib/finance-context/schema';
import { pensionRecordOwnerId, pensionRecordPot } from '@/lib/pension-records/summary';
import type { PensionAccount } from '@/lib/pension-records/schema';
import type { DataCoverage, DataDomain, DataGap, DataIntelligenceInput, DataIntelligenceReport } from './types';

const domains: { domain: DataDomain; label: string; source: string; href: string }[] = [
  { domain: 'transactions', label: 'Transactions', source: 'Recorded journal postings', href: '/import' },
  { domain: 'context', label: 'Personal context', source: 'Saved context and ledger account ownership', href: '/profile' },
  { domain: 'planning', label: 'Planning assumptions', source: 'Saved financial planning profile', href: '/plan' },
  { domain: 'debts', label: 'Debt details', source: 'Debt records and linked liability accounts', href: '/debts' },
  { domain: 'portfolio', label: 'Investments', source: 'Recorded holdings and investment accounts', href: '/portfolio' },
  { domain: 'pensions', label: 'Pension records', source: 'Pension inventory and linked ledger accounts', href: '/pensions/records' },
  { domain: 'properties', label: 'Property records', source: 'Recorded properties, tenancies, valuations and reserve targets', href: '/properties/operations' },
];
const dayAge = (date: string, asOf: string) => (Date.parse(`${asOf}T00:00:00Z`) - Date.parse(`${date}T00:00:00Z`)) / 86_400_000;
export function completedRecentMonths(asOf: string): string[] {
  const date = new Date(`${asOf}T00:00:00Z`);
  return [3, 2, 1].map(offset => new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() - offset, 1)).toISOString().slice(0, 7));
}

/** Deterministic evidence, not inferred personal facts or model-generated advice. */
export function buildDataIntelligence(input: DataIntelligenceInput, modelAvailable = false): DataIntelligenceReport {
  const gaps: DataGap[] = [];
  const coverage: DataCoverage[] = [];
  const metadata = (domain: DataDomain) => domains.find(item => item.domain === domain)!;
  const add = (domain: DataDomain, id: string, priority: DataGap['priority'], status: DataGap['status'], title: string, reason: string, evidence: string[], affectedCount: number | null, label: string, href = metadata(domain).href, kind: DataGap['action']['kind'] = 'review') => {
    gaps.push({ id, domain, source: metadata(domain).source, priority, status, title, reason, evidence, affectedCount, action: { label, href, kind } });
  };
  const record = (domain: DataDomain, count: number, evidence: string[]) => {
    const domainGaps = gaps.filter(gap => gap.domain === domain);
    const status: DataCoverage['status'] = count === 0 ? 'empty' : domainGaps.some(gap => gap.status === 'missing' || gap.status === 'incomplete' || gap.status === 'unavailable') ? 'incomplete' : domainGaps.some(gap => gap.status === 'stale') ? 'stale' : 'recorded';
    const { label, source } = metadata(domain);
    coverage.push({ domain, label, source, status, recordCount: count, evidence });
  };
  const unavailable = (domain: DataDomain) => {
    const { label, source } = metadata(domain);
    coverage.push({ domain, label, source, status: 'unavailable', recordCount: null, evidence: ['This source could not be read. Its records and missing inputs remain unknown.'] });
    add(domain, `${domain}-unavailable`, 'high', 'unavailable', `Review unavailable ${label.toLowerCase()}`, 'The adviser needs this source before it can assess coverage or use its figures.', ['Unavailable does not mean empty or zero.'], null, 'Open and retry');
  };
  const expectedMonths = completedRecentMonths(input.asOf);
  let transactions: DataIntelligenceReport['transactions'];
  if (input.ledger.status === 'unavailable') {
    unavailable('transactions');
    transactions = { status: 'unavailable', totalCount: null, uncategorisedCount: null, reviewNeededCount: null, eligibleCount: null, unprocessedCount: null, transferReviewCount: null, latestDate: null, recentMonths: [], missingRecentMonths: [] };
  } else {
    const ledger = input.ledger.data;
    const missingMonths = expectedMonths.filter(month => !ledger.recentMonths.includes(month));
    transactions = { status: 'ready', ...ledger, missingRecentMonths: missingMonths };
    if (ledger.reviewNeededCount === null || ledger.unprocessedCount === null) add('transactions', 'category-queue-unavailable', 'high', 'unavailable', 'Reload the category processing queue', 'Recorded transaction coverage is available, but the category decision backlog could not be checked.', ['Pending and unprocessed category counts remain unknown.'], null, 'Open and retry', '/data');
    if (ledger.totalCount === 0) add('transactions', 'transactions-empty', 'high', 'missing', 'Load your account statements', 'Recorded transactions are needed to find spending patterns and produce a useful cashflow plan.', ['No journal postings were recorded on or before the report date.'], 0, 'Import statements', '/import', 'upload');
    else {
      if (ledger.unprocessedCount !== null && ledger.unprocessedCount > 0) add('transactions', 'transactions-uncategorised', 'high', 'incomplete', 'Categorise the remaining transactions', 'Uncategorised income and expense postings make spending breakdowns less useful. AI can process eligible records and flag uncertain decisions.', [`${ledger.unprocessedCount} eligible income or expense postings have not been processed.`, `${ledger.uncategorisedCount} total non-transfer postings have no category; this includes records outside the processing queue.`], ledger.unprocessedCount, 'Process transactions', '/data');
      if (ledger.reviewNeededCount !== null && ledger.reviewNeededCount > 0) add('transactions', 'transactions-review', 'high', 'incomplete', 'Resolve uncertain category suggestions', 'These suggestions need confirmation before they can improve your spending breakdown.', [`${ledger.reviewNeededCount} pending category decisions.`], ledger.reviewNeededCount, 'Review suggestions', '/data', 'confirm');
      if (ledger.transferReviewCount > 0) add('transactions', 'transfers-review', 'high', 'incomplete', 'Confirm possible account transfers', 'Unresolved transfer pairs may distort spending. Confirm the evidence before treating a payment as a transfer.', [`${ledger.transferReviewCount} pending transfer groups.`], ledger.transferReviewCount, 'Review transfers', '/transactions/transfers', 'confirm');
      if (missingMonths.length) add('transactions', 'transactions-months', 'high', 'incomplete', 'Fill the recent statement gaps', 'Monthly comparisons need activity across the last three completed months. A month without postings is missing evidence, rather than proven zero spending.', [`Completed months without recorded income or expense activity: ${missingMonths.join(', ')}.`, 'A month with activity does not prove that every account or statement was imported.'], missingMonths.length, 'Import missing statements', '/import', 'upload');
      if (ledger.latestDate !== null && dayAge(ledger.latestDate, input.asOf) > 30) add('transactions', 'transactions-stale', 'medium', 'stale', 'Bring your transactions up to date', 'The most recent recorded posting is more than 30 days old. Check whether newer statements are available.', [`Latest posting: ${ledger.latestDate}.`, 'This is a freshness check, not proof that a bank connection failed.'], null, 'Import newer statements', '/import', 'upload');
    }
    record('transactions', ledger.totalCount, [`${ledger.totalCount} recorded postings through ${input.asOf}; confirmed transfers are excluded from categorisation counts.`, `${ledger.recentMonths.filter(month => expectedMonths.includes(month)).length} of 3 completed months contain income or expense activity.`, 'Raw uncategorised counts can include opening balances, valuations or pending transfers; these are not automatically processed as spending.', 'Coverage describes the recorded household, not verified bank statement completeness.']);
  }
  if (input.context.status === 'unavailable') unavailable('context');
  else {
    const { data, saved, lookup } = input.context.data;
    const unknownOwner = data.ownerId === null || !lookup.owners.some(owner => owner.id === data.ownerId);
    if (!saved || unknownOwner) add('context', 'context-owner', 'high', 'missing', 'Confirm whose finances to advise on', 'Personal figures need an explicitly selected ledger owner. Household records are not automatically Jono’s personal assets or debts.', [!saved ? 'Personal context has not been saved.' : 'The selected owner is missing or no longer recorded.'], null, 'Confirm your context', undefined, 'confirm');
    const ownershipUnknown = lookup.accounts.filter(account => account.ownerId === null && account.postingCount > 0);
    if (ownershipUnknown.length) add('context', 'account-ownership', 'medium', 'incomplete', 'Review shared and unassigned accounts', 'Unassigned accounts may be shared. Keep them unassigned when appropriate; confirm ownership before using a personal balance.', [`${ownershipUnknown.length} accounts with postings have no individual owner.`], ownershipUnknown.length, 'Review account ownership', '/settings');
    const cashUnknown = lookup.accounts.filter(account => cashExclusionReason(account) === null && !data.accountAccessibility.some(override => override.accountId === account.id));
    if (cashUnknown.length) add('context', 'cash-access', 'medium', 'incomplete', 'Confirm which cash you can access', 'Account names cannot establish whether money is available for an emergency. Confirm access restrictions from your account terms.', [`${cashUnknown.length} eligible cash accounts have no saved accessibility confirmation.`, 'Pensions, property equity and market investments are excluded from emergency cash.'], cashUnknown.length, 'Confirm cash access', undefined, 'confirm');
    const unknown = [data.taxResidence === null ? 'UK tax residence' : null, data.dependants === null ? 'dependants' : null, data.employmentStability === null ? 'income stability' : null].filter((value): value is string => value !== null);
    if (unknown.length) add('context', 'context-background', 'medium', 'missing', 'Add the context behind your finances', 'These facts affect how useful planning guidance can be. No residence, dependant count or employment stability is inferred from transactions.', [`Not recorded: ${unknown.join(', ')}.`], unknown.length, 'Complete personal context', undefined, 'confirm');
    if (data.nextReviewDate !== null && data.nextReviewDate <= input.asOf) add('context', 'review-due', 'medium', 'stale', 'Your financial review is due', 'Revisit your saved priorities and records to check what has changed.', [`Saved review date: ${data.nextReviewDate}.`], null, 'Open your review', '/review');
    record('context', saved ? 1 : 0, [saved ? 'Personal context is saved.' : 'Personal context is not yet saved.', data.ownerId === null ? 'No personal owner selected; this report stays at household scope.' : `Saved owner ID: ${data.ownerId}; this report stays at household scope.`]);
  }
  if (input.planning.status === 'unavailable') unavailable('planning');
  else {
    const { saved } = input.planning.data;
    const profile = saved ? input.planning.data.profile : {};
    if (profile.essentialMonthlySpending == null) add('planning', 'essential-spending', 'high', 'missing', 'Confirm your essential monthly costs', 'An emergency reserve target needs essential spending. The adviser should not treat total observed spending as the amount you must spend.', ['Essential monthly spending is not recorded.'], null, 'Set essential costs', undefined, 'confirm');
    const suitability = [profile.investmentHorizonYears == null ? 'investment time horizon' : null, profile.riskTolerance == null ? 'risk tolerance' : null].filter((value): value is string => value !== null);
    if (suitability.length) add('planning', 'investment-context', 'medium', 'missing', 'Set the context for investment planning', 'Your time horizon and tolerance for losses are needed before discussing suitable investment trade-offs.', [`Not recorded: ${suitability.join(', ')}.`], suitability.length, 'Set planning assumptions', undefined, 'confirm');
    const retirement = [profile.currentAge == null ? 'current age' : null, profile.retirementAge == null ? 'target retirement age' : null, profile.targetRetirementIncome == null ? 'target retirement income' : null].filter((value): value is string => value !== null);
    if (retirement.length) add('planning', 'retirement-target', 'medium', 'missing', 'Define the retirement you want to plan for', 'A retirement scenario needs your own dates and income target. These are separate from any scheme statement or State Pension forecast.', [`Not recorded: ${retirement.join(', ')}.`], retirement.length, 'Set retirement assumptions', '/pensions', 'confirm');
    record('planning', saved ? 1 : 0, [saved ? 'Planning assumptions are saved.' : 'No planning profile has been saved.', 'A recorded value of zero is retained; missing amounts are not replaced with zero.']);
  }
  if (input.debts.status === 'unavailable') unavailable('debts');
  else {
    const { records, lookup } = input.debts.data;
    const outstandingAccounts = lookup.accounts.filter(account => account.accountType === 'LIABILITY' && new Decimal(account.balance).lt(0));
    const unmatched = outstandingAccounts.filter(account => !records.some(debt => debt.accountId === account.id));
    if (unmatched.length) add('debts', 'debts-unlinked', 'high', 'incomplete', 'Add details for recorded borrowing', 'A liability balance does not provide its APR, minimum payment or repayment restrictions.', [`${unmatched.length} liability accounts have amounts owed but no linked debt details.`], unmatched.length, 'Add debt details');
    const incomplete = records.filter(debt => {
      const account = debt.accountId === null ? null : lookup.accounts.find(account => account.id === debt.accountId);
      if (debt.accountId !== null && !account) return true;
      const owed = account ? new Decimal(account.balance).lt(0) : debt.statementBalance !== null && new Decimal(debt.statementBalance).gt(0);
      return owed && (debt.apr === null || debt.minimumPayment === null || (account ? account.ownerId === null : debt.ownerId === null));
    });
    if (incomplete.length) add('debts', 'debts-terms', 'high', 'incomplete', 'Complete debt rates and payment terms', 'Repayment projections need known rates, minimum payments, ownership and available source accounts.', [`${incomplete.length} debt records with money owed have unknown terms or ownership, or an unavailable account link.`], incomplete.length, 'Review debt statements');
    const futureStatements = records.filter(debt => debt.accountId === null && debt.statementAsOf !== null && debt.statementAsOf > input.asOf);
    if (futureStatements.length) add('debts', 'debts-future-statements', 'high', 'incomplete', 'Correct future-dated debt statements', 'A future statement cannot establish the amount owed on the report date. Confirm its source date before using it in a repayment plan.', [`${futureStatements.length} statement-only debt records are dated after ${input.asOf}.`], futureStatements.length, 'Correct statement dates');
    const stale = records.filter(debt => debt.accountId === null && debt.statementAsOf !== null && dayAge(debt.statementAsOf, input.asOf) > 30);
    if (stale.length) add('debts', 'debts-statements', 'medium', 'stale', 'Update the older debt statements', 'Statement-only balances more than 30 days old may omit new payments, interest or borrowing.', [`${stale.length} statement balances are more than 30 days old.`], stale.length, 'Update debt statements');
    record('debts', records.length, [`${records.length} recorded debt details; ${outstandingAccounts.length} liability accounts show an amount owed.`, 'An empty debt inventory does not confirm that you are debt-free.']);
  }
  if (input.portfolio.status === 'unavailable') unavailable('portfolio');
  else {
    const { data, lookup } = input.portfolio.data;
    const accounts = lookup.accounts.filter(account => account.accountType === 'ASSET' && account.isInvestment && account.investmentKind !== 'savings');
    const ids = new Set(accounts.map(account => account.id));
    const incomplete = accounts.filter(account => {
      const allocated = data.holdings.filter(holding => holding.accountId === account.id).reduce((sum, holding) => sum.plus(holding.value), new Decimal(0));
      return !allocated.eq(Decimal.max(account.balance, 0)) || new Decimal(account.balance).lt(0);
    });
    const orphanCount = data.holdings.filter(holding => !ids.has(holding.accountId) && !lookup.accounts.some(account => account.id === holding.accountId && account.isInvestment && account.accountType === 'ASSET')).length;
    if (incomplete.length || orphanCount) add('portfolio', 'portfolio-holdings', 'medium', 'incomplete', 'Explain what is held inside your investment accounts', 'Account balances do not show asset mix or concentration. Reconcile holdings to their recorded account balances without adding assets twice.', [`${incomplete.length} investment accounts do not reconcile to recorded holdings.`, `${orphanCount} holdings link to an unavailable investment account.`], incomplete.length + orphanCount, 'Review holdings');
    const missingFees = accounts.filter(account => !data.platforms.some(platform => platform.accountId === account.id && platform.feeRate !== null) || data.holdings.some(holding => holding.accountId === account.id && holding.feeRate === null));
    if (missingFees.length) add('portfolio', 'portfolio-fees', 'medium', 'missing', 'Record the investment fees you pay', 'Unknown platform or fund fees cannot be treated as free. Statement fees let the adviser explain the known cost of your investments.', [`${missingFees.length} investment accounts have unknown platform or holding fees.`], missingFees.length, 'Add investment fees');
    const stale = data.holdings.filter(holding => ids.has(holding.accountId) && dayAge(holding.valuationDate, input.asOf) > 30);
    if (stale.length) add('portfolio', 'portfolio-valuations', 'medium', 'stale', 'Refresh older holding valuations', 'Statement snapshots more than 30 days old may no longer match your current holdings. No live market prices are assumed.', [`${stale.length} holding valuations are more than 30 days old.`], stale.length, 'Update holding values');
    const future = data.holdings.filter(holding => holding.valuationDate > input.asOf);
    if (future.length) add('portfolio', 'portfolio-future-valuations', 'high', 'incomplete', 'Correct future-dated holding valuations', 'A future valuation cannot establish the value of a holding on the report date. Review the source statement before using the recorded allocation.', [`${future.length} holding valuations are dated after ${input.asOf}.`], future.length, 'Correct holding dates');
    record('portfolio', accounts.length, [`${accounts.length} recorded investment accounts excluding savings wrappers; ${data.holdings.filter(holding => ids.has(holding.accountId)).length} linked holdings.`, 'Holdings describe existing ledger assets and do not increase net worth.']);
  }
  if (input.pensions.status === 'unavailable') unavailable('pensions');
  else {
    const { records, lookup } = input.pensions.data;
    const accounts: PensionAccount[] = lookup.accounts.filter(account => account.accountType === 'ASSET' && account.isInvestment && account.investmentKind === 'pension').map(account => ({ id: account.id, name: account.name, ownerId: account.ownerId, ownerName: lookup.owners.find(owner => owner.id === account.ownerId)?.name ?? null, balance: account.balance, balanceAsOf: lookup.asOf }));
    const unmatched = accounts.filter(account => !records.some(record => record.type === 'dc' && record.linkedAccountId === account.id));
    if (records.length === 0 || unmatched.length) add('pensions', 'pensions-inventory', records.length === 0 ? 'medium' : 'high', 'missing', 'Add or confirm your pension inventory', 'Confirm which schemes you have, including any old workplace pensions. An empty inventory does not establish that you have no pensions.', [`${records.length} scheme records; ${unmatched.length} pension ledger accounts have no linked scheme details.`], unmatched.length || null, 'Review pension records');
    const incomplete = records.filter(record => {
      if (pensionRecordOwnerId(record, accounts) === null) return true;
      if (record.type === 'dc') {
        const pot = pensionRecordPot(record, accounts);
        return pot === null || new Decimal(pot).lt(0) || record.personalMonthlyContribution === null || record.employerMonthlyContribution === null || record.annualFeeRate === null || (record.linkedAccountId === null && record.statementAsOf === null);
      }
      return record.type === 'db' ? record.promisedAnnualIncome === null || record.startAge === null : record.forecastAnnualIncome === null || record.forecastSourceDate === null || record.startAge === null;
    });
    if (incomplete.length) add('pensions', 'pensions-details', 'medium', 'incomplete', 'Review the incomplete scheme facts', 'Record ownership, statement or forecast values, dates, contributions and relevant start ages from the source documents. Correct any negative linked pot balance before planning. Employer contributions, tax relief and entitlement are not inferred.', [`${incomplete.length} scheme records have missing fields, negative pot balances or unavailable links.`], incomplete.length, 'Complete pension details');
    const personalContext = input.context.status === 'ready' ? input.context.data : null;
    const selectedOwner = personalContext?.saved && personalContext.lookup.owners.some(owner => owner.id === personalContext.data.ownerId) ? personalContext.data.ownerId : null;
    if (selectedOwner !== null && !records.some(record => record.type === 'state' && record.ownerId === selectedOwner)) add('pensions', 'state-pension-forecast', 'medium', 'missing', 'Get your official State Pension forecast', 'Use your own forecast and qualifying-year conditions to inform retirement planning. The full published amount is not assumed.', [`No State Pension forecast is recorded for owner ${selectedOwner}.`], null, 'Record the official forecast', '/pensions/records', 'confirm');
    const stale = records.filter(record => {
      const date = record.type === 'state' ? record.forecastSourceDate : record.statementAsOf;
      return date !== null && dayAge(date, input.asOf) > 365;
    });
    if (stale.length) add('pensions', 'pensions-statements', 'medium', 'stale', 'Refresh pension statements and forecasts', 'Scheme information more than a year old may not reflect current benefits or contributions.', [`${stale.length} pension statement or forecast dates are more than 365 days old.`], stale.length, 'Update pension records');
    record('pensions', records.length, [`${records.length} schemes and ${accounts.length} tagged pension ledger accounts.`, 'Defined contribution pots, defined benefit annual income and State Pension forecasts remain separate records.']);
  }
  if (input.properties.status === 'unavailable') unavailable('properties');
  else {
    const { records, data } = input.properties.data;
    const missingValues = records.filter(property => property.valuationDate === null);
    if (missingValues.length) add('properties', 'property-valuations', 'medium', 'missing', 'Add the missing property valuations', 'A property without a dated valuation cannot support a complete equity estimate.', [`${missingValues.length} properties have no valuation dated on or before ${input.asOf}.`], missingValues.length, 'Review property records', '/properties');
    const missingOwnership = records.filter(property => property.ownershipCount === 0);
    if (missingOwnership.length) add('properties', 'property-ownership', 'high', 'missing', 'Record who owns each property', 'An unassigned property cannot establish your personal equity or rental tax position.', [`${missingOwnership.length} properties have no ownership records.`], missingOwnership.length, 'Review property ownership', '/properties');
    const missingReserve = records.filter(property => !data.reserveTargets.some(target => target.propertyId === property.id && target.targetAmount !== null));
    if (missingReserve.length) add('properties', 'property-reserves', 'medium', 'missing', 'Set property reserve targets', 'Property maintenance and vacancy reserves need your own targets. A blank reserve is unknown rather than zero.', [`${missingReserve.length} properties have no entered reserve target.`], missingReserve.length, 'Set property reserves');
    const noTenancy = records.filter(property => property.activeTenancyCount === 0);
    if (noTenancy.length) add('properties', 'property-tenancies', 'low', 'missing', 'Confirm current property use and tenancy details', 'The app cannot tell whether a property without an active tenancy is a home, vacant or has a missing rental agreement. Confirm its use before interpreting rent coverage.', [`${noTenancy.length} properties have no active recorded tenancy.`], noTenancy.length, 'Review properties', '/properties', 'confirm');
    const stale = records.filter(property => property.valuationDate !== null && dayAge(property.valuationDate, input.asOf) > 365);
    const unlinked = input.properties.data.unlinkedExpenseCount ?? 0;
    if (unlinked > 0) {
      // Linking is never automatic: a "Property expenses" category does not
      // say which property, or establish that a cost belongs to a rental.
      const single = records.length === 1 ? records[0] : null;
      add('properties', 'property-expenses-unlinked', 'medium', 'incomplete',
        records.length === 0 ? 'Add the property these expenses belong to' : 'Assign property expenses to a property',
        'These transactions are categorised as property expenses but are not linked to a property, so they appear on no property\'s tax-year report.',
        [`${unlinked} property-expense transactions have no property link.`, 'A property-expense category does not establish that a cost is tax-deductible.'],
        unlinked,
        records.length === 0 ? 'Add a property' : single ? `Review ${single.name} expenses` : 'Assign them in Transactions',
        records.length === 0 ? '/properties' : single ? `/properties/${single.id}` : '/transactions?unlinked=property-expenses',
        'confirm');
    }
    if (stale.length) add('properties', 'property-values-stale', 'low', 'stale', 'Review older property valuations', 'Valuations more than a year old may not reflect current property values. This does not establish a market price.', [`${stale.length} property valuations are more than 365 days old.`], stale.length, 'Review valuations', '/properties');
    record('properties', records.length, [`${records.length} property records.`, 'No recorded property does not prove that you own no property; homes are not assumed to be rentals.']);
  }
  const priority = { high: 0, medium: 1, low: 2 };
  gaps.sort((a, b) => priority[a.priority] - priority[b.priority] || domains.findIndex(item => item.domain === a.domain) - domains.findIndex(item => item.domain === b.domain) || a.id.localeCompare(b.id));
  const unavailableCount = coverage.filter(item => item.status === 'unavailable').length;
  return {
    version: 1, asOf: input.asOf, scope: 'household', status: unavailableCount === coverage.length ? 'unavailable' : unavailableCount > 0 || gaps.some(gap => gap.status === 'unavailable') ? 'partial' : 'ready', coverage, transactions, processing: { modelAvailable, reviewUrl: '/data' }, gaps,
    warnings: ['Recorded activity does not prove that every account, document or statement is complete.', 'This report finds missing evidence. It does not invent personal facts, automatically revalue assets or recommend financial products.', ...(transactions.status === 'ready' && transactions.reviewNeededCount === null ? ['The category review backlog could not be verified; it is not reported as zero.'] : [])],
  };
}
