import { Box, Stack, Typography } from '@mui/material';
import type { ReactNode } from 'react';

export const metricValueSx = {
  fontWeight: 650,
  fontSize: { xs: '1.8rem', xl: '2rem' },
  letterSpacing: '-0.045em',
  lineHeight: 1.2,
  fontVariantNumeric: 'tabular-nums',
  overflowWrap: 'anywhere',
} as const;

export default function DashboardCardHeader({ title, subtitle, action }: {
  title: string;
  subtitle?: string;
  action?: ReactNode;
}) {
  return <Stack direction="row" justifyContent="space-between" alignItems="flex-start" gap={1.5} sx={{ mb: 2 }}>
    <Box sx={{ minWidth: 0 }}>
      <Typography component="h2" variant="subtitle2" sx={{ color: 'text.primary', fontWeight: 600 }}>{title}</Typography>
      {subtitle && <Typography variant="caption" sx={{ display: 'block', mt: 0.35 }}>{subtitle}</Typography>}
    </Box>
    {action && <Box sx={{ flexShrink: 0 }}>{action}</Box>}
  </Stack>;
}
