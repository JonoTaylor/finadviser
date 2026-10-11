'use client';

import { useState } from 'react';
import { Alert, Box, Typography, Grid, Card, CardContent, CardActionArea, Button, Divider, Skeleton, Stack } from '@mui/material';
import AddRoundedIcon from '@mui/icons-material/AddRounded';
import HomeWorkRoundedIcon from '@mui/icons-material/HomeWorkRounded';
import ArrowForwardRoundedIcon from '@mui/icons-material/ArrowForwardRounded';
import useSWR from 'swr';
import Link from 'next/link';
import { formatCurrency } from '@/lib/utils/formatting';
import { fetchJson } from '@/lib/http/client';
import type { Property } from '@/lib/types';
import AddPropertyDialog from '@/components/properties/AddPropertyDialog';
import PageHeader from '@/components/ui/PageHeader';

type PropertyLite = Pick<Property, 'id' | 'name' | 'address' | 'purchasePrice' | 'purchaseDate'>;

const fetcher = async (url: string): Promise<PropertyLite[]> => {
  const data = await fetchJson<PropertyLite[]>(url);
  if (!Array.isArray(data) || data.some(property => (
    !property || !Number.isInteger(property.id) || typeof property.name !== 'string'
    || (property.address !== null && typeof property.address !== 'string')
    || (property.purchaseDate !== null && typeof property.purchaseDate !== 'string')
    || (property.purchasePrice !== null && (typeof property.purchasePrice !== 'string' || !/^-?\d+(?:\.\d+)?$/.test(property.purchasePrice)))
  ))) {
    throw new Error('The server returned an unreadable property list. Please try again.');
  }
  return data;
};

export default function PropertiesPage() {
  const { data: properties, error, isLoading, mutate } = useSWR<PropertyLite[]>('/api/properties', fetcher);
  const [addOpen, setAddOpen] = useState(false);

  const handleAdd = async (data: { name: string; address: string; purchaseDate: string; purchasePrice: string }) => {
    await fetchJson<PropertyLite>('/api/properties', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...data,
        address: data.address.trim() || null,
        purchaseDate: data.purchaseDate || null,
        purchasePrice: data.purchasePrice || null,
      }),
    });
    setAddOpen(false);
    void mutate();
  };

  return (
    <Box sx={{ maxWidth: 1440, mx: 'auto' }}>
      <PageHeader title="Property portfolio" description="Manage your properties, mortgages and rental activity."
        actions={<>
          <Button component={Link} href="/properties/operations" variant="outlined">
            Rent &amp; tasks
          </Button>
          <Button variant="contained" startIcon={<AddRoundedIcon />} onClick={() => setAddOpen(true)}>
            Add property
          </Button>
        </>} />

      {error ? (
        <Alert severity="error" action={<Button color="inherit" onClick={() => void mutate()}>Retry</Button>}>
          Properties could not be loaded. {error instanceof Error ? error.message : 'Please try again.'}
        </Alert>
      ) : isLoading ? (
        <Grid container spacing={2}>{[1, 2, 3, 4].map(item => <Grid key={item} size={{ xs: 12, md: 6 }}><Skeleton variant="rounded" height={200} /></Grid>)}</Grid>
      ) : !properties || properties.length === 0 ? (
        <Card><CardContent sx={{ py: 5, textAlign: 'center' }}>
          <Box sx={{ width: 44, height: 44, borderRadius: '8px', bgcolor: '#F1F5F9', color: 'text.secondary', display: 'grid', placeItems: 'center', mx: 'auto', mb: 2 }}><HomeWorkRoundedIcon /></Box>
          <Typography variant="h6">Add your first property</Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mt: 1, mb: 3 }}>Record the property, then add valuations, mortgages and tenancy details.</Typography>
          <Button variant="contained" startIcon={<AddRoundedIcon />} onClick={() => setAddOpen(true)}>Add property</Button>
        </CardContent></Card>
      ) : (
        <Grid container spacing={2}>
          {properties.map(prop => (
            <Grid key={prop.id} size={{ xs: 12, md: 6 }}>
              <Card sx={{ height: '100%' }}>
                <CardActionArea component={Link} href={`/properties/${prop.id}`} aria-label={`View ${prop.name}`} sx={{ height: '100%', '&:hover': { bgcolor: '#F8FAFC' } }}>
                  <CardContent>
                    <Stack direction="row" justifyContent="space-between" alignItems="flex-start" gap={2}>
                      <Stack direction="row" gap={1.5} sx={{ minWidth: 0 }}><Box sx={{ width: 40, height: 40, flexShrink: 0, bgcolor: '#F1F5F9', borderRadius: '8px', color: 'text.secondary', display: 'grid', placeItems: 'center' }}><HomeWorkRoundedIcon fontSize="small" /></Box><Box sx={{ minWidth: 0 }}><Typography variant="h6" sx={{ overflowWrap: 'anywhere' }}>{prop.name}</Typography><Typography variant="body2" color="text.secondary" sx={{ mt: 0.25, overflowWrap: 'anywhere' }}>{prop.address || 'Address not recorded'}</Typography></Box></Stack>
                      <ArrowForwardRoundedIcon sx={{ color: 'text.secondary', fontSize: 18, mt: 0.5, flexShrink: 0 }} />
                    </Stack>
                    <Divider sx={{ my: 2.5 }} />
                    <Stack direction="row" gap={3} justifyContent="space-between"><Box sx={{ minWidth: 0 }}><Typography variant="caption">Recorded purchase price</Typography><Typography variant="subtitle1" sx={{ mt: 0.5, fontVariantNumeric: 'tabular-nums', overflowWrap: 'anywhere' }}>{prop.purchasePrice ? formatCurrency(prop.purchasePrice) : 'Not recorded'}</Typography></Box><Box sx={{ minWidth: 0, textAlign: 'right' }}><Typography variant="caption">Purchase date</Typography><Typography variant="body2" sx={{ mt: 0.5 }}>{prop.purchaseDate || 'Not recorded'}</Typography></Box></Stack>
                    <Stack direction="row" justifyContent="space-between" alignItems="center" gap={2} sx={{ mt: 2.5 }}><Typography variant="caption">Purchase price is not a current valuation.</Typography><Typography variant="caption" color="primary.main" fontWeight={600} sx={{ whiteSpace: 'nowrap' }}>View property</Typography></Stack>
                  </CardContent>
                </CardActionArea>
              </Card>
            </Grid>
          ))}
        </Grid>
      )}

      <AddPropertyDialog open={addOpen} onClose={() => setAddOpen(false)} onSave={handleAdd} />
    </Box>
  );
}
