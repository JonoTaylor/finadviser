import { calculateEquity } from '@/lib/properties/equity-calculator';
import { apiHandler, validateParams } from '@/lib/api/handler';
import { idParams } from '@/lib/api/schemas';

export const GET = apiHandler(async (_req, ctx) => {
  const { id } = await validateParams(ctx as { params: Promise<{ id: string }> }, idParams);
  const equityData = await calculateEquity(id);
  return equityData.map((e) => ({
    ownerId: e.ownerId,
    name: e.name,
    capitalAccountId: e.capitalAccountId,
    capitalBalance: e.capitalBalance.toString(),
    equityPct: e.equityPct,
    equityAmount: e.equityAmount.toString(),
  }));
});
