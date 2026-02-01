'use client';

import {
  Card, Table, TableHead, TableBody, TableRow, TableCell,
  Chip, Typography, CardContent,
} from '@mui/material';
import { formatCurrency } from '@/lib/utils/formatting';

interface Transaction {
  date: string;
  description: string;
  amount: string;
  isDuplicate: boolean;
  fingerprint: string;
}

export default function PreviewTable({ transactions }: { transactions: Array<Record<string, unknown>> }) {
  const newCount = transactions.filter(t => !t.isDuplicate).length;
  const dupCount = transactions.filter(t => t.isDuplicate).length;

  return (
    <Card>
      <CardContent>
        <Typography variant="h6" gutterBottom>
          Preview: {newCount} new, {dupCount} duplicates
        </Typography>
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>Status</TableCell>
              <TableCell>Date</TableCell>
              <TableCell>Description</TableCell>
              <TableCell align="right">Amount</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {transactions.map((txn, i) => (
              <TableRow key={i} sx={{ opacity: txn.isDuplicate ? 0.5 : 1 }}>
                <TableCell>
                  <Chip
                    label={txn.isDuplicate ? 'DUP' : 'NEW'}
                    size="small"
                    color={txn.isDuplicate ? 'default' : 'success'}
                    sx={{ fontSize: '0.7rem' }}
                  />
                </TableCell>
                <TableCell>{txn.date as string}</TableCell>
                <TableCell>{txn.description as string}</TableCell>
                <TableCell align="right" sx={{
                  color: parseFloat(txn.amount as string) >= 0 ? 'success.main' : 'error.main',
                  fontWeight: 600,
                }}>
                  {formatCurrency(txn.amount as string)}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}
