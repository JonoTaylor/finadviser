'use client';

import {
  Card,
  Table,
  TableHead,
  TableBody,
  TableRow,
  TableCell,
  TablePagination,
  Chip,
  Box,
  CircularProgress,
  Typography,
} from '@mui/material';
import { formatCurrency } from '@/lib/utils/formatting';

interface Entry {
  id: number;
  date: string;
  description: string;
  reference: string | null;
  category_id: number | null;
  category_name: string | null;
  entries_summary: string | null;
}

function parseAmount(summary: string | null): string {
  if (!summary) return '0';
  const parts = summary.split('|');
  for (const part of parts) {
    const [, amt] = part.split(':');
    if (amt) {
      const num = parseFloat(amt);
      if (num !== 0) return amt;
    }
  }
  return '0';
}

export default function TransactionTable({
  entries,
  total,
  page,
  pageSize,
  loading,
  onPageChange,
  onPageSizeChange,
  onRowClick,
}: {
  entries: Entry[];
  total: number;
  page: number;
  pageSize: number;
  loading: boolean;
  onPageChange: (page: number) => void;
  onPageSizeChange: (size: number) => void;
  onRowClick: (entry: Entry) => void;
}) {
  if (loading) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}>
        <CircularProgress />
      </Box>
    );
  }

  return (
    <Card>
      {entries.length === 0 ? (
        <Box sx={{ p: 4, textAlign: 'center' }}>
          <Typography color="text.secondary">No transactions found.</Typography>
        </Box>
      ) : (
        <>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>Date</TableCell>
                <TableCell>Description</TableCell>
                <TableCell>Category</TableCell>
                <TableCell>Reference</TableCell>
                <TableCell align="right">Amount</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {entries.map((entry) => {
                const amount = parseAmount(entry.entries_summary);
                const numAmount = parseFloat(amount);
                return (
                  <TableRow
                    key={entry.id}
                    hover
                    sx={{ cursor: 'pointer' }}
                    onClick={() => onRowClick(entry)}
                  >
                    <TableCell sx={{ whiteSpace: 'nowrap' }}>{entry.date}</TableCell>
                    <TableCell>{entry.description}</TableCell>
                    <TableCell>
                      <Chip
                        label={entry.category_name || 'Uncategorized'}
                        size="small"
                        variant="outlined"
                        sx={{ fontSize: '0.75rem' }}
                      />
                    </TableCell>
                    <TableCell sx={{ color: 'text.secondary' }}>{entry.reference || ''}</TableCell>
                    <TableCell
                      align="right"
                      sx={{
                        color: numAmount >= 0 ? 'success.main' : 'error.main',
                        fontWeight: 600,
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {formatCurrency(amount)}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
          <TablePagination
            component="div"
            count={total}
            page={page}
            rowsPerPage={pageSize}
            rowsPerPageOptions={[10, 25, 50, 100]}
            onPageChange={(_, p) => onPageChange(p)}
            onRowsPerPageChange={(e) => {
              onPageSizeChange(parseInt(e.target.value, 10));
              onPageChange(0);
            }}
          />
        </>
      )}
    </Card>
  );
}
