'use client';

import { Box, Typography, Tooltip } from '@mui/material';
import { formatCurrency, formatPercentage } from '@/lib/utils/formatting';
import { softTokens } from '@/theme/theme';

// Bar segments are coloured with the v2 pastel `.deep` tones in a
// fixed order so the same owner gets the same colour across renders.
// Pairs (band, ink) keep the in-bar percentage label readable against
// each tint.
const BANDS: readonly { fill: string; ink: string }[] = [
  { fill: softTokens.mint.deep,     ink: softTokens.mint.ink },
  { fill: softTokens.lavender.deep, ink: softTokens.lavender.ink },
  { fill: softTokens.peach.deep,    ink: softTokens.peach.ink },
  { fill: softTokens.lemon.deep,    ink: softTokens.lemon.ink },
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
  return (
    <Box>
      <Box sx={{ display: 'flex', height: 32, borderRadius: 2, overflow: 'hidden', mb: 2 }}>
        {owners.map((owner, i) => {
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
        {owners.map((owner, i) => (
          <Box key={owner.ownerId} sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
            <Box sx={{ width: 12, height: 12, borderRadius: '50%', bgcolor: BANDS[i % BANDS.length].fill }} />
            <Typography variant="caption">{owner.name}</Typography>
          </Box>
        ))}
      </Box>
    </Box>
  );
}
