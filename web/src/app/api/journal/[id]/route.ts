import { z } from 'zod';
import { journalRepo, categoryRepo } from '@/lib/repos';
import { apiHandler, notFound, validateBody, validateParams } from '@/lib/api/handler';
import { idNumber, idParams } from '@/lib/api/schemas';

const patchSchema = z.object({
  categoryId: idNumber.optional(),
  createRule: z.boolean().optional(),
  description: z.string().min(1).max(500).optional(),
});

export const GET = apiHandler(async (_req, ctx) => {
  const { id } = await validateParams(ctx as { params: Promise<{ id: string }> }, idParams);
  const entry = await journalRepo.getEntry(id);
  if (!entry) throw notFound('Journal entry');
  const bookEntries = await journalRepo.getBookEntries(id);
  return { ...entry, bookEntries };
});

export const PATCH = apiHandler(async (req, ctx) => {
  const { id } = await validateParams(ctx as { params: Promise<{ id: string }> }, idParams);
  const body = await validateBody(req, patchSchema);

  if (body.categoryId !== undefined) {
    await journalRepo.updateCategory(id, body.categoryId);

    if (body.createRule && body.description) {
      const existingRules = await categoryRepo.getRules();
      const alreadyExists = existingRules.some(
        (r) =>
          r.pattern.toLowerCase() === body.description!.toLowerCase() &&
          r.categoryId === body.categoryId,
      );
      if (!alreadyExists) {
        await categoryRepo.addRule({
          pattern: body.description,
          categoryId: body.categoryId,
          matchType: 'contains',
          source: 'user',
        });
      }
    }
  }
  return { success: true };
});
