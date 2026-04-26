import { NextRequest, NextResponse } from 'next/server';
import { backfillMetadata } from '@/lib/import/backfill-metadata';
import { accountRepo } from '@/lib/repos';

export const runtime = 'nodejs';
export const maxDuration = 60;

const MAX_CSV_BYTES = 10 * 1024 * 1024;

/**
 * Multipart upload: { file: <csv>, bankConfig: 'monzo', accountName: 'Bank' }.
 *
 * Treats the CSV as enrichment data only — never creates journal
 * entries. Matches each row against existing journals (by external_id
 * if present, else by date+description+amount on the named account)
 * and fills in any NULL `transaction_metadata` fields. Existing
 * non-null metadata fields are preserved.
 */
export async function POST(request: NextRequest) {
  try {
    const form = await request.formData();
    const file = form.get('file');
    if (!(file instanceof File)) {
      return NextResponse.json({ error: 'Missing file in form data' }, { status: 400 });
    }
    if (file.size === 0) {
      return NextResponse.json({ error: 'Uploaded file is empty' }, { status: 400 });
    }
    if (file.size > MAX_CSV_BYTES) {
      return NextResponse.json(
        { error: `File too large (${file.size} bytes). Max ${MAX_CSV_BYTES} bytes.` },
        { status: 413 },
      );
    }

    const bankConfig = form.get('bankConfig');
    if (typeof bankConfig !== 'string' || !bankConfig) {
      return NextResponse.json({ error: 'bankConfig is required' }, { status: 400 });
    }
    const accountName = form.get('accountName');
    if (typeof accountName !== 'string' || !accountName) {
      return NextResponse.json({ error: 'accountName is required' }, { status: 400 });
    }

    // Backfill assumes the journal entries already exist on this
    // account — refuse to auto-create one.
    const account = await accountRepo.getByName(accountName);
    if (!account) {
      return NextResponse.json(
        { error: `Account "${accountName}" does not exist. Backfill expects journals to already be on it.` },
        { status: 404 },
      );
    }

    const csvContent = await file.text();
    const result = await backfillMetadata(csvContent, bankConfig, account.id);

    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to backfill metadata';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
