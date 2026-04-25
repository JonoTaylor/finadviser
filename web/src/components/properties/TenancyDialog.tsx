'use client';

import { useState } from 'react';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  TextField,
  Stack,
  MenuItem,
} from '@mui/material';

export interface TenancyFormValues {
  tenantName: string;
  startDate: string;
  endDate: string;
  rentAmount: string;
  rentFrequency: 'monthly' | 'weekly' | 'four_weekly' | 'quarterly' | 'annual';
  depositAmount: string;
  notes: string;
}

const empty: TenancyFormValues = {
  tenantName: '',
  startDate: '',
  endDate: '',
  rentAmount: '',
  rentFrequency: 'monthly',
  depositAmount: '',
  notes: '',
};

export default function TenancyDialog({
  open,
  initial,
  onClose,
  onSave,
  title = 'Add tenancy',
}: {
  open: boolean;
  initial?: Partial<TenancyFormValues> | null;
  onClose: () => void;
  onSave: (data: TenancyFormValues) => void;
  title?: string;
}) {
  const [form, setForm] = useState<TenancyFormValues>(() => ({ ...empty, ...(initial ?? {}) }));
  const [prevOpen, setPrevOpen] = useState(open);

  // Reset form when dialog transitions to open. Adjusting state during render
  // is the React-19 idiomatic alternative to setState-in-effect.
  if (open !== prevOpen) {
    setPrevOpen(open);
    if (open) setForm({ ...empty, ...(initial ?? {}) });
  }

  const valid = form.tenantName && form.startDate && form.rentAmount;

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>{title}</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ mt: 1 }}>
          <TextField
            label="Tenant name(s)"
            required
            value={form.tenantName}
            onChange={e => setForm({ ...form, tenantName: e.target.value })}
            helperText="e.g. 'Alice Smith & Bob Jones' for joint tenants"
          />
          <Stack direction="row" spacing={2}>
            <TextField
              label="Start date"
              type="date"
              required
              fullWidth
              slotProps={{ inputLabel: { shrink: true } }}
              value={form.startDate}
              onChange={e => setForm({ ...form, startDate: e.target.value })}
            />
            <TextField
              label="End date"
              type="date"
              fullWidth
              slotProps={{ inputLabel: { shrink: true } }}
              value={form.endDate}
              onChange={e => setForm({ ...form, endDate: e.target.value })}
              helperText="Leave blank if ongoing"
            />
          </Stack>
          <Stack direction="row" spacing={2}>
            <TextField
              label="Rent amount (£)"
              type="number"
              required
              fullWidth
              value={form.rentAmount}
              onChange={e => setForm({ ...form, rentAmount: e.target.value })}
            />
            <TextField
              select
              label="Frequency"
              fullWidth
              value={form.rentFrequency}
              onChange={e => setForm({ ...form, rentFrequency: e.target.value as TenancyFormValues['rentFrequency'] })}
            >
              <MenuItem value="monthly">Monthly</MenuItem>
              <MenuItem value="four_weekly">Every 4 weeks</MenuItem>
              <MenuItem value="weekly">Weekly</MenuItem>
              <MenuItem value="quarterly">Quarterly</MenuItem>
              <MenuItem value="annual">Annual</MenuItem>
            </TextField>
          </Stack>
          <TextField
            label="Deposit (£)"
            type="number"
            value={form.depositAmount}
            onChange={e => setForm({ ...form, depositAmount: e.target.value })}
          />
          <TextField
            label="Notes"
            multiline
            minRows={2}
            value={form.notes}
            onChange={e => setForm({ ...form, notes: e.target.value })}
          />
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="contained" disabled={!valid} onClick={() => onSave(form)}>
          Save
        </Button>
      </DialogActions>
    </Dialog>
  );
}
