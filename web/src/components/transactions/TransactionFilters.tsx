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
    <Box sx={{ mb: 2, p: 2, bgcolor: 'background.paper', border: '1px solid', borderColor: 'divider', borderRadius: '10px' }}>
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
              '&:hover': { bgcolor: (theme) => alpha(theme.palette.primary.main, 0.08), borderColor: 'primary.main' },
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
      <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, minmax(0, 1fr))', lg: 'minmax(180px, 1.5fr) repeat(2, minmax(120px, 1fr)) repeat(2, minmax(125px, 0.8fr))' }, gap: 1.5 }}>
        <TextField
          label="Search transactions"
          placeholder="Description or merchant"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          slotProps={{
            input: {
              startAdornment: <SearchRoundedIcon sx={{ color: 'text.secondary', mr: 1, fontSize: 20 }} />,
            },
          }}
          sx={{ minWidth: 0, gridColumn: { sm: '1 / -1', lg: 'auto' } }}
        />
        <Autocomplete
          options={categories}
          getOptionLabel={(o) => o.name}
          value={categories.find(c => c.id === filters.categoryId) ?? null}
          onChange={(_, val) => onFilterChange({ ...filters, categoryId: val?.id })}
          renderInput={(params) => <TextField {...params} label="Category" />}
          sx={{ minWidth: 0 }}
        />
        <Autocomplete
          options={accounts}
          getOptionLabel={(o) => `${o.name} (${o.accountType})`}
          value={accounts.find(a => a.id === filters.accountId) ?? null}
          onChange={(_, val) => onFilterChange({ ...filters, accountId: val?.id })}
          renderInput={(params) => <TextField {...params} label="Account" />}
          sx={{ minWidth: 0 }}
        />
        <TextField
          type="date"
          label="From"
          slotProps={{ inputLabel: { shrink: true } }}
          value={filters.startDate}
          onChange={(e) => onFilterChange({ ...filters, startDate: e.target.value })}
          sx={{ minWidth: 0 }}
        />
        <TextField
          type="date"
          label="To"
          slotProps={{ inputLabel: { shrink: true } }}
          value={filters.endDate}
          onChange={(e) => onFilterChange({ ...filters, endDate: e.target.value })}
          sx={{ minWidth: 0 }}
        />
      </Box>
    </Box>
  );
}
