import { z } from 'zod';
import { categoryRepo } from '@/lib/repos';
import { apiHandler, badRequest, validateBody, validateQuery } from '@/lib/api/handler';
import { idNumber, idString, matchType, ruleSource } from '@/lib/api/schemas';

// Best-effort: reject patterns that don't compile as a JS regex. Full ReDoS
// protection (timeouts or re2) is tracked in the improvement plan (H5).
const safeRegex = z.string().superRefine((val, ctx) => {
  try {
    new RegExp(val);
  } catch {
    ctx.addIssue({ code: 'custom', message: 'Invalid regex pattern' });
  }
});

const createSchema = z
  .object({
    pattern: z.string().min(1).max(500),
    categoryId: idNumber,
    matchType: matchType.optional().default('contains'),
    priority: z.number().int().min(0).max(10_000).optional().default(0),
    source: ruleSource.optional().default('user'),
  })
  .superRefine((val, ctx) => {
    if (val.matchType === 'regex') {
      const r = safeRegex.safeParse(val.pattern);
      if (!r.success) {
        ctx.addIssue({ code: 'custom', path: ['pattern'], message: 'Invalid regex pattern' });
      }
    }
  });

const idQuery = z.object({ id: idString });

const updateSchema = z.object({
  pattern: z.string().min(1).max(500).optional(),
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
    const r = safeRegex.safeParse(body.pattern);
    if (!r.success) throw badRequest('Invalid regex pattern');
  }
  return categoryRepo.updateRule(id, body);
});
