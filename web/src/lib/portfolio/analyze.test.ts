import { describe, expect, it } from 'vitest';
import { analyzePortfolio } from './analyze';
import { portfolioDataSchema, type PortfolioAccount, type PortfolioData, type PortfolioHolding } from './schema';

const asOf = '2026-10-11';
const accounts: PortfolioAccount[] = [
  { id: 1, name: 'Jono ISA', ownerName: 'Jono', investmentKind: 'isa', balance: '10000.00', balanceAsOf: asOf },
  { id: 2, name: 'Pension', ownerName: 'Jono', investmentKind: 'pension', balance: '20000.00', balanceAsOf: asOf },
];
const holding = (overrides: Partial<PortfolioHolding> = {}): PortfolioHolding => ({ id: 'holding-1', accountId: 1, name: 'Global fund', assetClass: 'equity', currency: 'GBP', value: '8000.00', valuationDate: asOf, feeRate: '0.25', provider: 'Provider', ...overrides });
const data = (holdings: PortfolioHolding[], platforms: PortfolioData['platforms'] = []): PortfolioData => ({ holdings, platforms });

describe('portfolio analysis', () => {
  it('decomposes account balances without adding holdings to net worth', () => {
    const result = analyzePortfolio(data([holding()]), accounts, asOf);
    expect(result.totalLedgerBalance).toBe('30000.00');
    expect(result.totalAllocated).toBe('8000.00');
    expect(result.totalUnclassified).toBe('22000.00');
    expect(result.totalOverallocated).toBe('0.00');
    expect(result.allocationCoveragePercent).toBe(26.67);
  });
  it('uses holdings for asset mix, never ISA or pension wrapper labels', () => {
    const result = analyzePortfolio(data([holding(), holding({ id: 'bonds', accountId: 2, assetClass: 'bonds', value: '12000.00' })]), accounts, asOf);
    expect(result.allocations.find(item => item.assetClass === 'equity')?.percentOfRecordedHoldings).toBe(40);
    expect(result.allocations.find(item => item.assetClass === 'bonds')?.percentOfRecordedHoldings).toBe(60);
    expect(result.allocations).toHaveLength(6);
  });
  it('sums monetary pennies using Decimal', () => {
    const tinyAccounts = [{ ...accounts[0], balance: '0.30' }];
    const result = analyzePortfolio(data([holding({ value: '0.10' }), holding({ id: 'second', value: '0.20' })]), tinyAccounts, asOf);
    expect(result.totalAllocated).toBe('0.30');
    expect(result.totalUnclassified).toBe('0.00');
    expect(result.totalOverallocated).toBe('0.00');
  });
  it('keeps an inconsistent snapshot visible when account balance falls', () => {
    const result = analyzePortfolio(data([holding({ value: '11000.00' })]), accounts, asOf);
    expect(result.totalAllocated).toBe('11000.00');
    expect(result.totalOverallocated).toBe('1000.00');
    expect(result.hasInconsistencies).toBe(true);
    expect(result.accounts[0].warnings.join(' ')).toContain('no holdings have been revalued');
    expect(result.fees.complete).toBe(false);
  });
  it('does not net an excess in one account against a gap in another', () => {
    const result = analyzePortfolio(data([holding({ value: '11000.00' })]), accounts, asOf);
    expect(result.totalOverallocated).toBe('1000.00');
    expect(result.totalUnclassified).toBe('20000.00');
  });
  it('distinguishes unknown holding and platform fees from confirmed zero', () => {
    const result = analyzePortfolio(data([holding({ feeRate: null, value: '10000.00' })], [{ accountId: 1, feeRate: '0' }]), [accounts[0]], asOf);
    expect(result.fees.annualKnownCharges).toBe('0.00');
    expect(result.fees.holdingFeeUnknownValue).toBe('10000.00');
    expect(result.fees.holdingFeeCoveragePercent).toBe(0);
    expect(result.fees.platformFeeKnownAccountCount).toBe(1);
    expect(result.fees.complete).toBe(false);
    const confirmed = analyzePortfolio(data([holding({ feeRate: '0', value: '10000.00' })], [{ accountId: 1, feeRate: '0' }]), [accounts[0]], asOf);
    expect(confirmed.fees.complete).toBe(true);
  });
  it('adds holding charges and separate platform percentages without double-counting values', () => {
    const result = analyzePortfolio(data([holding()], [{ accountId: 1, feeRate: '0.15' }]), [accounts[0]], asOf);
    expect(result.accounts[0].annualKnownHoldingCharges).toBe('20.00');
    expect(result.accounts[0].annualPlatformCharge).toBe('15.00');
    expect(result.fees.annualKnownCharges).toBe('35.00');
    expect(result.fees.complete).toBe(false); // unclassified £2,000 still has unknown holding charges
  });
  it('rounds illustrative annual charges only at the presentation boundary', () => {
    const result = analyzePortfolio(data([holding({ value: '1.99', feeRate: '0.25' }), holding({ id: 'second', value: '1.99', feeRate: '0.25' })]), [accounts[0]], asOf);
    expect(result.accounts[0].annualKnownHoldingCharges).toBe('0.01');
  });
  it('sums exact annual charges across accounts before rounding the household amount', () => {
    const smallAccounts = accounts.map(account => ({ ...account, balance: '1.99' }));
    const result = analyzePortfolio(data([
      holding({ value: '1.99' }),
      holding({ id: 'second-account', accountId: 2, value: '1.99' }),
    ], [{ accountId: 1, feeRate: '0' }, { accountId: 2, feeRate: '0' }]), smallAccounts, asOf);
    expect(result.accounts.map(account => account.annualKnownCharges)).toEqual(['0.00', '0.00']);
    expect(result.fees.annualKnownCharges).toBe('0.01');
    expect(result.fees.complete).toBe(true);
  });
  it('exposes stale snapshots and different dates without inventing current prices', () => {
    const result = analyzePortfolio(data([holding({ valuationDate: '2026-08-01' })]), accounts, asOf);
    expect(result.accounts[0].staleHoldingCount).toBe(1);
    expect(result.accounts[0].datesMatchLedger).toBe(false);
    expect(result.accounts[0].oldestValuationDate).toBe('2026-08-01');
    expect(result.accounts[0].warnings.join(' ')).toContain('different dates');
    expect(result.accounts[0].holdings[0].value).toBe('8000.00');
  });
  it('exposes future snapshots defensively when reading legacy data', () => {
    const result = analyzePortfolio(data([holding({ valuationDate: '2027-01-01' })]), accounts, asOf);
    expect(result.accounts[0].warnings.join(' ')).toContain('future-dated');
  });
  it('excludes orphan holdings from account allocation and fees and discloses them', () => {
    const result = analyzePortfolio(data([holding({ accountId: 999, feeRate: '10' })]), accounts, asOf);
    expect(result.orphanHoldings).toHaveLength(1);
    expect(result.totalAllocated).toBe('0.00');
    expect(result.fees.annualKnownCharges).toBe('0.00');
    expect(result.hasInconsistencies).toBe(true);
  });
  it('discloses orphan platform records so they can be removed together', () => {
    const result = analyzePortfolio(data([], [{ accountId: 999, feeRate: '0.25' }]), accounts, asOf);
    expect(result.orphanPlatforms).toEqual([{ accountId: 999, feeRate: '0.25' }]);
    expect(result.fees.annualKnownCharges).toBe('0.00');
    expect(result.hasInconsistencies).toBe(true);
  });
  it('preserves negative account balances but never models a negative platform charge', () => {
    const result = analyzePortfolio(data([], [{ accountId: 1, feeRate: '0.5' }]), [{ ...accounts[0], balance: '-5.00' }], asOf);
    expect(result.totalLedgerBalance).toBe('-5.00');
    expect(result.positiveLedgerBalance).toBe('0.00');
    expect(result.fees.annualKnownCharges).toBe('0.00');
    expect(result.fees.complete).toBe(false);
    expect(result.accounts[0].warnings.join(' ')).toContain('negative ledger balance');
  });
  it('keeps concentration denominators explicit and returns null for an empty portfolio', () => {
    expect(analyzePortfolio(data([]), [], asOf).largestHolding).toBeNull();
    const result = analyzePortfolio(data([holding(), holding({ id: 'second', value: '2000.00' })]), accounts, asOf);
    expect(result.largestHolding?.percentOfRecordedHoldings).toBe(80);
    expect(result.largestHolding?.value).toBe('8000.00');
  });
});

