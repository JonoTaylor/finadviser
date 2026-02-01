'use client';

import { Card, CardContent, Typography, Table, TableHead, TableBody, TableRow, TableCell } from '@mui/material';
import { formatCurrency } from '@/lib/utils/formatting';

interface Valuation {
  id: number;
  valuation: string;
  valuationDate: string;
  source: string | null;
}

export default function ValuationHistory({ valuations }: { valuations: Valuation[] }) {
  return (
    <Card>
      <CardContent>
        <Typography variant="h6" gutterBottom>Valuation History</Typography>
        {valuations.length === 0 ? (
          <Typography color="text.secondary">No valuations recorded</Typography>
        ) : (
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>Date</TableCell>
                <TableCell align="right">Valuation</TableCell>
                <TableCell>Source</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {valuations.map((v) => (
                <TableRow key={v.id}>
                  <TableCell>{v.valuationDate}</TableCell>
                  <TableCell align="right" sx={{ fontWeight: 600 }}>{formatCurrency(v.valuation)}</TableCell>
                  <TableCell sx={{ color: 'text.secondary' }}>{v.source ?? 'manual'}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}
