'use client';

import { Box, Button } from '@mui/material';
import Link from 'next/link';
import RetirementPlanner from '@/components/planning/RetirementPlanner';
import PageHeader from '@/components/ui/PageHeader';

export default function PensionsPage() {
  return (
    <Box sx={{ maxWidth: 1440, mx: 'auto' }}>
      <PageHeader title="Retirement planner" description="Model pension contributions, growth and inflation against your retirement income target."
        actions={<><Button component={Link} href="/profile" variant="outlined">Personal context</Button><Button component={Link} href="/pensions/records" variant="contained">Pension records</Button></>} />
      <RetirementPlanner />
    </Box>
  );
}
