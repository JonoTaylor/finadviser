'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import useSWR, { useSWRConfig } from 'swr';
import { z } from 'zod';
import { Alert, Box, Button, Dialog, DialogActions, DialogContent, DialogTitle, FormControl, InputLabel, MenuItem, Select, Skeleton, Stack, TextField, Typography } from '@mui/material';
import { fetchJson } from '@/lib/http/client';
import type { PayeeIdentityKind, PayeeLearningContext, PayeeMemory } from '@/lib/categorization/payees/types';
import { payeeLearningContextSchema, payeeMemorySchema } from '@/lib/categorization/payees/schema';

export function paymentScopeLabel(scope: NonNullable<PayeeLearningContext['scope']>): string {
  return `${scope.accountName} · ${scope.direction < 0 ? 'outgoing payments' : 'incoming payments'} · ${scope.currency ?? 'currency not recorded'} · ${scope.propertyId === null ? 'not linked to a property' : 'linked property only'}`;
}

type Props = {
  open: boolean; journalId: number | null; categoryId: number | null; categoryLabel: string;
  onClose: () => void; onSaved: () => void | Promise<void>;
  memoryToEdit?: PayeeMemory | null;
};

export function samePayeeScope(a: NonNullable<PayeeLearningContext['scope']>, b: NonNullable<PayeeLearningContext['scope']>): boolean {
  return a.accountId === b.accountId && a.accountType === b.accountType && a.ownerId === b.ownerId
    && a.direction === b.direction && a.currency === b.currency && a.propertyId === b.propertyId;
}

