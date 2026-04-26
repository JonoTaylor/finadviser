import { NextRequest, NextResponse } from 'next/server';
import { documentRepo, propertyRepo, tenancyRepo } from '@/lib/repos';
import type { RentFrequency } from '@/lib/repos/tenancy.repo';
import { schema } from '@/lib/db';

// Single source of truth: the rent_frequency enum on the schema. Keeps
// the API in sync with whatever the DB will actually accept.
const VALID_FREQUENCIES = schema.rentFrequencyEnum.enumValues;

/**
 * Body:
 * {
 *   documentId: number,
 *   propertyId: number,
 *   tenantName: string,
 *   startDate: string,         // YYYY-MM-DD
 *   endDate?: string | null,
 *   rentAmount: string,
 *   rentFrequency?: RentFrequency,
 *   depositAmount?: string | null,
 *   notes?: string | null,
 * }
 *
 * Creates the tenancy AND links the source document to it. Atomicity
 * isn't critical here — if the link update fails after the tenancy is
 * created, the user can still see the tenancy and re-link from the
 * Documents page. (We log but don't roll back.)
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();

    const documentId = Number(body?.documentId);
    if (!Number.isFinite(documentId)) {
      return NextResponse.json({ error: 'documentId is required' }, { status: 400 });
    }

    const propertyId = Number(body?.propertyId);
    if (!Number.isFinite(propertyId)) {
      return NextResponse.json({ error: 'propertyId is required' }, { status: 400 });
    }

    if (!body?.tenantName || !body?.startDate || !body?.rentAmount) {
      return NextResponse.json(
        { error: 'tenantName, startDate, and rentAmount are required' },
        { status: 400 },
      );
    }

    const rentFrequency: RentFrequency = body.rentFrequency ?? 'monthly';
    if (!VALID_FREQUENCIES.includes(rentFrequency)) {
      return NextResponse.json({ error: `Invalid rentFrequency: ${rentFrequency}` }, { status: 400 });
    }


    const [doc, property] = await Promise.all([
      documentRepo.getMeta(documentId),
      propertyRepo.getProperty(propertyId),
    ]);
    if (!doc) return NextResponse.json({ error: 'Document not found' }, { status: 404 });
    if (!property) return NextResponse.json({ error: 'Property not found' }, { status: 404 });

    const created = await tenancyRepo.create({
      propertyId,
      tenantName: String(body.tenantName),
      startDate: String(body.startDate),
      endDate: body.endDate || null,
      rentAmount: String(body.rentAmount),
      rentFrequency,
      depositAmount: body.depositAmount || null,
      notes: body.notes || null,
    });

    // Link the source document to the new tenancy + property. Best
    // effort: if it fails the tenancy still exists and is usable.
    //
    // If the document is already linked to a different tenancy, leave
    // the existing link alone — the dedup flow can hand back a row
    // that's already tied to an earlier tenancy and we don't want to
    // silently break that association. The Documents page can re-link
    // explicitly later if needed.
    try {
      if (doc.tenancyId === null || doc.tenancyId === created.id) {
        await documentRepo.linkTenancy(documentId, created.id);
      } else {
        console.warn(
          `[tenancy-import] document ${documentId} already linked to tenancy ${doc.tenancyId}; not relinking to ${created.id}`,
        );
      }
      if (doc.propertyId !== propertyId) {
        await documentRepo.setProperty(documentId, propertyId);
      }
    } catch (linkErr) {
      console.warn('[tenancy-import] failed to link document to tenancy:', linkErr);
    }

    return NextResponse.json({ tenancy: created, documentId }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to create tenancy from document';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
