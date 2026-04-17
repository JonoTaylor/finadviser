import { journalRepo, accountRepo, categoryRepo, propertyRepo } from '@/lib/repos';
import { apiHandler } from '@/lib/api/handler';

export const GET = apiHandler(async () => {
  const [entries, balances, categories, properties] = await Promise.all([
    journalRepo.listEntries({ limit: 10000 }),
    accountRepo.getBalances(),
    categoryRepo.listAll(),
    propertyRepo.listProperties(),
  ]);

  const data = {
    exportDate: new Date().toISOString(),
    accounts: balances,
    categories,
    transactions: entries,
    properties,
  };

  return new Response(JSON.stringify(data, null, 2), {
    headers: {
      'Content-Type': 'application/json',
      'Content-Disposition': 'attachment; filename=finadviser-export.json',
    },
  });
});
