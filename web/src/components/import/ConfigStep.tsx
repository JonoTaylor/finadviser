'use client';

import {
  Card, CardContent, TextField, Button, Stack,
  MenuItem, Select, InputLabel, FormControl, Autocomplete,
} from '@mui/material';

interface BankConfig {
  name: string;
  description: string;
}

interface Account {
  id: number;
  name: string;
}

export default function ConfigStep({
  bankConfig,
  accountName,
  bankConfigs,
  accounts,
  onBankConfigChange,
  onAccountNameChange,
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
  onNext: () => void;
  onBack: () => void;
  busy?: boolean;
}) {
  return (
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

          <Autocomplete
            freeSolo
            disabled={busy}
            options={accounts.map(a => a.name)}
            value={accountName}
            onInputChange={(_, v) => onAccountNameChange(v)}
            renderInput={(params) => <TextField {...params} label="Account" />}
          />

          <Stack direction="row" spacing={2}>
            <Button onClick={onBack} disabled={busy}>Back</Button>
            <Button variant="contained" onClick={onNext} disabled={busy}>
              {busy ? 'Working…' : 'Preview'}
            </Button>
          </Stack>
        </Stack>
      </CardContent>
    </Card>
  );
}
