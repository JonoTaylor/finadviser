'use client';

import { useState } from 'react';
import {
  Card, CardContent, Button, Stack,
  MenuItem, Select, InputLabel, FormControl, Divider, Box,
  type SelectChangeEvent,
} from '@mui/material';
import AddRoundedIcon from '@mui/icons-material/AddRounded';
import CreateAccountDialog from './CreateAccountDialog';

interface BankConfig {
  name: string;
  description: string;
}

// /api/accounts returns the Drizzle-mapped row shape, which uses
// camelCase (`accountType`) - the snake_case `account_type` is the
// DB column name only.
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

  // Resolve the parent's accountName state to a numeric Select value.
  // If the name doesn't match anything in the list (e.g. the default
  // 'Bank' before such an account exists, or stale state from a
  // deleted account), fall back to '' so the Select shows the
  // placeholder rather than emitting an out-of-options warning.
  const matchingAccount = accounts.find(a => a.name === accountName);
  const selectValue: SelectValue = matchingAccount ? matchingAccount.id : '';

  function handleAccountSelectChange(e: SelectChangeEvent<SelectValue>) {
    const v = e.target.value;
    if (v === CREATE_NEW_SENTINEL) {
      setCreateOpen(true);
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

  function handleCreated(newAccountName: string) {
    onAccountNameChange(newAccountName);
    onAccountsChanged?.();
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

      <CreateAccountDialog
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onCreated={handleCreated}
        accounts={accounts}
      />
    </>
  );
}
