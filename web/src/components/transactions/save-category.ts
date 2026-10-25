type Fetch = (url: string, init?: RequestInit) => Promise<Response>;

export interface CategorySave {
  journalId: number;
  categoryId: number;
  currentCategoryId: number | null;
  createRule: boolean;
  description?: string;
  /** Undefined when the property link is not being changed. */
  propertyId?: number | null;
  currentPropertyId: number | null;
}

type Outcome = { ok: true; body: unknown } | { ok: false; definite: boolean; message: string };

/**
 * A 4xx answer is a definite refusal. A lost connection, a 5xx or an
 * unreadable answer may still have been saved, so it is not proof of failure.
 */
async function attempt(fetchImpl: Fetch, url: string, init?: RequestInit): Promise<Outcome> {
  let response: Response;
  try {
    response = await fetchImpl(url, init);
  } catch {
    return { ok: false, definite: false, message: 'The connection was interrupted.' };
  }
  const body = await response.json().catch(() => null) as { error?: unknown } | null;
  if (response.ok) return { ok: true, body };
  const message = typeof body?.error === 'string' ? body.error : `Request failed (${response.status}).`;
  return { ok: false, definite: response.status >= 400 && response.status < 500, message };
}

function setPropertyLink(fetchImpl: Fetch, journalId: number, propertyId: number | null) {
  return propertyId === null
    ? attempt(fetchImpl, `/api/properties/journal/${journalId}/untag`, { method: 'POST' })
    : attempt(fetchImpl, `/api/properties/journal/${journalId}/tag`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ propertyId }),
    });
}

/** The saved category, or undefined when the transaction cannot be re-read. */
async function savedCategory(fetchImpl: Fetch, journalId: number): Promise<number | null | undefined> {
  const outcome = await attempt(fetchImpl, `/api/journal/${journalId}`);
  if (!outcome.ok) return undefined;
  const categoryId = (outcome.body as { categoryId?: unknown } | null)?.categoryId;
  return typeof categoryId === 'number' || categoryId === null ? categoryId : undefined;
}

/**
 * Saves a category and, optionally, the transaction's property link.
 *
 * The link goes first: a remembered category is scoped to the transaction's
 * property, so it must be learned in the final property context. If the
 * category is then refused, the previous link is restored so nothing
 * changes. If its outcome is unknown, the saved state is checked first, so
 * a category that did save is never left behind a restored link.
 */
export async function saveCategoryWithPropertyLink(
  save: CategorySave,
  fetchImpl: Fetch = (url, init) => fetch(url, init),
): Promise<void> {
  const linkChanged = save.propertyId !== undefined && save.propertyId !== save.currentPropertyId;
  if (linkChanged) {
    const linked = await setPropertyLink(fetchImpl, save.journalId, save.propertyId ?? null);
    if (!linked.ok) {
      throw new Error(linked.definite
        ? `The property link could not be saved, so nothing was changed. ${linked.message}`
        : 'The property link could not be confirmed, so the category was not saved. Reload this transaction to check it before trying again.');
    }
  }

  const saved = await attempt(fetchImpl, `/api/journal/${save.journalId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ categoryId: save.categoryId, createRule: save.createRule, description: save.description }),
  });
  if (saved.ok) return;
  if (!linkChanged) throw new Error(saved.message);

  if (!saved.definite) {
    // An unchanged category cannot show whether this save landed.
    const category = save.categoryId === save.currentCategoryId ? undefined : await savedCategory(fetchImpl, save.journalId);
    if (category === save.categoryId) return;
    if (category === undefined) {
      throw new Error('The property link was saved, but the category save could not be confirmed. Reload this transaction to check it before trying again.');
    }
  }

  const restored = await setPropertyLink(fetchImpl, save.journalId, save.currentPropertyId);
  if (!restored.ok) {
    throw new Error(`The category was not saved, and the property link could not be put back. Reload to check this transaction. ${saved.message}`);
  }
  throw new Error(`The category was not saved, so the property link was left as it was. ${saved.message}`);
}
