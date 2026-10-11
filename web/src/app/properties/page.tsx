'use client';

import { useState } from 'react';
import { Alert, Box, Typography, Grid, Card, CardContent, CardActionArea, Button, Chip, Stack } from '@mui/material';
import AddRoundedIcon from '@mui/icons-material/AddRounded';
import HomeWorkRoundedIcon from '@mui/icons-material/HomeWorkRounded';
import useSWR from 'swr';
import Link from 'next/link';
import { formatCurrency } from '@/lib/utils/formatting';
import { fetchJson } from '@/lib/http/client';
import type { Property } from '@/lib/types';
import AddPropertyDialog from '@/components/properties/AddPropertyDialog';

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
    <Box>
      <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 2, justifyContent: 'space-between', alignItems: 'center', mb: 4 }}>
        <Box>
          <Typography variant="h4">Properties</Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
            Track property values, mortgages, and equity
          </Typography>
        </Box>
        <Stack direction="row" spacing={1} sx={{ flexWrap: 'wrap', gap: 1 }}>
          <Button component={Link} href="/properties/operations" variant="outlined">
            Rent and tasks
          </Button>
          <Button variant="contained" startIcon={<AddRoundedIcon />} onClick={() => setAddOpen(true)}>
            Add Property
          </Button>
        </Stack>
      </Box>

      {error ? (
        <Alert severity="error" action={<Button color="inherit" onClick={() => void mutate()}>Retry</Button>}>
          Properties could not be loaded. {error instanceof Error ? error.message : 'Please try again.'}
        </Alert>
      ) : isLoading ? (
        <Typography color="text.secondary">Loading...</Typography>
      ) : !properties || properties.length === 0 ? (
        <Card sx={{ p: 4, textAlign: 'center' }}>
          <HomeWorkRoundedIcon sx={{ fontSize: 48, color: 'text.secondary', opacity: 0.3, mb: 1 }} />
          <Typography color="text.secondary">No properties yet. Add your first property to track equity.</Typography>
        </Card>
      ) : (
        <Grid container spacing={3}>
          {properties.map(prop => (
            <Grid key={prop.id} size={{ xs: 12, md: 6 }}>
              <Card>
                <CardActionArea component={Link} href={`/properties/${prop.id}`}>
                  <CardContent>
                    <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ flexWrap: 'wrap', gap: 1 }}>
                      <Typography variant="h6" sx={{ overflowWrap: 'anywhere' }}>{prop.name}</Typography>
                      {prop.purchasePrice && (
                        <Chip label={formatCurrency(prop.purchasePrice)} size="small" color="primary" variant="outlined" />
                      )}
                    </Stack>
                    {prop.address && (
                      <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5, overflowWrap: 'anywhere' }}>
                        {prop.address}
                      </Typography>
                    )}
                    {prop.purchaseDate && (
                      <Typography variant="caption" color="text.secondary">
                        Purchased: {prop.purchaseDate}
                      </Typography>
                    )}
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
