'use client';

import {
  Card,
  CardContent,
  Typography,
  Table,
  TableHead,
  TableBody,
  TableRow,
  TableCell,
  Chip,
} from '@mui/material';
import { formatCurrency } from '@/lib/utils/formatting';

interface Entry {
  id: number;
  date: string;
  description: string;
  category_name: string | null;
  entries_summary: string | null;
}

function parseAmount(summary: string | null): string {
  if (!summary) return '0';
  // entries_summary format: "AccountName:amount|AccountName:amount"
  const parts = summary.split('|');
  for (const part of parts) {
    const [name, amt] = part.split(':');
    if (name && amt) {
      const num = parseFloat(amt);
      // Return the first non-zero amount that's from an asset account perspective
      if (num !== 0) return amt;
    }
  }
  return '0';
}

export default function RecentTransactionsTable({ entries }: { entries: Entry[] }) {
  return (
    <Card>
      <CardContent>
        <Typography variant="h6" gutterBottom>
          Recent Transactions
        </Typography>
        {entries.length === 0 ? (
          <Typography color="text.secondary">No transactions yet. Import a CSV to get started.</Typography>
        ) : (
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>Date</TableCell>
                <TableCell>Description</TableCell>
                <TableCell>Category</TableCell>
                <TableCell align="right">Amount</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {entries.map((entry) => {
                const amount = parseAmount(entry.entries_summary);
                const numAmount = parseFloat(amount);
                return (
                  <TableRow key={entry.id} hover>
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
        )}
      </CardContent>
    </Card>
  );
}
