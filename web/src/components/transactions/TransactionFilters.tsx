'use client';

import { useState, useEffect } from 'react';
import { Box, TextField, Autocomplete, Stack } from '@mui/material';

interface Filters {
  q: string;
  categoryId: number | undefined;
  accountId: number | undefined;
  startDate: string;
  endDate: string;
}

interface Category {
  id: number;
  name: string;
}

interface Account {
  id: number;
  name: string;
  accountType: string;
}

export default function TransactionFilters({
  filters,
  categories,
  accounts,
  onFilterChange,
}: {
  filters: Filters;
  categories: Category[];
  accounts: Account[];
  onFilterChange: (filters: Filters) => void;
}) {
  const [search, setSearch] = useState(filters.q);

  useEffect(() => {
    const timer = setTimeout(() => {
      if (search !== filters.q) {
        onFilterChange({ ...filters, q: search });
      }
    }, 300);
    return () => clearTimeout(timer);
  }, [search, filters, onFilterChange]);

  return (
    <Stack direction={{ xs: 'column', md: 'row' }} spacing={2} sx={{ mb: 3 }}>
      <TextField
        size="small"
        placeholder="Search transactions..."
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        sx={{ minWidth: 200 }}
      />
      <Autocomplete
        size="small"
        options={categories}
        getOptionLabel={(o) => o.name}
        value={categories.find(c => c.id === filters.categoryId) ?? null}
        onChange={(_, val) => onFilterChange({ ...filters, categoryId: val?.id })}
        renderInput={(params) => <TextField {...params} placeholder="Category" />}
        sx={{ minWidth: 180 }}
      />
      <Autocomplete
        size="small"
        options={accounts}
        getOptionLabel={(o) => `${o.name} (${o.accountType})`}
        value={accounts.find(a => a.id === filters.accountId) ?? null}
        onChange={(_, val) => onFilterChange({ ...filters, accountId: val?.id })}
        renderInput={(params) => <TextField {...params} placeholder="Account" />}
        sx={{ minWidth: 200 }}
      />
      <TextField
        size="small"
        type="date"
        label="From"
        slotProps={{ inputLabel: { shrink: true } }}
        value={filters.startDate}
        onChange={(e) => onFilterChange({ ...filters, startDate: e.target.value })}
        sx={{ minWidth: 150 }}
      />
      <TextField
        size="small"
        type="date"
        label="To"
        slotProps={{ inputLabel: { shrink: true } }}
        value={filters.endDate}
        onChange={(e) => onFilterChange({ ...filters, endDate: e.target.value })}
        sx={{ minWidth: 150 }}
      />
    </Stack>
  );
}
