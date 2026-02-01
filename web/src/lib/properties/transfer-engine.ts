import Decimal from 'decimal.js';
import { accountRepo, journalRepo, propertyRepo } from '@/lib/repos';

export async function transferEquity(params: {
  fromPropertyId: number;
  toPropertyId: number;
  ownerId: number;
  amount: string;
  transferDate: string;
  description?: string;
}): Promise<number> {
  const { fromPropertyId, toPropertyId, ownerId, amount, transferDate, description } = params;

  const fromOwnership = await propertyRepo.getOwnership(fromPropertyId);
  const toOwnership = await propertyRepo.getOwnership(toPropertyId);

  let fromCapitalId: number | null = null;
  let toCapitalId: number | null = null;

  for (const own of fromOwnership) {
    if (own.owner_id === ownerId) {
      fromCapitalId = own.capital_account_id as number;
      break;
    }
  }
  for (const own of toOwnership) {
    if (own.owner_id === ownerId) {
      toCapitalId = own.capital_account_id as number;
      break;
    }
  }

  if (!fromCapitalId) throw new Error(`Owner ${ownerId} does not own property ${fromPropertyId}`);
  if (!toCapitalId) throw new Error(`Owner ${ownerId} does not own property ${toPropertyId}`);

  const transferAmount = new Decimal(amount);
  const fromBalance = new Decimal(await accountRepo.getBalance(fromCapitalId));
  if (fromBalance.lt(transferAmount)) {
    throw new Error(`Insufficient equity: ${fromBalance} available, ${transferAmount} requested`);
  }

  const fromProp = await propertyRepo.getProperty(fromPropertyId);
  const toProp = await propertyRepo.getProperty(toPropertyId);

  const desc = description || `Equity transfer: ${fromProp?.name} -> ${toProp?.name}`;

  const journalId = await journalRepo.createEntry(
    { date: transferDate, description: desc },
    [
      { accountId: fromCapitalId, amount: transferAmount.neg().toString() },
      { accountId: toCapitalId, amount: transferAmount.toString() },
    ],
  );

  await propertyRepo.createTransfer({
    fromPropertyId,
    toPropertyId,
    ownerId,
    amount,
    journalEntryId: journalId,
    transferDate,
    description: desc,
  });

  return journalId;
}
