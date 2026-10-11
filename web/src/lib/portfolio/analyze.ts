import Decimal from 'decimal.js';
import { ASSET_CLASSES, type PortfolioAccount, type PortfolioData } from './schema';

const sum = (values: string[]) => values.reduce((total, value) => total.plus(value), new Decimal(0));
const money = (value: Decimal) => value.toDecimalPlaces(2, Decimal.ROUND_HALF_UP).toFixed(2);
const percent = (part: Decimal, total: Decimal) => total.gt(0) ? part.div(total).times(100).toDecimalPlaces(2).toNumber() : null;
const age = (date: string, asOf: string) => Math.round((Date.parse(`${asOf}T00:00:00Z`) - Date.parse(`${date}T00:00:00Z`)) / 86_400_000);

/** Holdings describe existing ledger accounts. They are never additional net-worth assets. */
export function analyzePortfolio(data: PortfolioData, accounts: PortfolioAccount[], asOf: string) {
  const knownIds = new Set(accounts.map(account => account.id));
  const orphanHoldings = data.holdings.filter(holding => !knownIds.has(holding.accountId));
  const orphanPlatforms = data.platforms.filter(platform => !knownIds.has(platform.accountId));
  const exactAnnualCharges: Decimal[] = [];
  const accountAnalysis = accounts.map(account => {
    const balance = new Decimal(account.balance);
    const positiveBalance = Decimal.max(balance, 0);
    const holdings = data.holdings.filter(holding => holding.accountId === account.id);
    const allocated = sum(holdings.map(holding => holding.value));
    const unclassified = Decimal.max(positiveBalance.minus(allocated), 0);
    const overallocated = Decimal.max(allocated.minus(positiveBalance), 0);
    const platform = data.platforms.find(item => item.accountId === account.id);
    const holdingFeeKnownValue = sum(holdings.filter(holding => holding.feeRate !== null).map(holding => holding.value));
    const holdingCharges = holdings.reduce((total, holding) => holding.feeRate === null ? total : total.plus(new Decimal(holding.value).times(holding.feeRate).div(100)), new Decimal(0));
    const platformCharge = platform?.feeRate !== undefined && platform.feeRate !== null ? positiveBalance.times(platform.feeRate).div(100) : null;
    const annualCharges = holdingCharges.plus(platformCharge ?? 0);
    exactAnnualCharges.push(annualCharges);
    const warnings: string[] = [];
    if (balance.lt(0)) warnings.push('This account has a negative ledger balance. Resolve the ledger before recording positive holdings.');
    if (overallocated.gt(0)) warnings.push('Recorded holdings exceed the current ledger balance. Review the statement and account valuation; no holdings have been revalued automatically.');
    const futureHoldings = holdings.filter(holding => holding.valuationDate > asOf);
    if (futureHoldings.length) warnings.push('Some recorded valuations are future-dated. Check these dates before making decisions.');
    const olderHoldings = holdings.filter(holding => holding.valuationDate < account.balanceAsOf);
    if (olderHoldings.length) warnings.push('Holding snapshots and the ledger cutoff use different dates. Reconciliation does not prove current market values.');
    return {
      ...account, holdings, balance: money(balance),
      allocated: money(allocated), unclassified: money(unclassified), overallocated: money(overallocated),
      allocationComplete: allocated.eq(positiveBalance) && !balance.lt(0),
      holdingFeeKnownValue: money(holdingFeeKnownValue), holdingFeeCoveragePercent: percent(holdingFeeKnownValue, allocated),
      annualKnownHoldingCharges: money(holdingCharges), platformFeeRate: platform?.feeRate ?? null,
      annualPlatformCharge: platformCharge === null ? null : money(platformCharge),
      annualKnownCharges: money(annualCharges),
      feesComplete: unclassified.eq(0) && overallocated.eq(0) && holdings.every(holding => holding.feeRate !== null) && platformCharge !== null && !balance.lt(0),
      oldestValuationDate: holdings.length ? [...holdings.map(holding => holding.valuationDate)].sort()[0] : null,
      staleHoldingCount: holdings.filter(holding => age(holding.valuationDate, asOf) > 30).length,
      datesMatchLedger: holdings.every(holding => holding.valuationDate === account.balanceAsOf),
      warnings,
    };
  });
  const totalBalance = sum(accountAnalysis.map(account => account.balance));
  const positiveBalance = accounts.reduce((total, account) => total.plus(Decimal.max(account.balance, 0)), new Decimal(0));
  const allocated = sum(accountAnalysis.map(account => account.allocated));
  const allocations = ASSET_CLASSES.map(assetClass => {
    const value = sum(data.holdings.filter(holding => knownIds.has(holding.accountId) && holding.assetClass === assetClass).map(holding => holding.value));
    return { assetClass, value: money(value), percentOfRecordedHoldings: percent(value, allocated) };
  });
  const largestHolding = data.holdings.filter(holding => knownIds.has(holding.accountId)).reduce<(typeof data.holdings)[number] | null>((largest, holding) => !largest || new Decimal(holding.value).gt(largest.value) ? holding : largest, null);
  const unknownFeeValue = sum(data.holdings.filter(holding => knownIds.has(holding.accountId) && holding.feeRate === null).map(holding => holding.value));
  return {
    asOf, scope: 'household' as const, currency: 'GBP' as const,
    totalLedgerBalance: money(totalBalance), positiveLedgerBalance: money(positiveBalance),
    totalAllocated: money(allocated),
    totalUnclassified: money(sum(accountAnalysis.map(account => account.unclassified))),
    totalOverallocated: money(sum(accountAnalysis.map(account => account.overallocated))),
    allocationCoveragePercent: percent(allocated, positiveBalance),
    allocations, accounts: accountAnalysis, orphanHoldings, orphanPlatforms,
    largestHolding: largestHolding ? { id: largestHolding.id, name: largestHolding.name, value: money(new Decimal(largestHolding.value)), percentOfRecordedHoldings: percent(new Decimal(largestHolding.value), allocated) } : null,
    fees: {
      annualKnownCharges: money(exactAnnualCharges.reduce((total, charges) => total.plus(charges), new Decimal(0))),
      holdingFeeUnknownValue: money(unknownFeeValue),
      holdingFeeCoveragePercent: percent(allocated.minus(unknownFeeValue), allocated),
      platformFeeKnownAccountCount: accountAnalysis.filter(account => account.platformFeeRate !== null).length,
      accountCount: accounts.length,
      complete: accountAnalysis.length > 0 && accountAnalysis.every(account => account.feesComplete) && orphanHoldings.length === 0 && orphanPlatforms.length === 0,
    },
    hasInconsistencies: accountAnalysis.some(account => new Decimal(account.overallocated).gt(0) || new Decimal(account.balance).lt(0)) || orphanHoldings.length > 0 || orphanPlatforms.length > 0,
    methodology: [
      'GBP statement values only; no live market prices or automatic revaluation.',
      'Holdings decompose existing investment accounts and add nothing to net worth.',
      'Account wrappers such as ISA and pension are separate from investment asset classes.',
      'Allocation percentages use recorded holdings; unclassified account value and reconciliation gaps remain visible.',
      'Annual charges use stated percentages multiplied by recorded values. Platform fees are additional account charges. Unknown fees are not zero; caps, fixed charges, transaction costs, rebates and tax are excluded.',
      'Household records include every owner. This is an overview, not a recommended asset mix or an instruction to buy or sell.',
    ],
  };
}
export type PortfolioAnalysis = ReturnType<typeof analyzePortfolio>;
