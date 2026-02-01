'use client';

import { Box, Typography, Tooltip } from '@mui/material';
import { formatCurrency, formatPercentage } from '@/lib/utils/formatting';

const COLORS = ['#4ecdc4', '#ff6b6b', '#45b7d1', '#96ceb4', '#feca57', '#a55eea'];

interface OwnerEquity {
  ownerId: number;
  name: string;
  capitalBalance: string;
  equityPct: number;
  equityAmount: string;
}

export default function EquityBar({ owners }: { owners: OwnerEquity[] }) {
  const totalEquity = owners.reduce((sum, o) => sum + parseFloat(o.equityAmount), 0);

  return (
    <Box>
      <Box sx={{ display: 'flex', height: 32, borderRadius: 2, overflow: 'hidden', mb: 2 }}>
        {owners.map((owner, i) => {
          const width = Math.max(owner.equityPct, 1);
          return (
            <Tooltip
              key={owner.ownerId}
              title={`${owner.name}: ${formatCurrency(owner.equityAmount)} (${formatPercentage(owner.equityPct)})`}
            >
              <Box
                sx={{
                  width: `${width}%`,
                  bgcolor: COLORS[i % COLORS.length],
                  transition: 'width 0.3s',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                {width > 15 && (
                  <Typography variant="caption" sx={{ color: '#000', fontWeight: 600, fontSize: '0.7rem' }}>
                    {formatPercentage(owner.equityPct)}
                  </Typography>
                )}
              </Box>
            </Tooltip>
          );
        })}
      </Box>
      <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap' }}>
        {owners.map((owner, i) => (
          <Box key={owner.ownerId} sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
            <Box sx={{ width: 12, height: 12, borderRadius: '50%', bgcolor: COLORS[i % COLORS.length] }} />
            <Typography variant="caption">{owner.name}</Typography>
          </Box>
        ))}
      </Box>
    </Box>
  );
}
