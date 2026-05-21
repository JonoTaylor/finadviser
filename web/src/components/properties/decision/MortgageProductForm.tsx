'use client';

import { useState } from 'react';
import {
  Box,
  Button,
  Card,
  CardContent,
  IconButton,
  MenuItem,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import type {
  ErcTier,
  MortgageProduct,
  MortgageProductType,
} from '@/lib/properties/btl-decision';

const PRODUCT_TYPES: MortgageProductType[] = [
  'fixed',
  'discount',
  'variable',
  'tracker',
  'no_erc',
];

export interface MortgageProductFormProps {
  products: MortgageProduct[];
  onChange: (next: MortgageProduct[]) => void;
}

function emptyProduct(): MortgageProduct {
  return {
    id: crypto.randomUUID(),
    name: '',
    type: 'fixed',
    ratePct: '',
    productFee: '0',
    exitFee: '0',
    monthlyPayment: '',
    ercSchedule: [],
  };
}

export default function MortgageProductForm({
  products,
  onChange,
}: MortgageProductFormProps) {
  const updateProduct = (id: string, patch: Partial<MortgageProduct>) => {
    onChange(products.map(p => (p.id === id ? { ...p, ...patch } : p)));
  };

  const removeProduct = (id: string) => {
    onChange(products.filter(p => p.id !== id));
  };

  const addProduct = () => {
    onChange([...products, emptyProduct()]);
  };

  return (
    <Card sx={{ mb: 3 }}>
      <CardContent>
        <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ mb: 2 }}>
          <Box>
            <Typography variant="h6">Mortgage products</Typography>
            <Typography variant="body2" color="text.secondary">
              Add candidate products to compare side by side. Rates are headline,
              monthly payments are interest-only equivalent.
            </Typography>
          </Box>
          <Button startIcon={<AddIcon />} onClick={addProduct} variant="outlined" size="small">
            Add product
          </Button>
        </Stack>

        <Stack spacing={2}>
          {products.length === 0 && (
            <Typography variant="body2" color="text.secondary">
              No products yet. Add at least one to see scenario costs.
            </Typography>
          )}
          {products.map(product => (
            <ProductRow
              key={product.id}
              product={product}
              onChange={patch => updateProduct(product.id, patch)}
              onRemove={() => removeProduct(product.id)}
            />
          ))}
        </Stack>
      </CardContent>
    </Card>
  );
}

function ProductRow({
  product,
  onChange,
  onRemove,
}: {
  product: MortgageProduct;
  onChange: (patch: Partial<MortgageProduct>) => void;
  onRemove: () => void;
}) {
  const [showErc, setShowErc] = useState(product.ercSchedule.length > 0);

  const updateErc = (next: ErcTier[]) => {
    onChange({ ercSchedule: next });
  };

  return (
    <Box sx={{ border: 1, borderColor: 'divider', borderRadius: 2, p: 2 }}>
      <Stack direction="row" alignItems="flex-start" spacing={1}>
        <Box sx={{ flex: 1 }}>
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5} sx={{ mb: 1.5 }}>
            <TextField
              label="Product name"
              size="small"
              value={product.name}
              onChange={e => onChange({ name: e.target.value })}
              sx={{ flex: 2 }}
            />
            <TextField
              label="Type"
              size="small"
              select
              value={product.type}
              onChange={e => onChange({ type: e.target.value as MortgageProductType })}
              sx={{ flex: 1 }}
            >
              {PRODUCT_TYPES.map(t => (
                <MenuItem key={t} value={t}>
                  {t.replace('_', ' ')}
                </MenuItem>
              ))}
            </TextField>
          </Stack>
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5}>
            <TextField
              label="Rate %"
              size="small"
              type="number"
              inputProps={{ step: '0.01' }}
              value={product.ratePct}
              onChange={e => onChange({ ratePct: e.target.value })}
            />
            <TextField
              label="Product fee £"
              size="small"
              type="number"
              value={product.productFee}
              onChange={e => onChange({ productFee: e.target.value })}
            />
            <TextField
              label="Exit fee £"
              size="small"
              type="number"
              value={product.exitFee}
              onChange={e => onChange({ exitFee: e.target.value })}
            />
            <TextField
              label="Monthly payment £"
              size="small"
              type="number"
              value={product.monthlyPayment}
              onChange={e => onChange({ monthlyPayment: e.target.value })}
            />
          </Stack>

          <Box sx={{ mt: 1.5 }}>
            <Button
              size="small"
              onClick={() => setShowErc(s => !s)}
              sx={{ textTransform: 'none' }}
            >
              {showErc ? 'Hide ERC schedule' : 'Add ERC schedule'}
            </Button>
            {showErc && <ErcEditor schedule={product.ercSchedule} onChange={updateErc} />}
          </Box>
        </Box>
        <IconButton
          aria-label="remove product"
          onClick={onRemove}
          size="small"
          sx={{ mt: 0.5 }}
        >
          <DeleteOutlineIcon fontSize="small" />
        </IconButton>
      </Stack>
    </Box>
  );
}

function ErcEditor({
  schedule,
  onChange,
}: {
  schedule: ErcTier[];
  onChange: (next: ErcTier[]) => void;
}) {
  const update = (index: number, patch: Partial<ErcTier>) => {
    onChange(schedule.map((tier, i) => (i === index ? { ...tier, ...patch } : tier)));
  };
  const remove = (index: number) => onChange(schedule.filter((_, i) => i !== index));
  const add = () => onChange([...schedule, { untilMonth: 12, pct: '0' }]);

  return (
    <Box sx={{ mt: 1, pl: 1, borderLeft: 2, borderColor: 'divider' }}>
      <Stack spacing={1}>
        {schedule.map((tier, i) => (
          <Stack key={i} direction="row" spacing={1} alignItems="center">
            <TextField
              label="Through month"
              size="small"
              type="number"
              value={tier.untilMonth}
              onChange={e => update(i, { untilMonth: parseInt(e.target.value || '0', 10) })}
              sx={{ width: 140 }}
            />
            <TextField
              label="ERC %"
              size="small"
              type="number"
              inputProps={{ step: '0.1' }}
              value={tier.pct}
              onChange={e => update(i, { pct: e.target.value })}
              sx={{ width: 140 }}
            />
            <IconButton aria-label="remove tier" onClick={() => remove(i)} size="small">
              <DeleteOutlineIcon fontSize="small" />
            </IconButton>
          </Stack>
        ))}
        <Button size="small" onClick={add} sx={{ alignSelf: 'flex-start' }}>
          Add ERC tier
        </Button>
      </Stack>
    </Box>
  );
}
