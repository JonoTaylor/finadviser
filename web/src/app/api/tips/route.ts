import { z } from 'zod';
import { NextResponse } from 'next/server';
import { tipRepo } from '@/lib/repos';
import { apiHandler, validateQuery } from '@/lib/api/handler';
import { idString } from '@/lib/api/schemas';

const idQuery = z.object({ id: idString });

export const GET = apiHandler(async () => {
  try {
    return await tipRepo.listActive();
  } catch {
    // Table may not exist yet — return empty list gracefully.
    return NextResponse.json([]);
  }
});

export const PATCH = apiHandler(async (req) => {
  const { id } = validateQuery(req, idQuery);
  await tipRepo.dismiss(id);
  return { success: true };
});
