import { journalRepo } from '@/lib/repos';
import { apiHandler } from '@/lib/api/handler';

export const GET = apiHandler(async () => journalRepo.getMonthlySpending());
