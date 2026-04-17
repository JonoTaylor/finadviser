import { z } from 'zod';
import { executeImport, executeImportFromParsed } from '@/lib/import/import-pipeline';
import { apiHandler, validateBody } from '@/lib/api/handler';

const parsedFlowSchema = z.object({
  parsedTransactions: z.array(z.record(z.string(), z.unknown())).min(1).max(10_000),
  accountName: z.string().min(1).max(200),
  csvContent: z.string().optional(),
  bankConfig: z.string().optional(),
});

const csvFlowSchema = z.object({
  parsedTransactions: z.undefined().optional(),
  csvContent: z.string().min(1).max(20 * 1024 * 1024),
  bankConfig: z.string().min(1).max(100),
  accountName: z.string().min(1).max(200),
});

const bodySchema = z.union([parsedFlowSchema, csvFlowSchema]);

export const POST = apiHandler(async (req) => {
  const body = await validateBody(req, bodySchema);
  if ('parsedTransactions' in body && body.parsedTransactions) {
    // Pipeline accepts loose transaction objects; structural validation happens there.
    return executeImportFromParsed(body.parsedTransactions as never, body.accountName);
  }
  return executeImport(body.csvContent!, body.bankConfig!, body.accountName);
});
