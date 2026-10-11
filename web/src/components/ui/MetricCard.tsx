'use client';

import type { ReactNode } from 'react';
import { Box, Card, CardContent, Skeleton, Stack, Typography } from '@mui/material';
import type { SxProps, Theme } from '@mui/material/styles';

export interface MetricCardProps { label: string; value: ReactNode; detail?: ReactNode; icon?: ReactNode; tone?: 'neutral' | 'positive' | 'warning' | 'negative' | 'accent'; loading?: boolean; sx?: SxProps<Theme> }
const toneColors = { neutral: '#64748B', positive: '#047857', warning: '#B45309', negative: '#B91C1C', accent: '#0F766E' };

export default function MetricCard({ label, value, detail, icon, tone = 'neutral', loading = false, sx }: MetricCardProps) {
  return <Card sx={[{ height: '100%', minWidth: 0 }, ...(Array.isArray(sx) ? sx : sx ? [sx] : [])]}><CardContent>
    <Stack direction="row" justifyContent="space-between" alignItems="center" gap={1}>
      <Typography variant="body2" color="text.secondary" sx={{ fontSize: '0.8125rem', fontWeight: 500 }}>{label}</Typography>
      {icon && <Box sx={{ display: 'flex', color: toneColors[tone], '& .MuiSvgIcon-root': { fontSize: 18 } }}>{icon}</Box>}
    </Stack>
    {loading ? <Skeleton width="75%" height={44} sx={{ my: 0.5 }} /> : <Typography component="div" sx={{ fontSize: { xs: '1.375rem', sm: '1.625rem', lg: '1.875rem' }, fontWeight: 600, lineHeight: 1.3, letterSpacing: '-0.035em', fontVariantNumeric: 'tabular-nums', overflowWrap: 'anywhere', color: tone === 'negative' ? toneColors[tone] : 'text.primary', mt: 1 }}>{value}</Typography>}
    {detail && <Typography variant="caption" component="div" sx={{ mt: 0.75, minHeight: 19 }}>{detail}</Typography>}
  </CardContent></Card>;
}
