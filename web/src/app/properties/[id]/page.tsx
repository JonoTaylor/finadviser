'use client';

import { useState, use } from 'react';
import { Alert, Box, Typography, Grid, Button, Card, CardContent, Skeleton, Stack, Divider } from '@mui/material';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import useSWR from 'swr';
import Link from 'next/link';
import { formatCurrency } from '@/lib/utils/formatting';
import EquityBar from '@/components/properties/EquityBar';
import OwnershipTable from '@/components/properties/OwnershipTable';
import MortgageCard from '@/components/properties/MortgageCard';
import MortgageRateHistoryCard from '@/components/properties/MortgageRateHistoryCard';
import ValuationHistory from '@/components/properties/ValuationHistory';
import AddValuationDialog from '@/components/properties/AddValuationDialog';
import RecordPaymentDialog from '@/components/properties/RecordPaymentDialog';
import TenanciesCard from '@/components/properties/TenanciesCard';
import ExpensesCard from '@/components/properties/ExpensesCard';
import MortgageInterestSummary from '@/components/properties/MortgageInterestSummary';
import BtlDecisionCard from '@/components/properties/BtlDecisionCard';
import ReceiptLongIcon from '@mui/icons-material/ReceiptLong';
import InsightsOutlinedIcon from '@mui/icons-material/InsightsOutlined';
import { currentTaxYear } from '@/lib/tax/ukTaxYear';
import PageHeader from '@/components/ui/PageHeader';
import { fetchJson } from '@/lib/http/client';

const fetcher = async (url: string) => {
  const response = await fetch(url);
  if (!response.ok) throw new Error('The property record could not be loaded.');
  return response.json();
};

export default function PropertyDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const propertyId = parseInt(id, 10);
  const { data: property, error, isLoading, mutate } = useSWR(`/api/properties/${id}`, fetcher);
  const { data: equity, error: equityError, mutate: mutateEquity } = useSWR(`/api/properties/${id}/equity`, fetcher);
  const [valuationOpen, setValuationOpen] = useState(false);
  const [paymentOpen, setPaymentOpen] = useState(false);

  if (isLoading) return <Skeleton variant="rounded" height={400} />;
  if (error) return <Box><PageHeader title="Property details" /><Alert severity="warning" action={<Button size="small" onClick={() => void mutate()}>Retry</Button>}>The property record could not be loaded. Its details and financial figures are unavailable.</Alert></Box>;
  if (!property) return <Typography>Property not found</Typography>;

  const handleAddValuation = async (data: { valuation: string; valuationDate: string; source: string }) => {
    await fetchJson(`/api/properties/${id}/valuations`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    void Promise.allSettled([mutate(), mutateEquity()]);
  };

  const handleRecordPayment = async (data: Record<string, unknown>) => {
    await fetchJson(`/api/properties/${id}/mortgages/payment`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    void Promise.allSettled([mutate(), mutateEquity()]);
  };

  return (
    <Box>
      <Button component={Link} href="/properties" startIcon={<ArrowBackIcon />} sx={{ mb: 2 }}>
        Back to Properties
      </Button>

      <PageHeader title={property.name} description={property.address && <Box component="span" sx={{ overflowWrap: 'anywhere' }}>{property.address}</Box>} actions={<>
        <Button variant="contained" size="small" onClick={() => setValuationOpen(true)}>Add Valuation</Button>
        {property.mortgages?.length > 0 && <Button variant="outlined" size="small" onClick={() => setPaymentOpen(true)}>Record Payment</Button>}
      </>} />

      <Grid container spacing={2} sx={{ mb: 3 }}>
        <Grid size={{ xs: 12, md: 8 }}>
          <Card sx={{ height: '100%', minWidth: 0 }}>
            <CardContent>
              <Typography variant="h6" gutterBottom>Equity Breakdown</Typography>
              {equityError ? <Alert severity="warning">Ownership figures could not be loaded. The recorded ownership breakdown is unavailable.</Alert> : equity && equity.length > 0 ? (
                <>
                  <EquityBar owners={equity} />
                  <Divider sx={{ my: 2 }} />
                  <Box sx={{ overflowX: 'auto' }}><OwnershipTable owners={equity} /></Box>
                </>
              ) : (
                <Typography color="text.secondary">No ownership data available</Typography>
              )}
            </CardContent>
          </Card>
        </Grid>
        <Grid size={{ xs: 12, md: 4 }}>
          <Card sx={{ height: '100%' }}>
            <CardContent>
              <Typography variant="h6" gutterBottom>Details</Typography>
              <Box sx={{ display: 'grid', gridTemplateColumns: { xs: 'repeat(2, minmax(0, 1fr))', md: '1fr' }, gap: 2 }}>
                {property.purchasePrice && <Box sx={{ minWidth: 0 }}><Typography variant="caption" color="text.secondary">Purchase Price</Typography><Typography sx={{ mt: 0.5, fontSize: '1.25rem', fontWeight: 600, fontVariantNumeric: 'tabular-nums', overflowWrap: 'anywhere' }}>{formatCurrency(property.purchasePrice)}</Typography></Box>}
                {property.purchaseDate && <Box sx={{ minWidth: 0 }}><Typography variant="caption" color="text.secondary">Purchase Date</Typography><Typography sx={{ mt: 0.5 }}>{property.purchaseDate}</Typography></Box>}
              </Box>
            </CardContent>
          </Card>
        </Grid>
      </Grid>

      <Grid container spacing={3}>
        <Grid size={{ xs: 12, md: 8 }}>
          <BtlDecisionCard propertyId={propertyId} />

          <TenanciesCard propertyId={propertyId} />

          <ExpensesCard propertyId={propertyId} />

          {property.mortgages?.map((m: { id: number; lender: string }) => (
            <MortgageRateHistoryCard key={`rates-${m.id}`} mortgageId={m.id} lender={m.lender} />
          ))}

          <ValuationHistory valuations={property.valuations ?? []} />
        </Grid>

        <Grid size={{ xs: 12, md: 4 }}>
          {property.mortgages?.map((m: { id: number; lender: string; originalAmount: string; startDate: string; termMonths: number; interestOnly?: boolean }) => (
            <MortgageCard key={m.id} mortgage={m} onChange={() => mutate()} />
          ))}

          {property.mortgages?.length > 0 && (
            <MortgageInterestSummary propertyId={propertyId} />
          )}

          <Stack direction="row" spacing={1} sx={{ mt: 2 }} flexWrap="wrap" useFlexGap>
            {property.mortgages?.length > 0 && (
              <Button
                variant="outlined"
                size="small"
                component={Link}
                /* getMortgages orders by startDate ASC, so the LAST
                 * entry is the most recent (active) mortgage - the
                 * one the user most likely wants when bulk-adding
                 * payments. Properties with only one mortgage land
                 * on the same row either way. For multi-mortgage
                 * properties (first + second charge) the bulk page
                 * still requires picking the right mortgage but at
                 * least the default is sensible. */
                href={`/properties/${id}/mortgages/${property.mortgages[property.mortgages.length - 1].id}/payments`}
              >
                Bulk add payments
              </Button>
            )}
            <Button
              component={Link}
              href={`/properties/${id}/reports/${currentTaxYear().label}`}
              variant="outlined"
              size="small"
              startIcon={<ReceiptLongIcon />}
            >
              Tax-year report
            </Button>
            <Button
              component={Link}
              href={`/properties/${id}/decision`}
              variant="outlined"
              size="small"
              startIcon={<InsightsOutlinedIcon />}
            >
              Decision support
            </Button>
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