export default function RememberPayeeDialog({ open, journalId, categoryId, categoryLabel, onClose, onSaved, memoryToEdit = null }: Props) {
  const { mutate } = useSWRConfig();
  const { data: loadedContext, error: contextError, isLoading, mutate: reload } = useSWR<PayeeLearningContext>(
    open && journalId ? `/api/categorization/payees/context?journalId=${journalId}` : null,
    async url => payeeLearningContextSchema.parse(await fetchJson<unknown>(url)), { shouldRetryOnError: false, revalidateOnFocus: false },
  );
  const [payeeName, setPayeeName] = useState('');
  const [context, setContext] = useState<PayeeLearningContext | null>(null);
  const [purpose, setPurpose] = useState('');
  const [aliases, setAliases] = useState('');
  const [identityKind, setIdentityKind] = useState<PayeeIdentityKind | ''>('');
  const [existingMemory, setExistingMemory] = useState<PayeeMemory | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const initialised = useRef<number | null>(null);
  const writing = useRef(false);
  useEffect(() => {
    if (!open) { initialised.current = null; setContext(null); }
  }, [open]);
  const initialiseForm = useCallback((current: PayeeLearningContext, refreshedMemory?: PayeeMemory) => {
    initialised.current = current.record.journalId;
    setContext(current);
    const existing = refreshedMemory ?? (memoryToEdit
      ? current.existingMemory?.id === memoryToEdit.id ? current.existingMemory : memoryToEdit
      : current.existingMemory);
    const selectedIdentity = existing ? current.identities.find(item => item.kind === existing.identityKind)
      : current.identities.find(item => item.kind === 'bank_payee') ?? current.identities[0];
    setPayeeName(existing?.payeeName ?? current.record.merchantName ?? selectedIdentity?.value ?? '');
    setPurpose(existing?.purpose ?? '');
    setAliases(existing?.aliases.filter(alias => alias.trim().toLocaleLowerCase('en-GB') !== selectedIdentity?.value.trim().toLocaleLowerCase('en-GB')).join('\n') ?? '');
    setIdentityKind(existing?.identityKind ?? selectedIdentity?.kind ?? ''); setExistingMemory(existing ?? null); setError('');
  }, [memoryToEdit]);
  useEffect(() => {
    if (!open || !loadedContext || !journalId || initialised.current === journalId) return;
    initialiseForm(loadedContext);
  }, [open, loadedContext, journalId, initialiseForm]);

  const identity = context?.identities.find(item => item.kind === identityKind);
  const scopeChanged = Boolean(existingMemory && context?.scope && !samePayeeScope(existingMemory.scope, context.scope));
  const reloadSavedDetails = async () => {
    try {
      const current = await reload();
      let refreshedMemory: PayeeMemory | undefined;
      if (memoryToEdit) {
        const listed = z.object({ memories: z.array(payeeMemorySchema) }).parse(await fetchJson<unknown>('/api/categorization/payees'));
        refreshedMemory = listed.memories.find(memory => memory.id === memoryToEdit.id);
        if (!refreshedMemory) throw new Error('Saved meaning missing');
      }
      if (current) initialiseForm(current, refreshedMemory);
    }
    catch { setError('The current payment details could not be loaded. Your form has been kept.'); }
  };
  const save = async () => {
    if (writing.current || !context?.eligible || !context.scope || scopeChanged || !identity || !journalId || categoryId === null || !payeeName.trim()) return;
    writing.current = true; setSaving(true); setError('');
    try {
      const result = await fetchJson<{ memory: PayeeMemory; journalId: number; categoryId: number; applied: boolean }>('/api/categorization/payees', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({
          journalId, snapshot: context.record.snapshot, categoryId, payeeName: payeeName.trim(),
          ...(purpose.trim() ? { purpose: purpose.trim() } : {}), identityKind,
          aliases: aliases.split('\n').map(alias => alias.trim()).filter(Boolean),
          ...(existingMemory ? { memoryId: existingMemory.id, expectedRevision: existingMemory.revision } : {}),
        }),
      });
      if (result.applied !== true || result.journalId !== journalId || result.categoryId !== categoryId || !payeeMemorySchema.safeParse(result.memory).success) {
        throw new Error('The saved category and payment meaning could not be confirmed. Reload the current records before trying again.');
      }
      // An acknowledged atomic write is never retried because a later read
      // refresh failed. Both the category and private meaning are already saved.
      await Promise.allSettled([mutate('/api/categorization/payees'), Promise.resolve().then(onSaved)]);
      onClose();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'This save could not be confirmed. Reload saved payment meanings before trying again.');
    } finally { writing.current = false; setSaving(false); }
  };

  return <Dialog open={open} onClose={() => { if (!writing.current) onClose(); }} disableEscapeKeyDown={saving} fullWidth maxWidth="sm">
    <DialogTitle>Remember what this payment means</DialogTitle>
    <DialogContent>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>Teach the assistant about a person or recurring service once. This is private payment context, separate from public merchant research.</Typography>
      {isLoading && <Skeleton variant="rounded" height={90} />}
      {contextError && <Alert severity="warning" action={<Button size="small" onClick={() => void reload()}>Reload</Button>}>The current payment context could not be loaded. No meaning has been saved.</Alert>}
      {error && <Alert severity="warning" sx={{ mb: 2 }} action={<Button size="small" disabled={saving} onClick={() => void reloadSavedDetails()}>Reload saved details</Button>}>{error} Reloading replaces the form with the current saved details.</Alert>}
      {context && <Stack gap={2}>
        <Box sx={{ p: 1.5, border: 1, borderColor: 'divider', borderRadius: 1, bgcolor: 'action.hover' }}>
          <Typography variant="body2" sx={{ overflowWrap: 'anywhere', fontWeight: 600 }}>{context.record.description}</Typography>
          {context.scope && <Typography variant="caption" component="p" sx={{ mt: 0.5 }}>{paymentScopeLabel(context.scope)}</Typography>}
          <Typography variant="body2" sx={{ mt: 1 }}>Confirm category: <strong>{categoryLabel}</strong></Typography>
        </Box>
        {context.record.categoryId !== null && context.record.categoryId !== categoryId && <Alert severity="warning">A different category is already saved for this payment. Saving will replace it with {categoryLabel}.</Alert>}
        {!context.eligible && <Alert severity="info">{context.reason ?? 'This payment cannot safely become a reusable payee match. Confirm its account movement first.'}</Alert>}
        {scopeChanged && <Alert severity="warning">The original payment’s account context has changed. Open a matching payment in the saved account context before changing this meaning.</Alert>}
        {context.eligible && <>
          {existingMemory && <Alert severity="info">This updates the saved meaning for this payee in the account context shown above.</Alert>}
          <TextField label="Payee name" value={payeeName} onChange={event => setPayeeName(event.target.value)} disabled={saving} required fullWidth slotProps={{ htmlInput: { maxLength: 100 } }} helperText="A name you recognise, such as a cleaner or a regular service." />
          <TextField label="What is this payment for?" value={purpose} onChange={event => setPurpose(event.target.value)} disabled={saving} fullWidth slotProps={{ htmlInput: { maxLength: 200 } }} placeholder="Household cleaning" helperText="Add the meaning the bank statement does not explain." />
          <FormControl fullWidth size="small"><InputLabel id="payee-identity-kind">Identify future payments by</InputLabel><Select value={identityKind} labelId="payee-identity-kind" label="Identify future payments by" disabled={saving || Boolean(existingMemory)} onChange={event => { setIdentityKind(event.target.value as PayeeIdentityKind); setAliases(''); }}>
            {context.identities.map(item => <MenuItem key={item.kind} value={item.kind}>{item.label}</MenuItem>)}
            {existingMemory && !context.identities.some(item => item.kind === existingMemory.identityKind) && <MenuItem value={existingMemory.identityKind} disabled>Saved identity no longer available on this payment</MenuItem>}
          </Select></FormControl>
          {identity && <Typography variant="body2" sx={{ overflowWrap: 'anywhere' }}>Confirmed bank identity: <strong>{identity.value}</strong></Typography>}
          {identity?.kind === 'description' && <Alert severity="info">This matches the whole description, including its reference. A changed reference needs a confirmed alias or a bank payee identity.</Alert>}
          <TextField label="Other exact bank names or descriptions (optional)" value={aliases} onChange={event => setAliases(event.target.value)} disabled={saving} fullWidth multiline minRows={2} slotProps={{ htmlInput: { maxLength: 1700 } }} helperText="Up to eight known variants, one per line. Only add variants that belong to this same payee; the assistant does not guess extra aliases." />
          <Typography variant="caption">Future matches must keep the same account, owner, currency, payment direction and property context. This also confirms the selected category for this payment.</Typography>
        </>}
      </Stack>}
    </DialogContent>
    <DialogActions><Button disabled={saving} onClick={onClose}>Cancel</Button><Button variant="contained" disabled={saving || !context?.eligible || scopeChanged || !identity || !payeeName.trim() || categoryId === null} onClick={() => void save()}>{saving ? 'Saving…' : 'Save category and remember payee'}</Button></DialogActions>
  </Dialog>;
}
