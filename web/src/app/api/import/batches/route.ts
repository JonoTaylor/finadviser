import { importBatchRepo } from '@/lib/repos';
import { apiHandler } from '@/lib/api/handler';

export const GET = apiHandler(async () => importBatchRepo.listAll());