describe('portfolio input schema', () => {
  it('rejects negative, imprecise, exponent and non-string money', () => {
    for (const value of ['-1', '0.001', '1e3', 'Infinity', 'NaN', '', '01.00', 100]) {
      expect(portfolioDataSchema.safeParse(data([holding({ value: value as string })])).success).toBe(false);
    }
  });
  it('requires real dates, stable unique IDs, GBP and investment asset classes', () => {
    for (const patch of [{ valuationDate: '2026-02-30' }, { assetClass: 'isa' }, { assetClass: 'pension' }, { currency: 'USD' }, { accountId: 0 }, { accountId: 1.2 }]) {
      expect(portfolioDataSchema.safeParse(data([holding(patch as Partial<PortfolioHolding>)])).success).toBe(false);
    }
    expect(portfolioDataSchema.safeParse(data([holding(), holding()])).success).toBe(false);
    expect(portfolioDataSchema.safeParse(data([holding({ valuationDate: '2024-02-29' })])).success).toBe(true);
  });
  it('rejects unknown fields and duplicate platform entries', () => {
    expect(portfolioDataSchema.safeParse({ ...data([]), fakeBalance: '100' }).success).toBe(false);
    expect(portfolioDataSchema.safeParse(data([{ ...holding(), extra: 'value' } as PortfolioHolding])).success).toBe(false);
    expect(portfolioDataSchema.safeParse(data([], [{ accountId: 1, feeRate: '0.2' }, { accountId: 1, feeRate: null }])).success).toBe(false);
  });
  it('accepts unknown fees but rejects implausible or overly precise annual percentages', () => {
    expect(portfolioDataSchema.safeParse(data([holding({ feeRate: null })])).success).toBe(true);
    for (const feeRate of ['-0.1', '10.01', '0.12345', '1e0', '100', 'not-a-number', '', 'Infinity', 'NaN']) expect(portfolioDataSchema.safeParse(data([holding({ feeRate })])).success).toBe(false);
  });
});
