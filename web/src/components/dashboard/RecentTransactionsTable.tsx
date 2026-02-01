'use client';

import {
  Card, CardContent, Typography, Table, TableHead, TableBody,
  TableRow, TableCell, Chip, Box,
} from '@mui/material';
import { alpha } from '@mui/material/styles';
import ReceiptLongRoundedIcon from '@mui/icons-material/ReceiptLongRounded';
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
  // Prefer the asset account entry (skip offset accounts like
  // "Uncategorized Expense" / "Uncategorized Income") so the sign
  // reflects how the transaction affected the user's bank account.
  for (const part of parts) {
    const idx = part.lastIndexOf(':');
    if (idx === -1) continue;
    const name = part.slice(0, idx);
    const amt = part.slice(idx + 1);
    if (name.startsWith('Uncategorized ')) continue;
    const num = parseFloat(amt);
    if (num !== 0) return amt;
  }
  // Fallback: first non-zero amount
  for (const part of parts) {
    const idx = part.lastIndexOf(':');
    if (idx === -1) continue;
    const amt = part.slice(idx + 1);
    const num = parseFloat(amt);
    if (num !== 0) return amt;
  }
  return '0';
}

export default function RecentTransactionsTable({ entries }: { entries: Entry[] }) {
  return (
    <Card>
      {/* Clean data treatment — no accent bar */}
      <CardContent>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 2 }}>
          <Box
            sx={{
              width: 36, height: 36, borderRadius: 2.5,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              bgcolor: alpha('#B8A9E8', 0.12),
            }}
          >
            <ReceiptLongRoundedIcon sx={{ fontSize: 20, color: 'secondary.main' }} />
          </Box>
          <Typography variant="h6">Recent Transactions</Typography>
        </Box>

        {entries.length === 0 ? (
          <Box sx={{ textAlign: 'center', py: 6 }}>
            <ReceiptLongRoundedIcon sx={{ fontSize: 48, color: 'text.secondary', opacity: 0.3, mb: 1 }} />
            <Typography color="text.secondary">No transactions yet</Typography>
            <Typography variant="caption" color="text.secondary">
              Import a CSV or PDF to get started
            </Typography>
          </Box>
        ) : (
          <Table size="small">
            <TableHead>
              <TableRow
                sx={{ bgcolor: alpha('#E8C547', 0.04) }}
              >
                <TableCell>Date</TableCell>
                <TableCell>Description</TableCell>
                <TableCell>Category</TableCell>
                <TableCell align="right">Amount</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {entries.map((entry, i) => {
                const amount = parseAmount(entry.entries_summary);
                const numAmount = parseFloat(amount);
                const catName = entry.category_name || 'Uncategorized';
                const catColor = getCategoryColor(catName);
                return (
                  <TableRow
                    key={entry.id}
                    sx={{
                      bgcolor: i % 2 === 1 ? alpha('#fff', 0.015) : 'transparent',
                    }}
                  >
                    <TableCell sx={{ whiteSpace: 'nowrap', color: 'text.secondary' }}>{entry.date}</TableCell>
                    <TableCell>{entry.description}</TableCell>
                    <TableCell>
                      <Chip
                        label={catName}
                        size="small"
                        sx={{
                          bgcolor: alpha(catColor, 0.1),
                          color: catColor,
                          fontWeight: 500,
                        }}
                      />
                    </TableCell>
                    <TableCell
                      align="right"
                      sx={{
                        color: numAmount >= 0 ? 'success.main' : 'error.main',
                        fontWeight: 600,
                        fontFeatureSettings: '"tnum"',
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
