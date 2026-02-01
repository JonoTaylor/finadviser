'use client';

import { useState } from 'react';
import { Box, Typography, Grid, Card, CardContent, CardActionArea, Button, Chip, Stack } from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import HomeWorkIcon from '@mui/icons-material/HomeWork';
import useSWR from 'swr';
import Link from 'next/link';
import { formatCurrency } from '@/lib/utils/formatting';
import AddPropertyDialog from '@/components/properties/AddPropertyDialog';

const fetcher = (url: string) => fetch(url).then(r => r.json());

export default function PropertiesPage() {
  const { data: properties, isLoading, mutate } = useSWR('/api/properties', fetcher);
  const [addOpen, setAddOpen] = useState(false);

  const handleAdd = async (data: { name: string; address: string; purchaseDate: string; purchasePrice: string }) => {
    await fetch('/api/properties', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    setAddOpen(false);
    mutate();
  };

  return (
    <Box>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 3 }}>
        <Typography variant="h4">Properties</Typography>
        <Button variant="contained" startIcon={<AddIcon />} onClick={() => setAddOpen(true)}>
          Add Property
        </Button>
      </Box>

      {isLoading ? (
        <Typography color="text.secondary">Loading...</Typography>
      ) : !properties || properties.length === 0 ? (
        <Card sx={{ p: 4, textAlign: 'center' }}>
          <HomeWorkIcon sx={{ fontSize: 48, color: 'text.secondary', mb: 1 }} />
          <Typography color="text.secondary">No properties yet. Add your first property to track equity.</Typography>
        </Card>
      ) : (
        <Grid container spacing={3}>
          {properties.map((prop: { id: number; name: string; address: string | null; purchasePrice: string | null; purchaseDate: string | null }) => (
            <Grid key={prop.id} size={{ xs: 12, md: 6 }}>
              <Card>
                <CardActionArea component={Link} href={`/properties/${prop.id}`}>
                  <CardContent>
                    <Stack direction="row" justifyContent="space-between" alignItems="center">
                      <Typography variant="h6">{prop.name}</Typography>
                      {prop.purchasePrice && (
                        <Chip label={formatCurrency(prop.purchasePrice)} size="small" color="primary" variant="outlined" />
                      )}
                    </Stack>
                    {prop.address && (
                      <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
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
