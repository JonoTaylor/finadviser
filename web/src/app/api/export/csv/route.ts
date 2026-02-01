import { NextResponse } from 'next/server';
import { journalRepo } from '@/lib/repos';

export async function GET() {
  try {
    const entries = await journalRepo.listEntries({ limit: 10000 });

    let csv = 'Date,Description,Category,Reference,Entries\n';
    for (const entry of entries) {
      const e = entry as Record<string, unknown>;
      const date = e.date ?? '';
      const desc = (e.description as string ?? '').replace(/"/g, '""');
      const cat = e.category_name ?? 'Uncategorized';
      const ref = e.reference ?? '';
      const summary = (e.entries_summary as string ?? '').replace(/"/g, '""');
      csv += `"${date}","${desc}","${cat}","${ref}","${summary}"\n`;
    }

    return new Response(csv, {
      headers: {
        'Content-Type': 'text/csv',
        'Content-Disposition': 'attachment; filename=finadviser-export.csv',
      },
    });
  } catch (error) {
    return NextResponse.json({ error: 'Failed to export' }, { status: 500 });
  }
}
