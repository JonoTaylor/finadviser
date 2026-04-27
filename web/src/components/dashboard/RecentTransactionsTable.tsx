'use client';

import {
  Card, CardContent, Typography, Table, TableHead, TableBody,
  TableRow, TableCell, Chip, Box,
} from '@mui/material';
import { alpha } from '@mui/material/styles';
import ReceiptLongRoundedIcon from '@mui/icons-material/ReceiptLongRounded';
import { formatCurrency } from '@/lib/utils/formatting';
import { getCategoryColor } from '@/lib/utils/category-colors';
import { softTokens } from '@/theme/theme';

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
      <CardContent>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 2 }}>
          <Box
            sx={{
              width: 36, height: 36, borderRadius: 2.5,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              bgcolor: softTokens.lavender.main, color: softTokens.lavender.ink,
            }}
          >
            <ReceiptLongRoundedIcon sx={{ fontSize: 20 }} />
          </Box>
          <Typography variant="h6">Recent Transactions</Typography>
        </Box>

        {entries.length === 0 ? (
          <Box sx={{ textAlign: 'center', py: 6 }}>
            <ReceiptLongRoundedIcon sx={{ fontSize: 48, color: 'text.disabled', mb: 1 }} />
            <Typography color="text.secondary">No transactions yet</Typography>
            <Typography variant="caption" color="text.secondary">
              Import a CSV or PDF to get started
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
                const cat = getCategoryColor(catName);
                return (
                  <TableRow key={entry.id}>
                    <TableCell sx={{ whiteSpace: 'nowrap', color: 'text.secondary' }}>{entry.date}</TableCell>
                    <TableCell>{entry.description}</TableCell>
                    <TableCell>
                      <Chip
                        label={catName}
                        size="small"
                        sx={{
                          bgcolor: alpha(cat.fill, 0.14),
                          color: cat.ink,
                          fontWeight: 500,
                        }}
                      />
                    </TableCell>
                    <TableCell
                      align="right"
                      sx={{
                        color: numAmount >= 0 ? softTokens.mint.ink : softTokens.peach.ink,
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
