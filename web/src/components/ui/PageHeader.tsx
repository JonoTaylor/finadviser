'use client';

import type { ReactNode } from 'react';
import { Box, Stack, Typography } from '@mui/material';

export interface PageHeaderProps { title: string; description?: ReactNode; eyebrow?: string; actions?: ReactNode; children?: ReactNode }

export default function PageHeader({ title, description, eyebrow, actions, children }: PageHeaderProps) {
  return <Box sx={{ mb: 3 }}>
    <Stack direction={{ xs: 'column', sm: 'row' }} justifyContent="space-between" alignItems={{ sm: 'flex-start' }} gap={2}>
      <Box sx={{ minWidth: 0, maxWidth: 760 }}>
        {eyebrow && <Typography variant="overline" color="text.secondary" sx={{ display: 'block', mb: 0.5 }}>{eyebrow}</Typography>}
        <Typography variant="h4" component="h1" sx={{ overflowWrap: 'anywhere' }}>{title}</Typography>
        {description && <Typography variant="body2" color="text.secondary" sx={{ mt: 0.75, overflowWrap: 'anywhere' }}>{description}</Typography>}
      </Box>
      {actions && <Stack direction="row" gap={1} flexWrap="wrap" sx={{ flexShrink: 0, alignItems: 'center' }}>{actions}</Stack>}
    </Stack>
    {children && <Box sx={{ mt: 2 }}>{children}</Box>}
  </Box>;
}
