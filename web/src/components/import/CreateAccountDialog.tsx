'use client';

import { useState } from 'react';
import {
  Button, Stack, TextField, MenuItem, Select, InputLabel, FormControl,
  Dialog, DialogTitle, DialogContent, DialogActions,
  RadioGroup, FormControlLabel, Radio, Typography, Box, Alert,
} from '@mui/material';

interface Account {
  id: number;
  name: string;
  accountType?: string;
}

type CreatableAccountType = 'ASSET' | 'LIABILITY';

const TYPE_DESCRIPTIONS: Record<CreatableAccountType, { label: string; helper: string }> = {
  ASSET: {
    label: 'Bank / Cash / Savings / Investment',
    helper: 'Money you own. Positive = money in.',
  },
  LIABILITY: {
    label: 'Credit card / Loan / Mortgage owed',
    helper: 'Money you owe. Spending increases the balance; statement payments decrease it.',
  },
};

/**
 * Account creation payload sent to POST /api/accounts. Kept narrow
 * so accidental extra fields don't leak into the create call; the
 * route handler destructures known fields and the rest goes to
 * accountRepo.create.
 */
interface CreateAccountPayload {
  name: string;
  accountType: CreatableAccountType;
  paysOffAccountId?: number;
}

/**
 * Inline dialog used by the import wizard's account picker (and
 * potentially other call sites — keep it self-contained). On
 * confirm, POSTs /api/accounts with the chosen name + type +
 * optional pays_off link, then calls back with the new account
 * name so the parent can bind the import to it.
 */
export default function CreateAccountDialog({
  open,
  onClose,
  onCreated,
  accounts,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: (newAccountName: string) => void;
  /** Used to populate the LIABILITY-only "pays this off" picker. */
  accounts: Account[];
}) {
  const [name, setName] = useState('');
  const [type, setType] = useState<CreatableAccountType>('ASSET');
  const [paysOff, setPaysOff] = useState<number | ''>('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function reset() {
    setName('');
    setType('ASSET');
    setPaysOff('');
    setError(null);
  }

  async function handleSubmit() {
    const trimmed = name.trim();
    if (!trimmed) {
      setError('Name is required.');
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      // Single POST: pays_off link is stamped server-side after the
      // create so the front-end doesn't need a separate PATCH and
      // a network blip mid-flow doesn't strand a half-created row.
      const payload: CreateAccountPayload = { name: trimmed, accountType: type };
      if (type === 'LIABILITY' && typeof paysOff === 'number') {
        payload.paysOffAccountId = paysOff;
      }
      const res = await fetch('/api/accounts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const created = await res.json();
      if (!res.ok) throw new Error(created?.error ?? `Request failed: ${res.status}`);

      onCreated(created.name);
      reset();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to create account');
    } finally {
      setSubmitting(false);
    }
  }

  function handleClose() {
    if (submitting) return;
    reset();
    onClose();
  }

  return (
    <Dialog open={open} onClose={handleClose} maxWidth="xs" fullWidth>
      <DialogTitle>Create a new account</DialogTitle>
      <DialogContent>
        <Stack spacing={2.5} sx={{ mt: 0.5 }}>
          <TextField
            label="Name"
            size="small"
            fullWidth
            autoFocus
            value={name}
            onChange={e => setName(e.target.value)}
            helperText="e.g. Yonder, Amex Gold, Monzo, Mortgage"
          />

          <Box>
            <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1 }}>
              Account type
            </Typography>
            <RadioGroup
              value={type}
              onChange={e => setType(e.target.value as CreatableAccountType)}
            >
              {(Object.keys(TYPE_DESCRIPTIONS) as CreatableAccountType[]).map(t => (
                <FormControlLabel
                  key={t}
                  value={t}
                  control={<Radio size="small" />}
                  label={
                    <Box>
                      <Typography variant="body2" sx={{ fontWeight: 500 }}>
                        {TYPE_DESCRIPTIONS[t].label}
                      </Typography>
                      <Typography variant="caption" color="text.secondary">
                        {TYPE_DESCRIPTIONS[t].helper}
                      </Typography>
                    </Box>
                  }
                  sx={{ alignItems: 'flex-start', mb: 0.5, '& .MuiFormControlLabel-label': { ml: 0.5 } }}
                />
              ))}
            </RadioGroup>
          </Box>

          {type === 'LIABILITY' && (
            <FormControl fullWidth size="small">
              <InputLabel shrink>Account that pays this off (optional)</InputLabel>
              <Select<number | ''>
                value={paysOff}
                label="Account that pays this off (optional)"
                displayEmpty
                onChange={e => {
                  const v = e.target.value;
                  setPaysOff(v === '' || v === undefined ? '' : Number(v));
                }}
                renderValue={(selected) => {
                  if (selected === '' || selected === undefined) {
                    return <Box component="em" sx={{ color: 'text.secondary' }}>None</Box>;
                  }
                  const acc = accounts.find(a => a.id === selected);
                  return acc?.name ?? '';
                }}
              >
                <MenuItem value=""><em>None</em></MenuItem>
                {accounts
                  .filter(a => a.accountType === 'ASSET')
                  .map(a => (
                    <MenuItem key={a.id} value={a.id}>{a.name}</MenuItem>
                  ))}
              </Select>
              <Typography variant="caption" color="text.secondary" sx={{ mt: 0.5 }}>
                Pick the bank account that pays this credit card / loan, so future statement payments
                auto-merge as transfers.
              </Typography>
            </FormControl>
          )}

          {error && <Alert severity="error">{error}</Alert>}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={handleClose} disabled={submitting}>Cancel</Button>
        <Button
          variant="contained"
          onClick={handleSubmit}
          disabled={submitting || !name.trim()}
        >
          {submitting ? 'Creating...' : 'Create + use'}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
