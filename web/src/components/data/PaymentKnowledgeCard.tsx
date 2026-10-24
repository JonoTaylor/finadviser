'use client';

import { useRef, useState } from 'react';
import useSWR from 'swr';
import { z } from 'zod';
import { Alert, Box, Button, Card, CardContent, Chip, Skeleton, Stack, Typography } from '@mui/material';
import type { PayeeMemory } from '@/lib/categorization/payees/types';
import { payeeMemorySchema } from '@/lib/categorization/payees/schema';
import { fetchJson } from '@/lib/http/client';
import RememberPayeeDialog, { paymentScopeLabel } from './RememberPayeeDialog';

const listSchema = z.object({ memories: z.array(payeeMemorySchema) }).strict();

export function SavedPaymentMeaning({ memory, pending = false, onEdit, onDisable }: { memory: PayeeMemory; pending?: boolean; onEdit: () => void; onDisable: () => void }) {
  return <Box sx={{ py: 1.75, '& + &': { borderTop: 1, borderColor: 'divider' } }}>
    <Stack direction="row" gap={1.5} justifyContent="space-between" alignItems="flex-start" flexWrap="wrap">
      <Box sx={{ minWidth: 0, flex: 1 }}>
        <Stack direction="row" gap={1} alignItems="center" flexWrap="wrap"><Typography variant="subtitle2" component="h3" sx={{ overflowWrap: 'anywhere' }}>{memory.payeeName}</Typography><Chip size="small" variant="outlined" color={memory.status === 'active' ? 'success' : memory.status === 'conflicted' ? 'warning' : 'default'} label={memory.status === 'active' ? 'Remembered' : memory.status === 'conflicted' ? 'Needs reconfirming' : 'Disabled'} /></Stack>
        <Typography variant="body2" sx={{ mt: 0.5, overflowWrap: 'anywhere' }}>{memory.purpose ?? 'Purpose not recorded'} · <strong>{memory.categoryName}</strong></Typography>
        <Typography variant="caption" component="p" sx={{ mt: 0.5 }}>{paymentScopeLabel(memory.scope)}</Typography>
        <Typography variant="caption" component="p" sx={{ mt: 0.5, overflowWrap: 'anywhere' }}>Confirmed {memory.identityKind === 'bank_payee' ? 'bank payee names' : memory.identityKind === 'merchant' ? 'merchant names' : 'descriptions'}: {memory.aliases.join(' · ')}</Typography>
      </Box>
      <Stack direction="row" gap={0.5} flexWrap="wrap">
        <Button size="small" disabled={pending || memory.sourceJournalId === null} onClick={onEdit}>{memory.status === 'active' ? 'Edit meaning' : 'Reconfirm'}</Button>
        {memory.status !== 'disabled' && <Button size="small" disabled={pending} onClick={onDisable}>Stop reusing</Button>}
      </Stack>
    </Stack>
    {memory.status === 'conflicted' && <Typography variant="caption" component="p" sx={{ mt: 0.75 }}>This meaning needs to be confirmed again. Automatic reuse is paused until you check it.</Typography>}
  </Box>;
}

export default function PaymentKnowledgeCard({ onChanged }: { onChanged: () => void | Promise<void> }) {
  const { data, error: loadError, isLoading, mutate } = useSWR('/api/categorization/payees', async url => listSchema.parse(await fetchJson<unknown>(url)), { shouldRetryOnError: false });
  const [editing, setEditing] = useState<PayeeMemory | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const [showAll, setShowAll] = useState(false);
  const writing = useRef(false);
  const disable = async (memory: PayeeMemory) => {
    if (writing.current) return;
    writing.current = true; setPending(true); setError('');
    try {
      const body = await fetchJson<{ memory: PayeeMemory }>(`/api/categorization/payees/${memory.id}/disable`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ expectedRevision: memory.revision }),
      });
      const saved = payeeMemorySchema.safeParse(body.memory);
      if (!saved.success || saved.data.id !== memory.id || saved.data.status !== 'disabled') throw new Error('The change could not be confirmed. Reload the current payment meanings before trying again.');
      await Promise.allSettled([mutate(), Promise.resolve().then(onChanged)]);
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'The saved meaning could not be changed. Reload its current status before trying again.'); }
    finally { writing.current = false; setPending(false); }
  };
  const memories = data?.memories ?? [];
  const active = memories.filter(memory => memory.status === 'active').length;
  const displayed = showAll ? memories : memories.slice(0, 8);
  return <Card><CardContent>
    <Stack direction="row" gap={1} justifyContent="space-between" flexWrap="wrap" sx={{ mb: 1 }}><Typography component="h2" variant="h6">What your payments mean</Typography>{data && <Chip size="small" variant="outlined" label={`${active} remembered payee${active === 1 ? '' : 's'}`} />}</Stack>
    <Typography variant="body2" color="text.secondary">Give a recurring payment its meaning once. The assistant can reuse confirmed payees in the same account context, including recognised bank payee names with changing references.</Typography>
    {isLoading && <Skeleton variant="rounded" height={70} sx={{ mt: 2 }} />}
    {loadError && <Alert severity="warning" sx={{ mt: 2 }} action={<Button size="small" onClick={() => void mutate()}>Reload</Button>}>Saved payment meanings are unavailable. They have not been treated as empty.</Alert>}
    {error && <Alert severity="warning" sx={{ mt: 2 }} action={<Button size="small" onClick={() => void mutate()}>Reload</Button>}>{error}</Alert>}
    {data && memories.length === 0 && <Alert severity="info" sx={{ mt: 2 }}>Choose a category for a transaction or review question, then select “Remember this payee” to save who they are and what the payment is for.</Alert>}
    <Box sx={{ mt: 1 }}>{displayed.map(memory => <SavedPaymentMeaning key={memory.id} memory={memory} pending={pending} onEdit={() => setEditing(memory)} onDisable={() => void disable(memory)} />)}</Box>
    {!showAll && memories.length > displayed.length && <Button size="small" onClick={() => setShowAll(true)}>Show all {memories.length} saved meanings</Button>}
    {data && <Typography variant="caption" component="p" sx={{ mt: 1 }}>These are your confirmed private facts. They do not assign a different property, owner or payment direction, and do not prove tax deductibility.</Typography>}
    <RememberPayeeDialog open={editing !== null} journalId={editing?.sourceJournalId ?? null} categoryId={editing?.categoryId ?? null} categoryLabel={editing?.categoryName ?? 'Saved category'} memoryToEdit={editing} onClose={() => setEditing(null)} onSaved={async () => { await Promise.allSettled([mutate(), Promise.resolve().then(onChanged)]); }} />
  </CardContent></Card>;
}
