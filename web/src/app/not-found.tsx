'use client';

import Link from 'next/link';
import { Box, Button, Typography } from '@mui/material';
import PageHeader from '@/components/ui/PageHeader';

export default function NotFound() {
  return <Box>
    <PageHeader title="Page not found" />
    <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
      This address does not match a page in FinAdviser. It may have been moved, or the link may be incomplete.
    </Typography>
    <Button component={Link} href="/" variant="contained" size="small">Go to the overview</Button>
  </Box>;
}
