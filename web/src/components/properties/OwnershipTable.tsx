'use client';

import { Table, TableHead, TableBody, TableRow, TableCell } from '@mui/material';
import { formatCurrency, formatPercentage } from '@/lib/utils/formatting';

interface OwnerEquity {
  ownerId: number;
  name: string;
  capitalBalance: string;
  equityPct: number;
  equityAmount: string;
}

export default function OwnershipTable({ owners }: { owners: OwnerEquity[] }) {
  return (
    <Table size="small">
      <TableHead>
        <TableRow>
          <TableCell>Owner</TableCell>
          <TableCell align="right">Capital</TableCell>
          <TableCell align="right">Share</TableCell>
          <TableCell align="right">Market Equity</TableCell>
        </TableRow>
      </TableHead>
      <TableBody>
        {owners.map((owner) => (
          <TableRow key={owner.ownerId}>
            <TableCell>{owner.name}</TableCell>
            <TableCell align="right">{formatCurrency(owner.capitalBalance)}</TableCell>
            <TableCell align="right">{formatPercentage(owner.equityPct)}</TableCell>
            <TableCell align="right" sx={{ fontWeight: 600 }}>
              {formatCurrency(owner.equityAmount)}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
