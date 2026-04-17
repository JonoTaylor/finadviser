import { getAllBankConfigs } from '@/lib/config/bank-configs';
import { apiHandler } from '@/lib/api/handler';

export const GET = apiHandler(async () => getAllBankConfigs());
