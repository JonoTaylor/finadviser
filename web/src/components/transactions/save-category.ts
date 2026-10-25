import { fetchJson } from '@/lib/http/client';

type Request = (url: string, init?: RequestInit) => Promise<unknown>;

export interface CategorySave {
  journalId: number;
  categoryId: number;
  createRule: boolean;
  description?: string;
  /** Undefined when the property link is not being changed. */
  propertyId?: number | null;
  currentPropertyId: number | null;
}

function setPropertyLink(request: Request, journalId: number, propertyId: number | null) {
  return propertyId === null
    ? request(`/api/properties/journal/${journalId}/untag`, { method: 'POST' })
    : request(`/api/properties/journal/${journalId}/tag`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ propertyId }),
    });
}

/**
 * Saves a category and, optionally, the transaction's property link.
 *
 * The link goes first: a remembered category is scoped to the transaction's
 * property, so it must be learned in the final property context. If the
 * category then fails, the previous link is restored so nothing changes.
 */
export async function saveCategoryWithPropertyLink(save: CategorySave, request: Request = fetchJson): Promise<void> {
  const linkChanged = save.propertyId !== undefined && save.propertyId !== save.currentPropertyId;
  if (linkChanged) {
    try {
      await setPropertyLink(request, save.journalId, save.propertyId ?? null);
    } catch (cause) {
      throw new Error(`The property link could not be saved, so nothing was changed. ${cause instanceof Error ? cause.message : ''}`.trim());
    }
  }
  try {
    await request(`/api/journal/${save.journalId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ categoryId: save.categoryId, createRule: save.createRule, description: save.description }),
    });
  } catch (cause) {
    if (!linkChanged) throw cause;
    const detail = cause instanceof Error ? cause.message : '';
    try {
      await setPropertyLink(request, save.journalId, save.currentPropertyId);
    } catch {
      throw new Error(`The category was not saved, and the property link could not be put back. Reload to check this transaction. ${detail}`.trim());
    }
    throw new Error(`The category was not saved, so the property link was left as it was. ${detail}`.trim());
  }
}
