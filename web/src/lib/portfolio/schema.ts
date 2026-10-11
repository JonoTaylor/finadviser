import { z } from 'zod';

export const ASSET_CLASSES = ['equity', 'bonds', 'cash', 'property', 'alternatives', 'other'] as const;
export type AssetClass = typeof ASSET_CLASSES[number];
export const ASSET_CLASS_LABELS: Record<AssetClass, string> = {
  equity: 'Equities', bonds: 'Bonds', cash: 'Cash', property: 'Property funds', alternatives: 'Alternatives', other: 'Other',
};
const money = z.string().regex(/^(0|[1-9]\d{0,10})(\.\d{1,2})?$/, 'Enter a non-negative GBP amount with up to two decimal places');
const fee = z.string().regex(/^(0|[1-9]\d?)(\.\d{1,4})?$/, 'Enter an annual percentage with up to four decimal places')
  .refine(value => Number.isFinite(Number(value)) && Number(value) >= 0 && Number(value) <= 10, 'Annual percentage must be between 0 and 10');
export const portfolioDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD')
  .refine(value => {
    const date = new Date(`${value}T00:00:00Z`);
    return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
  }, 'Enter a real calendar date');
export const holdingSchema = z.object({
  id: z.string().regex(/^[a-zA-Z0-9_-]{1,80}$/, 'Use a stable holding ID'),
  accountId: z.number().int().positive(),
  name: z.string().trim().min(1).max(160),
  assetClass: z.enum(ASSET_CLASSES),
  currency: z.literal('GBP'),
  value: money,
  valuationDate: portfolioDateSchema,
  feeRate: fee.nullable(),
  provider: z.string().trim().min(1).max(160).nullable(),
}).strict();
export const platformSchema = z.object({ accountId: z.number().int().positive(), feeRate: fee.nullable() }).strict();
export const portfolioDataSchema = z.object({
  holdings: z.array(holdingSchema).max(500),
  platforms: z.array(platformSchema).max(200),
}).strict().superRefine((data, context) => {
  const ids = new Set<string>();
  data.holdings.forEach((holding, index) => {
    if (ids.has(holding.id)) context.addIssue({ code: 'custom', message: 'Holding IDs must be unique', path: ['holdings', index, 'id'] });
    ids.add(holding.id);
  });
  const accounts = new Set<number>();
  data.platforms.forEach((platform, index) => {
    if (accounts.has(platform.accountId)) context.addIssue({ code: 'custom', message: 'One platform fee per account', path: ['platforms', index, 'accountId'] });
    accounts.add(platform.accountId);
  });
});
export const portfolioWriteSchema = z.object({ data: portfolioDataSchema, revision: z.number().int().nonnegative() }).strict();
export type PortfolioHolding = z.infer<typeof holdingSchema>;
export type PortfolioData = z.infer<typeof portfolioDataSchema>;
export interface PortfolioAccount {
  id: number;
  name: string;
  investmentKind: string | null;
  ownerName: string | null;
  balance: string;
  balanceAsOf: string;
}
export const INITIAL_PORTFOLIO: PortfolioData = { holdings: [], platforms: [] };
export const PORTFOLIO_KEY = 'finance.portfolio.v1';
