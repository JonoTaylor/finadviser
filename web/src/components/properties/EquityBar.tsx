'use client';

import { Box, Typography, Tooltip } from '@mui/material';
import { formatCurrency, formatPercentage } from '@/lib/utils/formatting';
import { softTokens } from '@/theme/theme';

// Keep owner colours stable and percentage labels readable on each band.
const BANDS: readonly { fill: string; ink: string }[] = [
  { fill: softTokens.mint.deep,     ink: '#FFFFFF' },
  { fill: softTokens.lavender.deep, ink: '#FFFFFF' },
  { fill: softTokens.peach.deep,    ink: '#FFFFFF' },
  { fill: softTokens.lemon.deep,    ink: '#FFFFFF' },
  { fill: softTokens.mint.main,     ink: softTokens.mint.ink },
  { fill: softTokens.lavender.main, ink: softTokens.lavender.ink },
];

interface OwnerEquity {
  ownerId: number;
  name: string;
  capitalBalance: string;
  equityPct: number;
  equityAmount: string;
}

export default function EquityBar({ owners }: { owners: OwnerEquity[] }) {
  // Sort by ownerId before indexing into BANDS so colours stay
  // consistent across renders — propertyRepo.getOwnership has no
  // ORDER BY, so the prop order isn't otherwise guaranteed to be
  // stable. Sorting also has the desirable property that adding a
  // new owner appends rather than reshuffling existing ones.
  const sorted = [...owners].sort((a, b) => a.ownerId - b.ownerId);

  return (
    <Box>
      <Box sx={{ display: 'flex', height: 32, borderRadius: '6px', overflow: 'hidden', mb: 2 }}>
        {sorted.map((owner, i) => {
          const width = Math.max(owner.equityPct, 1);
          const band = BANDS[i % BANDS.length];
          return (
            <Tooltip
              key={owner.ownerId}
              title={`${owner.name}: ${formatCurrency(owner.equityAmount)} (${formatPercentage(owner.equityPct)})`}
            >
              <Box
                sx={{
                  width: `${width}%`,
                  bgcolor: band.fill,
                  transition: 'width 0.3s',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                {width > 15 && (
                  <Typography variant="caption" sx={{ color: band.ink, fontWeight: 600, fontSize: '0.7rem' }}>
                    {formatPercentage(owner.equityPct)}
                  </Typography>
                )}
              </Box>
            </Tooltip>
          );
        })}
      </Box>
      <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap' }}>
        {sorted.map((owner, i) => (
          <Box key={owner.ownerId} sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
            <Box sx={{ width: 12, height: 12, borderRadius: '50%', bgcolor: BANDS[i % BANDS.length].fill }} />
            <Typography variant="caption">{owner.name}</Typography>
          </Box>
        ))}
      </Box>
    </Box>
  );
}
