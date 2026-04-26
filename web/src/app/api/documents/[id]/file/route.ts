import { NextRequest, NextResponse } from 'next/server';
import { documentRepo } from '@/lib/repos';

/**
 * Streams the raw bytes of a stored document. `?download=1` forces a
 * file-download disposition; otherwise it's `inline` so the browser can
 * render the PDF directly in a viewer / new tab.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const docId = parseInt(id, 10);
    if (Number.isNaN(docId)) return NextResponse.json({ error: 'Invalid document id' }, { status: 400 });

    const result = await documentRepo.getContent(docId);
    if (!result) return NextResponse.json({ error: 'Document not found' }, { status: 404 });

    const wantsDownload = request.nextUrl.searchParams.get('download') === '1';
    const dispositionType = wantsDownload ? 'attachment' : 'inline';

    // Filename comes from user-uploaded metadata. Strip control chars
    // (CR/LF, NUL, etc.), backslashes, and quotes to prevent header
    // injection, then fall back to a safe default if nothing is left.
    const sanitisedFilename = result.meta.filename
      .replace(/[\p{Cc}"\\]/gu, '')
      .trim();
    const safeFilename = sanitisedFilename.length > 0 ? sanitisedFilename : `document-${result.meta.id}.pdf`;
    const encoded = encodeURIComponent(safeFilename);

    // Zero-copy view onto the Buffer's backing ArrayBuffer. Avoids the
    // duplicate allocation that `new Uint8Array(buffer)` would do, and
    // satisfies NextResponse's BodyInit typing (Buffer isn't a direct
    // member of the BodyInit union, and TS' generic Uint8Array<ArrayBufferLike>
    // also isn't accepted — the explicit ArrayBuffer cast pins the
    // generic so the resulting Uint8Array<ArrayBuffer> is BodyInit-compatible).
    const body = new Uint8Array(
      result.content.buffer as ArrayBuffer,
      result.content.byteOffset,
      result.content.byteLength,
    );
    return new NextResponse(body, {
      status: 200,
      headers: {
        'Content-Type': result.meta.mimeType,
        'Content-Length': String(result.content.length),
        'Content-Disposition': `${dispositionType}; filename="${safeFilename}"; filename*=UTF-8''${encoded}`,
        'Cache-Control': 'private, max-age=0, must-revalidate',
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to fetch document';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
