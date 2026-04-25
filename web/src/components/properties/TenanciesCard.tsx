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
} from '@mui/material';
import EditIcon from '@mui/icons-material/Edit';
import DeleteIcon from '@mui/icons-material/Delete';
import AddIcon from '@mui/icons-material/Add';
import { formatCurrency } from '@/lib/utils/formatting';
import TenancyDialog, { TenancyFormValues } from './TenancyDialog';

interface Tenancy {
  id: number;
  propertyId: number;
  tenantName: string;
  startDate: string;
  endDate: string | null;
  rentAmount: string;
  rentFrequency: string;
  depositAmount: string | null;
  notes: string | null;
}

const fetcher = (url: string) => fetch(url).then(r => r.json());

const FREQ_LABEL: Record<string, string> = {
  monthly: '/ month',
  four_weekly: '/ 4 weeks',
  weekly: '/ week',
  quarterly: '/ quarter',
  annual: '/ year',
};

function isCurrent(t: Tenancy, today = new Date().toISOString().slice(0, 10)): boolean {
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
    if (editing) {
      await fetch(`/api/tenancies/${editing.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
    } else {
      await fetch(`/api/properties/${propertyId}/tenancies`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
    }
    setDialogOpen(false);
    setEditing(null);
    mutate();
  };

  const handleDelete = async (id: number) => {
    if (!confirm('Delete this tenancy? Recorded rental income journal entries are kept.')) return;
    await fetch(`/api/tenancies/${id}`, { method: 'DELETE' });
    mutate();
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
                    {isCurrent(t) ? (
                      <Chip size="small" color="success" label="Current" />
                    ) : t.endDate && t.endDate < new Date().toISOString().slice(0, 10) ? (
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
                rentFrequency: editing.rentFrequency as TenancyFormValues['rentFrequency'],
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
    </Card>
  );
}
