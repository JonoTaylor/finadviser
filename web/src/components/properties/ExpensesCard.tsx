'use client';

import { useState } from 'react';
import {
  Card,
  CardContent,
  Typography,
  Stack,
  Button,
  Snackbar,
  Alert,
  CircularProgress,
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import ReceiptIcon from '@mui/icons-material/ReceiptLong';
import LinkRoundedIcon from '@mui/icons-material/LinkRounded';
import Link from 'next/link';
import { currentTaxYear } from '@/lib/tax/ukTaxYear';
import AddExpenseDialog from './AddExpenseDialog';

export default function ExpensesCard({ propertyId }: { propertyId: number }) {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [linking, setLinking] = useState(false);
  const [snack, setSnack] = useState<{ open: boolean; message: string; severity: 'success' | 'error' | 'info' }>({
    open: false, message: '', severity: 'success',
  });
  const taxYear = currentTaxYear();

  const handleAutoLink = async () => {
    setLinking(true);
    try {
      const res = await fetch(`/api/properties/${propertyId}/auto-link-expenses`, { method: 'POST' });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }
      const data = (await res.json()) as { linked: number };
      setSnack({
        open: true,
        severity: data.linked > 0 ? 'success' : 'info',
        message: data.linked > 0
          ? `Linked ${data.linked} previously-unlinked expense${data.linked === 1 ? '' : 's'} to this property.`
          : 'No unlinked property expenses found.',
      });
    } catch (e) {
      setSnack({ open: true, message: e instanceof Error ? e.message : 'Failed to auto-link', severity: 'error' });
    } finally {
      setLinking(false);
    }
  };

  return (
    <Card sx={{ mb: 3 }}>
      <CardContent>
        <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 1 }} flexWrap="wrap" useFlexGap>
          <Typography variant="h6">Expenses</Typography>
          <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
            <Button
              size="small"
              variant="text"
              startIcon={linking ? <CircularProgress size={14} /> : <LinkRoundedIcon />}
              disabled={linking}
              onClick={handleAutoLink}
              title="Find every transaction categorised under a property-expense category that isn't yet linked to this property, and link them."
            >
              {linking ? 'Linking…' : 'Auto-link existing'}
            </Button>
            <Button
              size="small"
              variant="outlined"
              startIcon={<ReceiptIcon />}
              component={Link}
              href={`/properties/${propertyId}/reports/${taxYear.label}`}
            >
              View on tax-year report
            </Button>
            <Button
              size="small"
              variant="contained"
              startIcon={<AddIcon />}
              onClick={() => setDialogOpen(true)}
            >
              Add expense
            </Button>
          </Stack>
        </Stack>
        <Typography variant="body2" color="text.secondary">
          Record itemised deductible expenses for this property. Use the
          UK BTL categories (repairs, insurance, agent fees, etc.). Mortgage
          interest is tracked separately on its own card under the property&apos;s
          mortgage payments. <strong>Auto-link existing</strong> attaches any
          past transactions you&apos;ve already categorised as property expenses
          to this property in one go — useful after a categorisation pass.
        </Typography>
      </CardContent>

      <AddExpenseDialog
        open={dialogOpen}
        propertyId={propertyId}
        onClose={() => setDialogOpen(false)}
        onSaved={() => setDialogOpen(false)}
      />

      <Snackbar
        open={snack.open}
        autoHideDuration={4000}
        onClose={() => setSnack(s => ({ ...s, open: false }))}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      >
        <Alert
          onClose={() => setSnack(s => ({ ...s, open: false }))}
          severity={snack.severity}
          variant="filled"
          sx={{ width: '100%' }}
        >
          {snack.message}
        </Alert>
      </Snackbar>
    </Card>
  );
}
