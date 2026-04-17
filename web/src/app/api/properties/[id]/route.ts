import { propertyRepo } from '@/lib/repos';
import { apiHandler, notFound, validateParams } from '@/lib/api/handler';
import { idParams } from '@/lib/api/schemas';

export const GET = apiHandler(async (_req, ctx) => {
  const { id } = await validateParams(ctx as { params: Promise<{ id: string }> }, idParams);
  const property = await propertyRepo.getProperty(id);
  if (!property) throw notFound('Property');

  const [ownership, valuations, mortgages, allocations] = await Promise.all([
    propertyRepo.getOwnership(id),
    propertyRepo.getValuations(id),
    propertyRepo.getMortgages(id),
    propertyRepo.getAllocationRules(id),
  ]);

  return {
    ...property,
    ownership,
    valuations,
    mortgages,
    allocations,
  };
});
