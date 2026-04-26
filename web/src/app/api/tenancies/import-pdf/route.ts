import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';
import { documentRepo, propertyRepo } from '@/lib/repos';
import { parseTenancyPDF } from '@/lib/import/tenancy-pdf-parser';

export const runtime = 'nodejs';
export const maxDuration = 60;

const MAX_PDF_BYTES = 10 * 1024 * 1024; // 10 MB cap — typical AST is well under 1 MB.

/**
 * Multipart upload: { file: <pdf>, propertyId?: <int> }.
 *
 * Stores the original PDF in `documents` (dedup'd by SHA-256), runs the
 * AI extractor, and returns the new document id alongside an extracted
 * preview. The user reviews + corrects the preview, then POSTs to
 * /api/tenancies/from-document to actually create the tenancy.
 *
 * Two-step flow keeps the binary upload separate from the validated
 * tenancy creation, so a bad AI extraction doesn't lose the user's
 * uploaded file (it stays in Documents) and a re-extraction can be
 * triggered from the saved document later.
 */
export async function POST(request: NextRequest) {
  try {
    const form = await request.formData();
    const file = form.get('file');
    if (!(file instanceof File)) {
      return NextResponse.json({ error: 'Missing file in form data' }, { status: 400 });
    }
    if (file.type && file.type !== 'application/pdf') {
      return NextResponse.json({ error: `Unsupported file type: ${file.type}. Upload a PDF.` }, { status: 400 });
    }
    if (file.size === 0) {
      return NextResponse.json({ error: 'Uploaded file is empty' }, { status: 400 });
    }
    if (file.size > MAX_PDF_BYTES) {
      return NextResponse.json(
        { error: `File too large (${file.size} bytes). Max ${MAX_PDF_BYTES} bytes.` },
        { status: 413 },
      );
    }

    let propertyId: number | null = null;
    const rawPropertyId = form.get('propertyId');
    if (typeof rawPropertyId === 'string' && rawPropertyId !== '') {
      const parsed = parseInt(rawPropertyId, 10);
      if (Number.isNaN(parsed)) {
        return NextResponse.json({ error: 'Invalid propertyId' }, { status: 400 });
      }
      const property = await propertyRepo.getProperty(parsed);
      if (!property) {
        return NextResponse.json({ error: 'Property not found' }, { status: 404 });
      }
      propertyId = parsed;
    }

    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    const sha256 = crypto.createHash('sha256').update(buffer).digest('hex');

    // If we've already stored this exact PDF, reuse it instead of
    // duplicating the BYTEA — but still re-run extraction so the user
    // gets a fresh preview (the active model may have changed since the
    // original upload).
    const existing = await documentRepo.getBySha256(sha256);
    let documentId: number;
    if (existing) {
      documentId = existing.id;
      // If the upload pinned a property and the existing doc didn't
      // have one, fill it in. (Don't overwrite an existing link — the
      // earlier link is more authoritative.)
      if (propertyId && existing.propertyId === null) {
        await documentRepo.setProperty(documentId, propertyId);
      }
    } else {
      const created = await documentRepo.create({
        kind: 'tenancy_agreement',
        filename: file.name || 'tenancy.pdf',
        mimeType: file.type || 'application/pdf',
        sizeBytes: buffer.length,
        sha256,
        content: buffer,
        propertyId,
        tenancyId: null,
      });
      documentId = created.id;
    }

    const extracted = await parseTenancyPDF(buffer);

    return NextResponse.json({
      documentId,
      extracted,
      reused: Boolean(existing),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to import tenancy PDF';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
