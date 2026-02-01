'use client';

import { useState, useCallback } from 'react';
import { Box, Typography } from '@mui/material';
import useSWR from 'swr';
import TransactionFilters from '@/components/transactions/TransactionFilters';
import TransactionTable from '@/components/transactions/TransactionTable';
import CategoryEditDialog from '@/components/transactions/CategoryEditDialog';

const fetcher = (url: string) => fetch(url).then(r => r.json());

export default function TransactionsPage() {
  const [filters, setFilters] = useState({
    q: '',
    categoryId: undefined as number | undefined,
    accountId: undefined as number | undefined,
    startDate: '',
    endDate: '',
  });
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(25);
  const [editEntry, setEditEntry] = useState<{ id: number; categoryId: number | null } | null>(null);

  const queryParams = new URLSearchParams();
  if (filters.q) queryParams.set('q', filters.q);
  if (filters.categoryId) queryParams.set('categoryId', String(filters.categoryId));
  if (filters.accountId) queryParams.set('accountId', String(filters.accountId));
  if (filters.startDate) queryParams.set('startDate', filters.startDate);
  if (filters.endDate) queryParams.set('endDate', filters.endDate);
  queryParams.set('limit', String(pageSize));
  queryParams.set('offset', String(page * pageSize));

  const { data, isLoading, mutate } = useSWR(`/api/journal?${queryParams}`, fetcher);
  const { data: categories } = useSWR('/api/categories', fetcher);
  const { data: accounts } = useSWR('/api/accounts', fetcher);

  const handleFilterChange = useCallback((newFilters: typeof filters) => {
    setFilters(newFilters);
    setPage(0);
  }, []);

  const handleCategoryUpdate = useCallback(async (journalId: number, categoryId: number) => {
    await fetch(`/api/journal/${journalId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ categoryId }),
    });
    setEditEntry(null);
    mutate();
  }, [mutate]);

  return (
    <Box>
      <Typography variant="h4" sx={{ mb: 3 }}>Transactions</Typography>
      <TransactionFilters
        filters={filters}
        categories={categories ?? []}
        accounts={accounts ?? []}
        onFilterChange={handleFilterChange}
      />
      <TransactionTable
        entries={data?.entries ?? []}
        total={data?.total ?? 0}
        page={page}
        pageSize={pageSize}
        loading={isLoading}
        onPageChange={setPage}
        onPageSizeChange={setPageSize}
        onRowClick={(entry) => setEditEntry({ id: entry.id, categoryId: entry.category_id })}
      />
      <CategoryEditDialog
        open={editEntry !== null}
        currentCategoryId={editEntry?.categoryId ?? null}
        categories={categories ?? []}
        onClose={() => setEditEntry(null)}
        onSave={(categoryId) => editEntry && handleCategoryUpdate(editEntry.id, categoryId)}
      />
    </Box>
  );
}
