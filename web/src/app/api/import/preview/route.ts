import { previewImport } from '@/lib/import/import-pipeline';
import { categorizeTransactions } from '@/lib/import/categorizer';
import { apiHandler, badRequest } from '@/lib/api/handler';

// 20 MiB cap on uploaded statements.
const MAX_UPLOAD_BYTES = 20 * 1024 * 1024;

export const POST = apiHandler(async (req) => {
  const formData = await req.formData();
  const file = formData.get('file');
  const bankConfigRaw = formData.get('bankConfig');
  const accountNameRaw = formData.get('accountName');

  if (!(file instanceof File)) throw badRequest('No file uploaded');
  if (file.size > MAX_UPLOAD_BYTES) {
    throw badRequest(`File too large (limit ${MAX_UPLOAD_BYTES} bytes)`);
  }

  const bankConfig = typeof bankConfigRaw === 'string' ? bankConfigRaw : '';
  const accountName = typeof accountNameRaw === 'string' ? accountNameRaw : '';

  const isPdf = file.name.toLowerCase().endsWith('.pdf') || bankConfig === 'pdf';

  if (isPdf) {
    // Dynamic import — pdf-parse + pdfjs-dist crash Vercel if loaded at module init.
    const { parsePDF } = await import('@/lib/import/pdf-parser');
    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    let transactions = await parsePDF(buffer);
    transactions = await categorizeTransactions(transactions);
    return { transactions, skipped: [] };
  }

  if (!bankConfig) throw badRequest('Bank config required');
  if (!accountName) throw badRequest('Account name required');

  const csvContent = await file.text();
  return previewImport(csvContent, bankConfig, accountName);
});
