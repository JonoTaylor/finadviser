'use client';

import Link from 'next/link';
import { Card, CardContent, Typography, Table, TableHead, TableBody, TableRow, TableCell, TableContainer, Chip, Box, Button, Tooltip } from '@mui/material';
import { format, parseISO } from 'date-fns';
import { formatCurrency } from '@/lib/utils/formatting';
import DashboardCardHeader from './DashboardCardHeader';

interface Entry { id: number; date: string; description: string; category_name: string | null; entries_summary: string | null }

function parseAmount(summary: string | null): string {
  if (!summary) return '0';
  const parts = summary.split('|');
  // Keep the existing ledger-posting amount selection; offset accounts are skipped first.
  for (const part of parts) {
    const idx = part.lastIndexOf(':');
    if (idx === -1) continue;
    const name = part.slice(0, idx);
    const amt = part.slice(idx + 1);
    if (name.startsWith('Uncategorized ')) continue;
    if (parseFloat(amt) !== 0) return amt;
  }
  for (const part of parts) {
    const idx = part.lastIndexOf(':');
    if (idx === -1) continue;
    const amt = part.slice(idx + 1);
    if (parseFloat(amt) !== 0) return amt;
  }
  return '0';
}

export default function RecentTransactionsTable({ entries }: { entries: Entry[] }) {
  return <Card sx={{ height: '100%' }}><CardContent>
    <DashboardCardHeader title="Recent activity" subtitle="Your latest recorded transactions"
      action={<Button component={Link} href="/transactions" size="small">View all</Button>} />
    {entries.length === 0 ? <Box sx={{ py: 4 }}>
      <Typography variant="body2" sx={{ fontWeight: 600 }}>No transactions yet</Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mt: 0.75 }}>Import your statement or connect a bank to start seeing your money clearly.</Typography>
      <Button component={Link} href="/import" size="small" variant="outlined" sx={{ mt: 2 }}>Import transactions</Button>
    </Box> : <TableContainer tabIndex={0} role="region" aria-label="Recent activity records" sx={{ overflowX: 'auto', maxWidth: '100%' }}>
      <Table size="small" aria-label="Recent recorded transactions" sx={{ minWidth: 540 }}>
        <TableHead><TableRow>
          <TableCell sx={{ pl: 0 }}>Date</TableCell><TableCell>Description</TableCell>
          <TableCell>Category</TableCell><TableCell align="right" sx={{ pr: 0 }}>Amount</TableCell>
        </TableRow></TableHead>
        <TableBody>{entries.map(entry => {
          const amount = parseAmount(entry.entries_summary);
          return <TableRow key={entry.id}>
            <TableCell sx={{ pl: 0, whiteSpace: 'nowrap', color: 'text.secondary', fontSize: '0.78rem' }}>{format(parseISO(entry.date), 'd MMM yyyy')}</TableCell>
            <TableCell><Tooltip title={entry.description}><Typography variant="body2" noWrap sx={{ maxWidth: 240, fontWeight: 500 }}>{entry.description}</Typography></Tooltip></TableCell>
            <TableCell><Chip label={entry.category_name || 'Uncategorized'} size="small" variant="outlined" sx={{ maxWidth: 150, fontSize: '0.7rem' }} /></TableCell>
            <TableCell align="right" sx={{ pr: 0, color: parseFloat(amount) > 0 ? 'success.dark' : 'text.primary', fontWeight: 600, fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>{formatCurrency(amount)}</TableCell>
          </TableRow>;
        })}</TableBody>
      </Table>
    </TableContainer>}
  </CardContent></Card>;
}
