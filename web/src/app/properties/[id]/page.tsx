'use client';

import { useState, use } from 'react';
import { Box, Typography, Grid, Button, Card, CardContent, Skeleton, Stack, Divider } from '@mui/material';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import useSWR from 'swr';
import Link from 'next/link';
import { formatCurrency, formatPercentage } from '@/lib/utils/formatting';
import EquityBar from '@/components/properties/EquityBar';
import OwnershipTable from '@/components/properties/OwnershipTable';
import MortgageCard from '@/components/properties/MortgageCard';
import ValuationHistory from '@/components/properties/ValuationHistory';
import AddValuationDialog from '@/components/properties/AddValuationDialog';
import RecordPaymentDialog from '@/components/properties/RecordPaymentDialog';

const fetcher = (url: string) => fetch(url).then(r => r.json());

export default function PropertyDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { data: property, isLoading, mutate } = useSWR(`/api/properties/${id}`, fetcher);
  const { data: equity, mutate: mutateEquity } = useSWR(`/api/properties/${id}/equity`, fetcher);
  const [valuationOpen, setValuationOpen] = useState(false);
  const [paymentOpen, setPaymentOpen] = useState(false);

  if (isLoading) return <Skeleton variant="rounded" height={400} />;
  if (!property) return <Typography>Property not found</Typography>;

  const handleAddValuation = async (data: { valuation: string; valuationDate: string; source: string }) => {
    await fetch(`/api/properties/${id}/valuations`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    setValuationOpen(false);
    mutate();
    mutateEquity();
  };

  const handleRecordPayment = async (data: Record<string, unknown>) => {
    await fetch(`/api/properties/${id}/mortgages/payment`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    setPaymentOpen(false);
    mutate();
    mutateEquity();
  };

  return (
    <Box>
      <Button component={Link} href="/properties" startIcon={<ArrowBackIcon />} sx={{ mb: 2 }}>
        Back to Properties
      </Button>

      <Typography variant="h4" sx={{ mb: 1 }}>{property.name}</Typography>
      {property.address && (
        <Typography variant="body1" color="text.secondary" sx={{ mb: 3 }}>
          {property.address}
        </Typography>
      )}

      <Grid container spacing={3}>
        <Grid size={{ xs: 12, md: 8 }}>
          <Card sx={{ mb: 3 }}>
            <CardContent>
              <Typography variant="h6" gutterBottom>Equity Breakdown</Typography>
              {equity && equity.length > 0 ? (
                <>
                  <EquityBar owners={equity} />
                  <Divider sx={{ my: 2 }} />
                  <OwnershipTable owners={equity} />
                </>
              ) : (
                <Typography color="text.secondary">No ownership data available</Typography>
              )}
            </CardContent>
          </Card>

          <ValuationHistory valuations={property.valuations ?? []} />
        </Grid>

        <Grid size={{ xs: 12, md: 4 }}>
          <Card sx={{ mb: 3 }}>
            <CardContent>
              <Typography variant="h6" gutterBottom>Details</Typography>
              <Stack spacing={1}>
                {property.purchasePrice && (
                  <Box>
                    <Typography variant="caption" color="text.secondary">Purchase Price</Typography>
                    <Typography fontWeight={600}>{formatCurrency(property.purchasePrice)}</Typography>
                  </Box>
                )}
                {property.purchaseDate && (
                  <Box>
                    <Typography variant="caption" color="text.secondary">Purchase Date</Typography>
                    <Typography>{property.purchaseDate}</Typography>
                  </Box>
                )}
              </Stack>
            </CardContent>
          </Card>

          {property.mortgages?.map((m: { id: number; lender: string; originalAmount: string; startDate: string; termMonths: number }) => (
            <MortgageCard key={m.id} mortgage={m} propertyId={parseInt(id)} />
          ))}

          <Stack direction="row" spacing={1} sx={{ mt: 2 }}>
            <Button variant="outlined" size="small" onClick={() => setValuationOpen(true)}>
              Add Valuation
            </Button>
            {property.mortgages?.length > 0 && (
              <Button variant="outlined" size="small" onClick={() => setPaymentOpen(true)}>
                Record Payment
              </Button>
            )}
          </Stack>
        </Grid>
      </Grid>

      <AddValuationDialog open={valuationOpen} onClose={() => setValuationOpen(false)} onSave={handleAddValuation} />
      <RecordPaymentDialog
        open={paymentOpen}
        onClose={() => setPaymentOpen(false)}
        onSave={handleRecordPayment}
        mortgages={property.mortgages ?? []}
        ownership={property.ownership ?? []}
      />
    </Box>
  );
}
