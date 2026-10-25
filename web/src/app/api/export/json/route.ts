import { journalRepo, accountRepo, categoryRepo, propertyRepo } from '@/lib/repos';
import { routeErrorResponse } from '@/lib/http/route-errors';

export async function GET() {
  try {
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
  } catch (error) {
    return routeErrorResponse(error, 'Failed to export');
  }
}
