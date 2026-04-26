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

    // Filenames may contain quotes / non-ASCII — encode for the header.
    const safeFilename = result.meta.filename.replace(/"/g, '');
    const encoded = encodeURIComponent(result.meta.filename);

    return new NextResponse(new Uint8Array(result.content), {
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
