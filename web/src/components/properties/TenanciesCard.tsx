'use client';

import { useState } from 'react';
import useSWR from 'swr';
import {
  Card,
  CardContent,
  Typography,
  Stack,
  Button,
  Table,
  TableHead,
  TableRow,
  TableCell,
  TableBody,
  IconButton,
  Chip,
  Snackbar,
  Alert,
} from '@mui/material';
import EditIcon from '@mui/icons-material/Edit';
import DeleteIcon from '@mui/icons-material/Delete';
import AddIcon from '@mui/icons-material/Add';
import { formatCurrency } from '@/lib/utils/formatting';
import { londonTodayIso } from '@/lib/dates/today';
import type { RentFrequency } from '@/lib/repos/tenancy.repo';
import TenancyDialog, { TenancyFormValues } from './TenancyDialog';

interface Tenancy {
  id: number;
  propertyId: number;
  tenantName: string;
  startDate: string;
  endDate: string | null;
  rentAmount: string;
  rentFrequency: RentFrequency;
  depositAmount: string | null;
  notes: string | null;
}

const fetcher = (url: string) => fetch(url).then(r => r.json());

const FREQ_LABEL: Record<RentFrequency, string> = {
  monthly: '/ month',
  four_weekly: '/ 4 weeks',
  weekly: '/ week',
  quarterly: '/ quarter',
  annual: '/ year',
};

function isCurrent(t: Tenancy, today: string): boolean {
  if (t.startDate > today) return false;
  if (t.endDate && t.endDate < today) return false;
  return true;
}

export default function TenanciesCard({ propertyId }: { propertyId: number }) {
  const { data: tenancies, mutate } = useSWR<Tenancy[]>(
    `/api/properties/${propertyId}/tenancies`,
    fetcher,
  );
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<Tenancy | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const today = londonTodayIso();

  const handleSave = async (data: TenancyFormValues) => {
    const payload = {
      tenantName: data.tenantName,
      startDate: data.startDate,
      endDate: data.endDate || null,
      rentAmount: data.rentAmount,
      rentFrequency: data.rentFrequency,
      depositAmount: data.depositAmount || null,
      notes: data.notes || null,
    };
    try {
      const url = editing ? `/api/tenancies/${editing.id}` : `/api/properties/${propertyId}/tenancies`;
      const res = await fetch(url, {
        method: editing ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }
      setDialogOpen(false);
      setEditing(null);
      mutate();
    } catch (e) {
      setErrorMsg(e instanceof Error ? e.message : 'Failed to save tenancy');
    }
  };

  const handleDelete = async (id: number) => {
    if (!confirm('Delete this tenancy?')) return;
    try {
      const res = await fetch(`/api/tenancies/${id}`, { method: 'DELETE' });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }
      mutate();
    } catch (e) {
      setErrorMsg(e instanceof Error ? e.message : 'Failed to delete tenancy');
    }
  };

  const list = tenancies ?? [];

  return (
    <Card sx={{ mb: 3 }}>
      <CardContent>
        <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 1 }}>
          <Typography variant="h6">Tenancies</Typography>
          <Button
            startIcon={<AddIcon />}
            size="small"
            variant="outlined"
            onClick={() => {
              setEditing(null);
              setDialogOpen(true);
            }}
          >
            Add
          </Button>
        </Stack>

        {list.length === 0 ? (
          <Typography variant="body2" color="text.secondary">
            No tenancies recorded. Add one to enable rental income capture and tax-year reporting.
          </Typography>
        ) : (
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>Tenant(s)</TableCell>
                <TableCell>Start</TableCell>
                <TableCell>End</TableCell>
                <TableCell align="right">Rent</TableCell>
                <TableCell>Status</TableCell>
                <TableCell align="right" />
              </TableRow>
            </TableHead>
            <TableBody>
              {list.map(t => (
                <TableRow key={t.id}>
                  <TableCell>{t.tenantName}</TableCell>
                  <TableCell>{t.startDate}</TableCell>
                  <TableCell>{t.endDate ?? '—'}</TableCell>
                  <TableCell align="right">
                    {formatCurrency(t.rentAmount)} {FREQ_LABEL[t.rentFrequency] ?? ''}
                  </TableCell>
                  <TableCell>
                    {isCurrent(t, today) ? (
                      <Chip size="small" color="success" label="Current" />
                    ) : t.endDate && t.endDate < today ? (
                      <Chip size="small" label="Past" />
                    ) : (
                      <Chip size="small" label="Future" />
                    )}
                  </TableCell>
                  <TableCell align="right">
                    <IconButton
                      size="small"
                      onClick={() => {
                        setEditing(t);
                        setDialogOpen(true);
                      }}
                    >
                      <EditIcon fontSize="small" />
                    </IconButton>
                    <IconButton size="small" onClick={() => handleDelete(t.id)}>
                      <DeleteIcon fontSize="small" />
                    </IconButton>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>

      <TenancyDialog
        open={dialogOpen}
        title={editing ? 'Edit tenancy' : 'Add tenancy'}
        initial={
          editing
            ? {
                tenantName: editing.tenantName,
                startDate: editing.startDate,
                endDate: editing.endDate ?? '',
                rentAmount: editing.rentAmount,
                rentFrequency: editing.rentFrequency,
                depositAmount: editing.depositAmount ?? '',
                notes: editing.notes ?? '',
              }
            : null
        }
        onClose={() => {
          setDialogOpen(false);
          setEditing(null);
        }}
        onSave={handleSave}
      />

      <Snackbar
        open={Boolean(errorMsg)}
        autoHideDuration={6000}
        onClose={() => setErrorMsg(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      >
        <Alert severity="error" onClose={() => setErrorMsg(null)}>
          {errorMsg}
        </Alert>
      </Snackbar>
    </Card>
  );
}
