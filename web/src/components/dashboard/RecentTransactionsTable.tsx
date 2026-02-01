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
  Box,
} from '@mui/material';
import ReceiptLongIcon from '@mui/icons-material/ReceiptLong';
import { formatCurrency } from '@/lib/utils/formatting';
import { getCategoryColor } from '@/lib/utils/category-colors';

interface Entry {
  id: number;
  date: string;
  description: string;
  category_name: string | null;
  entries_summary: string | null;
}

function parseAmount(summary: string | null): string {
  if (!summary) return '0';
  const parts = summary.split('|');
  for (const part of parts) {
    const [name, amt] = part.split(':');
    if (name && amt) {
      const num = parseFloat(amt);
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
          <Box sx={{ textAlign: 'center', py: 4 }}>
            <ReceiptLongIcon sx={{ fontSize: 40, color: 'text.secondary', opacity: 0.5, mb: 1 }} />
            <Typography color="text.secondary">No transactions yet</Typography>
            <Typography variant="caption" color="text.secondary">
              Import a CSV to get started
            </Typography>
          </Box>
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
                const catName = entry.category_name || 'Uncategorized';
                const catColor = getCategoryColor(catName);
                return (
                  <TableRow key={entry.id} hover>
                    <TableCell sx={{ whiteSpace: 'nowrap' }}>{entry.date}</TableCell>
                    <TableCell>{entry.description}</TableCell>
                    <TableCell>
                      <Chip
                        label={catName}
                        size="small"
                        sx={{
                          fontSize: '0.75rem',
                          bgcolor: `${catColor}18`,
                          color: catColor,
                          borderColor: `${catColor}40`,
                          border: '1px solid',
                        }}
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
