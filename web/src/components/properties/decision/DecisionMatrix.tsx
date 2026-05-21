'use client';

import {
  Box,
  Card,
  CardContent,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  Tooltip,
  Typography,
} from '@mui/material';
import type { DecisionMatrixCell } from '@/lib/properties/btl-decision';

const CONFIDENCE_LEVELS: Array<'low' | 'medium' | 'high'> = ['low', 'medium', 'high'];

export interface DecisionMatrixProps {
  matrix: DecisionMatrixCell[];
}

export default function DecisionMatrix({ matrix }: DecisionMatrixProps) {
  // Index by (timing, cooperation) for quick lookup.
  const lookup = new Map<string, DecisionMatrixCell>();
  for (const cell of matrix) {
    lookup.set(`${cell.timingConfidence}:${cell.tenantCooperation}`, cell);
  }

  return (
    <Card variant="outlined">
      <CardContent>
        <Typography variant="h6" gutterBottom>
          Decision matrix
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          Rows: confidence the sale completes on time. Columns: tenant
          cooperation likelihood. Each cell shows the recommended product.
        </Typography>
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell />
              {CONFIDENCE_LEVELS.map(coop => (
                <TableCell key={coop} sx={{ textTransform: 'capitalize' }}>
                  Cooperation: {coop}
                </TableCell>
              ))}
            </TableRow>
          </TableHead>
          <TableBody>
            {CONFIDENCE_LEVELS.map(timing => (
              <TableRow key={timing}>
                <TableCell sx={{ fontWeight: 600, textTransform: 'capitalize' }}>
                  Timing: {timing}
                </TableCell>
                {CONFIDENCE_LEVELS.map(coop => {
                  const cell = lookup.get(`${timing}:${coop}`);
                  return (
                    <TableCell key={coop}>
                      {cell ? (
                        <Tooltip title={cell.reason} arrow>
                          <Box>
                            <Typography variant="body2" fontWeight={600}>
                              {cell.recommendedProductName}
                            </Typography>
                            <Typography variant="caption" color="text.secondary">
                              {cell.reason}
                            </Typography>
                          </Box>
                        </Tooltip>
                      ) : (
                        '—'
                      )}
                    </TableCell>
                  );
                })}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}
