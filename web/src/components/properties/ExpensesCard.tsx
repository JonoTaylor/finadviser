'use client';

import { useState } from 'react';
import {
  Card,
  CardContent,
  Typography,
  Stack,
  Button,
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import ReceiptIcon from '@mui/icons-material/ReceiptLong';
import Link from 'next/link';
import { currentTaxYear } from '@/lib/tax/ukTaxYear';
import AddExpenseDialog from './AddExpenseDialog';

export default function ExpensesCard({ propertyId }: { propertyId: number }) {
  const [dialogOpen, setDialogOpen] = useState(false);
  const taxYear = currentTaxYear();

  return (
    <Card sx={{ mb: 3 }}>
      <CardContent>
        <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 1 }}>
          <Typography variant="h6">Expenses</Typography>
          <Stack direction="row" spacing={1}>
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
          mortgage payments.
        </Typography>
      </CardContent>

      <AddExpenseDialog
        open={dialogOpen}
        propertyId={propertyId}
        onClose={() => setDialogOpen(false)}
        onSaved={() => setDialogOpen(false)}
      />
    </Card>
  );
}
