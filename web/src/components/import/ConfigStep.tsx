'use client';

import { useState } from 'react';
import {
  Card, CardContent, TextField, Button, Stack,
  MenuItem, Select, InputLabel, FormControl, Divider,
  Dialog, DialogTitle, DialogContent, DialogActions,
  RadioGroup, FormControlLabel, Radio, Typography, Box, Alert,
  type SelectChangeEvent,
} from '@mui/material';
import AddRoundedIcon from '@mui/icons-material/AddRounded';

interface BankConfig {
  name: string;
  description: string;
}

// /api/accounts returns the Drizzle-mapped row shape, which uses
// camelCase (`accountType`) - the snake_case `account_type` is the
// DB column name only. The earlier version of this file used the
// snake_case key here and the LIABILITY pays-off filter silently
// returned nothing as a result.
interface Account {
  id: number;
  name: string;
  accountType?: string;
}

// The Select binds to numeric account ids for real rows + a string
// sentinel for "Create new..." + '' for the empty / placeholder
// state. Real account values are numbers and the sentinel is a
// string, so an account literally named '__create_new__' can't
// collide with the menu (its Select value is its numeric id).
const CREATE_NEW_SENTINEL = '__create_new__' as const;
type SelectValue = number | typeof CREATE_NEW_SENTINEL | '';

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

  // Resolve the parent's accountName state to a numeric Select value.
  // If the name doesn't match anything in the list (e.g. the default
  // 'Bank' before the user has created such an account, or stale state
  // from a deleted account), fall back to '' so the Select shows the
  // placeholder rather than emitting an out-of-options warning.
  const matchingAccount = accounts.find(a => a.name === accountName);
  const selectValue: SelectValue = matchingAccount ? matchingAccount.id : '';

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
      // create so the front-end doesn't need a separate PATCH and
      // a network blip mid-flow doesn't strand a half-created row.
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

      onAccountNameChange(created.name);
      onAccountsChanged?.();
      setCreateOpen(false);
    } catch (e) {
      setCreateError(e instanceof Error ? e.message : 'Failed to create account');
    } finally {
      setCreateSubmitting(false);
    }
  }

  function handleAccountSelectChange(e: SelectChangeEvent<SelectValue>) {
    const v = e.target.value;
    if (v === CREATE_NEW_SENTINEL) {
      openCreateDialog();
      return;
    }
    if (v === '' || v === undefined) {
      onAccountNameChange('');
      return;
    }
    // Translate id back to name for the parent (which keeps state as
    // a string for the import-pipeline `accountName` parameter).
    const id = typeof v === 'number' ? v : Number(v);
    const acc = accounts.find(a => a.id === id);
    onAccountNameChange(acc?.name ?? '');
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
              <InputLabel shrink>Account</InputLabel>
              <Select<SelectValue>
                value={selectValue}
                label="Account"
                displayEmpty
                onChange={handleAccountSelectChange}
                renderValue={(selected) => {
                  if (selected === '' || selected === undefined) {
                    return <Box component="em" sx={{ color: 'text.secondary' }}>Pick an account...</Box>;
                  }
                  if (selected === CREATE_NEW_SENTINEL) {
                    return <em>Create new account...</em>;
                  }
                  const acc = accounts.find(a => a.id === selected);
                  return acc?.name ?? '';
                }}
              >
                {accounts.map(a => (
                  <MenuItem key={a.id} value={a.id}>
                    {a.name}
                    {a.accountType && (
                      <Box component="span" sx={{ ml: 1, color: 'text.secondary', fontSize: '0.78rem' }}>
                        ({a.accountType})
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
                <InputLabel shrink>Account that pays this off (optional)</InputLabel>
                <Select<number | ''>
                  value={createPaysOff}
                  label="Account that pays this off (optional)"
                  displayEmpty
                  onChange={e => {
                    const v = e.target.value;
                    setCreatePaysOff(v === '' || v === undefined ? '' : Number(v));
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
