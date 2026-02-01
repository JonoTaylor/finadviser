'use client';

import { Card, CardContent, Typography, Box } from '@mui/material';
import useSWR from 'swr';
import { formatCurrency } from '@/lib/utils/formatting';
import Decimal from 'decimal.js';

const fetcher = (url: string) => fetch(url).then(r => r.json());

interface Mortgage {
  id: number;
  lender: string;
  originalAmount: string;
  startDate: string;
  termMonths: number;
}

export default function MortgageCard({ mortgage, propertyId }: { mortgage: Mortgage; propertyId: number }) {
  return (
    <Card sx={{ mb: 2 }}>
      <CardContent>
        <Typography variant="subtitle2" color="text.secondary">Mortgage</Typography>
        <Typography variant="h6" sx={{ fontSize: '1rem' }}>{mortgage.lender}</Typography>
        <Box sx={{ mt: 1 }}>
          <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
            <Typography variant="body2" color="text.secondary">Original</Typography>
            <Typography variant="body2">{formatCurrency(mortgage.originalAmount)}</Typography>
          </Box>
          <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
            <Typography variant="body2" color="text.secondary">Start Date</Typography>
            <Typography variant="body2">{mortgage.startDate}</Typography>
          </Box>
          <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
            <Typography variant="body2" color="text.secondary">Term</Typography>
            <Typography variant="body2">{Math.round(mortgage.termMonths / 12)} years</Typography>
          </Box>
        </Box>
      </CardContent>
    </Card>
  );
}
