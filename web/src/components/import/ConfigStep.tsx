'use client';

import { useState } from 'react';
import {
  Card, CardContent, TextField, Button, Stack,
  MenuItem, Select, InputLabel, FormControl, Divider,
  Dialog, DialogTitle, DialogContent, DialogActions,
  RadioGroup, FormControlLabel, Radio, Typography, Box, Alert,
} from '@mui/material';
import AddRoundedIcon from '@mui/icons-material/AddRounded';

interface BankConfig {
  name: string;
  description: string;
}

interface Account {
  id: number;
  name: string;
  account_type?: string;
}

const CREATE_NEW_SENTINEL = '__create_new__';

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

export default function ConfigStep({
  bankConfig,
  accountName,
  bankConfigs,
  accounts,
  onBankConfigChange,
  onAccountNameChange,
  onAccountsChanged,
  onNext,
  onBack,
  busy = false,
}: {
  bankConfig: string;
  accountName: string;
  bankConfigs: Record<string, BankConfig>;
  accounts: Account[];
  onBankConfigChange: (v: string) => void;
  onAccountNameChange: (v: string) => void;
  /** Called after a new account is created so the parent can
   *  revalidate its SWR cache and the dropdown updates. */
  onAccountsChanged?: () => void;
  onNext: () => void;
  onBack: () => void;
  busy?: boolean;
}) {
  const [createOpen, setCreateOpen] = useState(false);
  const [createName, setCreateName] = useState('');
  const [createType, setCreateType] = useState<CreatableAccountType>('ASSET');
  const [createPaysOff, setCreatePaysOff] = useState<number | ''>('');
  const [createSubmitting, setCreateSubmitting] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  function openCreateDialog() {
    setCreateName('');
    setCreateType('ASSET');
    setCreatePaysOff('');
    setCreateError(null);
    setCreateOpen(true);
  }

  async function handleCreate() {
    const name = createName.trim();
    if (!name) {
      setCreateError('Name is required.');
      return;
    }
    setCreateSubmitting(true);
    setCreateError(null);
    try {
      // Single POST: pays_off link is stamped server-side after the
      // create so we never end up with a half-created account on a
      // network blip mid-flow.
      const payload: Record<string, unknown> = { name, accountType: createType };
      if (createType === 'LIABILITY' && createPaysOff !== '') {
        payload.paysOffAccountId = createPaysOff;
      }
      const res = await fetch('/api/accounts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const created = await res.json();
      if (!res.ok) throw new Error(created?.error ?? `Request failed: ${res.status}`);

      // Bind to the import flow + refresh the parent's accounts list
      // so the new entry appears in the dropdown next render.
      onAccountNameChange(created.name);
      onAccountsChanged?.();
      setCreateOpen(false);
    } catch (e) {
      setCreateError(e instanceof Error ? e.message : 'Failed to create account');
    } finally {
      setCreateSubmitting(false);
    }
  }

  function handleAccountChange(value: string) {
    if (value === CREATE_NEW_SENTINEL) {
      openCreateDialog();
      return;
    }
    onAccountNameChange(value);
  }

  return (
    <>
      <Card>
        <CardContent>
          <Stack spacing={3}>
            <FormControl fullWidth disabled={busy}>
              <InputLabel>Bank Format</InputLabel>
              <Select value={bankConfig} label="Bank Format" onChange={e => onBankConfigChange(e.target.value)}>
                {Object.entries(bankConfigs).map(([key, cfg]) => (
                  <MenuItem key={key} value={key}>{cfg.description || key}</MenuItem>
                ))}
              </Select>
            </FormControl>

            <FormControl fullWidth disabled={busy}>
              <InputLabel>Account</InputLabel>
              <Select
                value={accountName}
                label="Account"
                onChange={e => handleAccountChange(e.target.value)}
                renderValue={(selected) => selected || <em>Pick an account...</em>}
              >
                {accounts.map(a => (
                  <MenuItem key={a.id} value={a.name}>
                    {a.name}
                    {a.account_type && (
                      <Box component="span" sx={{ ml: 1, color: 'text.secondary', fontSize: '0.78rem' }}>
                        ({a.account_type})
                      </Box>
                    )}
                  </MenuItem>
                ))}
                <Divider />
                <MenuItem value={CREATE_NEW_SENTINEL}>
                  <AddRoundedIcon sx={{ fontSize: 18, mr: 1 }} />
                  <em>Create new account...</em>
                </MenuItem>
              </Select>
            </FormControl>

            <Stack direction="row" spacing={2}>
              <Button onClick={onBack} disabled={busy}>Back</Button>
              <Button
                variant="contained"
                onClick={onNext}
                disabled={busy || !accountName}
              >
                {busy ? 'Working...' : 'Preview'}
              </Button>
            </Stack>
          </Stack>
        </CardContent>
      </Card>

      <Dialog
        open={createOpen}
        onClose={() => { if (!createSubmitting) setCreateOpen(false); }}
        maxWidth="xs"
        fullWidth
      >
        <DialogTitle>Create a new account</DialogTitle>
        <DialogContent>
          <Stack spacing={2.5} sx={{ mt: 0.5 }}>
            <TextField
              label="Name"
              size="small"
              fullWidth
              autoFocus
              value={createName}
              onChange={e => setCreateName(e.target.value)}
              helperText="e.g. Yonder, Amex Gold, Monzo, Mortgage"
            />

            <Box>
              <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1 }}>
                Account type
              </Typography>
              <RadioGroup
                value={createType}
                onChange={e => setCreateType(e.target.value as CreatableAccountType)}
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

            {createType === 'LIABILITY' && (
              <FormControl fullWidth size="small">
                <InputLabel>Account that pays this off (optional)</InputLabel>
                <Select
                  value={createPaysOff}
                  label="Account that pays this off (optional)"
                  onChange={e => {
                    const v = e.target.value as number | '';
                    setCreatePaysOff(v === '' ? '' : Number(v));
                  }}
                >
                  <MenuItem value=""><em>None</em></MenuItem>
                  {accounts
                    .filter(a => a.account_type === 'ASSET')
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

            {createError && <Alert severity="error">{createError}</Alert>}
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setCreateOpen(false)} disabled={createSubmitting}>Cancel</Button>
          <Button
            variant="contained"
            onClick={handleCreate}
            disabled={createSubmitting || !createName.trim()}
          >
            {createSubmitting ? 'Creating...' : 'Create + use'}
          </Button>
        </DialogActions>
      </Dialog>
    </>
  );
}
