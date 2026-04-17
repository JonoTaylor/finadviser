import { z } from 'zod';
import { budgetRepo } from '@/lib/repos';
import { format } from 'date-fns';
import { apiHandler, validateQuery } from '@/lib/api/handler';
import { monthString } from '@/lib/api/schemas';

const querySchema = z.object({
  month: monthString.optional(),
});

export const GET = apiHandler(async (req) => {
  const { month } = validateQuery(req, querySchema);
  return budgetRepo.getStatusForMonth(month ?? format(new Date(), 'yyyy-MM'));
});
