import Decimal from 'decimal.js';
import { accountRepo, propertyRepo } from '@/lib/repos';

export interface OwnerEquityData {
  ownerId: number;
  name: string;
  capitalAccountId: number;
  capitalBalance: Decimal;
  equityPct: number;
  equityAmount: Decimal;
}

export async function calculateEquity(propertyId: number): Promise<OwnerEquityData[]> {
  const ownership = await propertyRepo.getOwnership(propertyId);
  if (!ownership || ownership.length === 0) return [];

  // Get latest valuation
  const valuation = await propertyRepo.getLatestValuation(propertyId);
  const marketValue = valuation ? new Decimal(valuation.valuation) : new Decimal(0);

  // Get mortgage balance
  const mortgagesList = await propertyRepo.getMortgages(propertyId);
  let totalMortgageBalance = new Decimal(0);
  const seenAccounts = new Set<number>();
  for (const m of mortgagesList) {
    const accId = m.liabilityAccountId;
    if (seenAccounts.has(accId)) continue;
    seenAccounts.add(accId);
    const balance = await accountRepo.getBalance(accId);
    totalMortgageBalance = totalMortgageBalance.plus(new Decimal(balance).abs());
  }

  const netEquity = marketValue.minus(totalMortgageBalance);

  // Calculate each owner's capital balance
  const ownerData: OwnerEquityData[] = [];
  let totalCapital = new Decimal(0);

  for (const own of ownership) {
    const capitalBalance = new Decimal(await accountRepo.getBalance(own.capital_account_id as number));
    totalCapital = totalCapital.plus(capitalBalance);
    ownerData.push({
      ownerId: own.owner_id as number,
      name: own.owner_name as string,
      capitalAccountId: own.capital_account_id as number,
      capitalBalance,
      equityPct: 0,
      equityAmount: new Decimal(0),
    });
  }

  // Calculate percentages and market equity
  for (const owner of ownerData) {
    if (totalCapital.gt(0)) {
      owner.equityPct = owner.capitalBalance.div(totalCapital).mul(100).toNumber();
    } else {
      owner.equityPct = 100 / ownerData.length;
    }
    owner.equityAmount = netEquity.mul(owner.equityPct).div(100);
  }

  return ownerData;
}

export async function calculateAllEquity(): Promise<Record<number, OwnerEquityData[]>> {
  const allProperties = await propertyRepo.listProperties();
  const result: Record<number, OwnerEquityData[]> = {};
  for (const prop of allProperties) {
    result[prop.id] = await calculateEquity(prop.id);
  }
  return result;
}
