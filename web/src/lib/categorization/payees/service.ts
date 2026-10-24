import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { categoryRepo } from '@/lib/repos/category.repo';
import { getCategorizationRecords } from '../review';
import { categorizationContextKey, confirmedContextReviewReason } from '../decisions';
import type { CategorizationCandidate } from '../types';
import { payeeMemoryRepo, InvalidPayeeMemoryError, PayeeMemoryConflictError } from './repository';
import { payeeSaveSchema, payeeMemorySchema, payeeLearningContextSchema } from './schema';
import type { PayeeSaveInput } from './schema';
import { isGenericPayeeIdentity, matchConfirmedPayee, normalizePayeeAlias, payeeIdentities, payeeScope, payeeScopeKey } from './matching';
import type { PayeeLearningContext, PayeeMemory } from './types';

export { InvalidPayeeMemoryError, PayeeMemoryConflictError } from './repository';

export async function getPayeeLearningContext(journalId: number): Promise<PayeeLearningContext> {
  if (!Number.isSafeInteger(journalId) || journalId <= 0) throw new InvalidPayeeMemoryError();
  const [[record], categories] = await Promise.all([getCategorizationRecords([journalId]), categoryRepo.listAll()]);
  if (!record) throw new InvalidPayeeMemoryError('This payment could not be found.');
  const candidate = { ...record, id: record.journalId } as CategorizationCandidate;
  const scope = payeeScope(candidate);
  const identities = payeeIdentities(candidate);
  const reason = record.isTransfer || record.pendingTransfer ? 'A reconciled or pending account transfer cannot become a payee spending rule.'
    : confirmedContextReviewReason(candidate, record.categoryId ?? 0, categories) ?? (!scope ? 'Select a payment with one clear financial account.' : !identities.length ? 'This payment has no exact reusable recipient identity.' : null);
  let existingMemory: PayeeMemory | null = null;
  if (scope && !reason) {
    const known = await loadActivePayeeMemories([candidate]);
    existingMemory = matchConfirmedPayee(candidate, known, categories)?.memory ?? null;
  }
  return payeeLearningContextSchema.parse({
    record: { journalId: record.journalId, snapshot: record.snapshot, description: record.description, merchantName: record.merchantName, categoryId: record.categoryId },
    scope, identities, eligible: reason === null, reason, existingMemory,
  });
}

/** Confirms the selected category and its private recurring meaning in one database statement. */
export async function saveConfirmedPayee(input: PayeeSaveInput): Promise<{ memory: PayeeMemory; journalId: number; categoryId: number; applied: true }> {
  const parsed = payeeSaveSchema.safeParse(input);
  if (!parsed.success) throw new InvalidPayeeMemoryError(parsed.error.issues[0]?.message);
  const valid = parsed.data;
  const [[record], categories] = await Promise.all([getCategorizationRecords([valid.journalId]), categoryRepo.listAll()]);
  if (!record || record.snapshot !== valid.snapshot || record.isTransfer || record.pendingTransfer) throw new PayeeMemoryConflictError();
  const candidate = { ...record, id: record.journalId } as CategorizationCandidate;
  const scope = payeeScope(candidate);
  const identity = payeeIdentities(candidate).find(value => value.kind === valid.identityKind);
  const reason = confirmedContextReviewReason(candidate, valid.categoryId, categories);
  if (!scope || !identity || reason || !categories.some(category => category.id === valid.categoryId)) throw new InvalidPayeeMemoryError(reason ?? 'Select an existing category and exact recipient identity for this payment.');
  const scopeKey = payeeScopeKey(scope);
  const aliases = [...new Map([identity.value, ...(valid.aliases ?? [])].map(display => [normalizePayeeAlias(display), { normalized: normalizePayeeAlias(display), display: display.trim() }])).values()];
  if (aliases.some(alias => isGenericPayeeIdentity(alias.display))) throw new InvalidPayeeMemoryError('A generic payment processor, marketplace or transfer label does not identify this recipient. Use the actual payee or an exact specific statement description.');
  await payeeMemoryRepo.invalidateStale([scopeKey]);
  const saved = await payeeMemoryRepo.save(valid, { id: valid.memoryId ?? randomUUID(), scope, scopeKey, aliases, contextKey: categorizationContextKey(candidate) });
  return { memory: payeeMemorySchema.parse(saved), journalId: valid.journalId, categoryId: valid.categoryId, applied: true };
}

export async function listPayeeMemories(): Promise<PayeeMemory[]> {
  return (await payeeMemoryRepo.list()).map(value => payeeMemorySchema.parse(value));
}
export async function disablePayeeMemory(id: string, expectedRevision: number): Promise<PayeeMemory> {
  if (!z.uuid().safeParse(id).success || !Number.isSafeInteger(expectedRevision) || expectedRevision <= 0) throw new InvalidPayeeMemoryError();
  return payeeMemorySchema.parse(await payeeMemoryRepo.disable(id, expectedRevision));
}
export async function loadActivePayeeMemories(candidates: readonly CategorizationCandidate[]): Promise<PayeeMemory[]> {
  const keys = [...new Set(candidates.flatMap(candidate => { const scope = payeeScope(candidate); return scope ? [payeeScopeKey(scope)] : []; }))];
  return (await payeeMemoryRepo.list(keys, true)).map(value => payeeMemorySchema.parse(value));
}
export async function loadPrivatePayeeNames(_candidates?: readonly CategorizationCandidate[]): Promise<string[]> {
  if (_candidates?.length === 0) return [];
  return payeeMemoryRepo.privateNames();
}
