import { z } from 'zod';
import { categoryRepo } from '@/lib/repos';
import { apiHandler, badRequest, validateBody, validateQuery } from '@/lib/api/handler';
import { idNumber, idString, matchType, ruleSource } from '@/lib/api/schemas';
import { isSafeRegex, PATTERN_MAX_LENGTH } from '@/lib/utils/regex-safety';

const createSchema = z
  .object({
    pattern: z.string().min(1).max(PATTERN_MAX_LENGTH),
    categoryId: idNumber,
    matchType: matchType.optional().default('contains'),
    priority: z.number().int().min(0).max(10_000).optional().default(0),
    source: ruleSource.optional().default('user'),
  })
  .superRefine((val, ctx) => {
    if (val.matchType === 'regex') {
      const result = isSafeRegex(val.pattern);
      if (!result.ok) {
        ctx.addIssue({ code: 'custom', path: ['pattern'], message: result.reason });
      }
    }
  });

const idQuery = z.object({ id: idString });

const updateSchema = z.object({
  pattern: z.string().min(1).max(PATTERN_MAX_LENGTH).optional(),
  matchType: matchType.optional(),
  categoryId: idNumber.optional(),
  priority: z.number().int().min(0).max(10_000).optional(),
});

export const GET = apiHandler(async () => categoryRepo.listRulesWithCategory());

export const POST = apiHandler(async (req) => {
  const body = await validateBody(req, createSchema);
  return categoryRepo.addRule(body);
});

export const DELETE = apiHandler(async (req) => {
  const { id } = validateQuery(req, idQuery);
  await categoryRepo.deleteRule(id);
  return { success: true };
});

export const PATCH = apiHandler(async (req) => {
  const { id } = validateQuery(req, idQuery);
  const body = await validateBody(req, updateSchema);
  if (body.matchType === 'regex' && body.pattern) {
    const result = isSafeRegex(body.pattern);
    if (!result.ok) throw badRequest(result.reason);
  }
  return categoryRepo.updateRule(id, body);
});
