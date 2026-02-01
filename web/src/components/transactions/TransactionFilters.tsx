'use client';

import { useState, useEffect } from 'react';
import { Box, TextField, Autocomplete, Stack, Chip } from '@mui/material';
import { alpha } from '@mui/material/styles';
import SearchRoundedIcon from '@mui/icons-material/SearchRounded';
import { format, subMonths, startOfMonth, endOfMonth, subDays, startOfYear } from 'date-fns';

interface Filters {
  q: string;
  categoryId: number | undefined;
  accountId: number | undefined;
  startDate: string;
  endDate: string;
}

interface Category { id: number; name: string }
interface Account { id: number; name: string; accountType: string }

const DATE_FORMAT = 'yyyy-MM-dd';

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

  const hasActiveDates = filters.startDate || filters.endDate;

  const setDateRange = (start: Date, end: Date) => {
    onFilterChange({
      ...filters,
      startDate: format(start, DATE_FORMAT),
      endDate: format(end, DATE_FORMAT),
    });
  };

  const clearDates = () => {
    onFilterChange({ ...filters, startDate: '', endDate: '' });
  };

  const now = new Date();

  const presets = [
    { label: 'This Month', action: () => setDateRange(startOfMonth(now), endOfMonth(now)) },
    { label: 'Last Month', action: () => { const p = subMonths(now, 1); setDateRange(startOfMonth(p), endOfMonth(p)); } },
    { label: 'Last 90 Days', action: () => setDateRange(subDays(now, 90), now) },
    { label: 'This Year', action: () => setDateRange(startOfYear(now), now) },
  ];

  return (
    <Box sx={{ mb: 3 }}>
      {/* Quick date presets */}
      <Stack direction="row" spacing={0.75} sx={{ mb: 2 }} flexWrap="wrap" useFlexGap>
        {presets.map((preset) => (
          <Chip
            key={preset.label}
            label={preset.label}
            size="small"
            variant="outlined"
            onClick={preset.action}
            sx={{
              cursor: 'pointer',
              '&:hover': { bgcolor: alpha('#5EEAD4', 0.08), borderColor: 'primary.main' },
            }}
          />
        ))}
        {hasActiveDates && (
          <Chip
            label="Clear dates"
            size="small"
            color="secondary"
            variant="outlined"
            onDelete={clearDates}
            onClick={clearDates}
          />
        )}
      </Stack>

      {/* Filters row */}
      <Stack direction={{ xs: 'column', md: 'row' }} spacing={1.5}>
        <TextField
          placeholder="Search transactions..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          slotProps={{
            input: {
              startAdornment: <SearchRoundedIcon sx={{ color: 'text.secondary', mr: 1, fontSize: 20 }} />,
            },
          }}
          sx={{ minWidth: 220, flex: 1 }}
        />
        <Autocomplete
          options={categories}
          getOptionLabel={(o) => o.name}
          value={categories.find(c => c.id === filters.categoryId) ?? null}
          onChange={(_, val) => onFilterChange({ ...filters, categoryId: val?.id })}
          renderInput={(params) => <TextField {...params} placeholder="Category" />}
          sx={{ minWidth: 180 }}
        />
        <Autocomplete
          options={accounts}
          getOptionLabel={(o) => `${o.name} (${o.accountType})`}
          value={accounts.find(a => a.id === filters.accountId) ?? null}
          onChange={(_, val) => onFilterChange({ ...filters, accountId: val?.id })}
          renderInput={(params) => <TextField {...params} placeholder="Account" />}
          sx={{ minWidth: 200 }}
        />
        <TextField
          type="date"
          label="From"
          slotProps={{ inputLabel: { shrink: true } }}
          value={filters.startDate}
          onChange={(e) => onFilterChange({ ...filters, startDate: e.target.value })}
          sx={{ minWidth: 150 }}
        />
        <TextField
          type="date"
          label="To"
          slotProps={{ inputLabel: { shrink: true } }}
          value={filters.endDate}
          onChange={(e) => onFilterChange({ ...filters, endDate: e.target.value })}
          sx={{ minWidth: 150 }}
        />
      </Stack>
    </Box>
  );
}
