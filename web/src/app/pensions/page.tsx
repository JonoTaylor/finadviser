import { Box, Button, Chip, Stack, Typography } from '@mui/material';
import Link from 'next/link';
import RetirementPlanner from '@/components/planning/RetirementPlanner';

export default function PensionsPage() {
  return (
    <Box>
      <Stack direction="row" alignItems="center" spacing={1.5} flexWrap="wrap" useFlexGap sx={{ mb: 1 }}>
        <Typography variant="h4">Pensions &amp; retirement</Typography>
        <Chip label="Plan your future" color="info" size="small" />
      </Stack>
      <Typography variant="body1" color="text.secondary" sx={{ mb: 3, maxWidth: 760 }}>
        See what your pension contributions could build, how inflation changes the picture,
        and what it would take to reach your retirement income goal.
      </Typography>
      <Stack direction="row" gap={1} flexWrap="wrap" sx={{ mb: 3 }}><Button component={Link} href="/pensions/records" variant="contained">My pension schemes</Button><Button component={Link} href="/profile" variant="outlined">Choose my personal owner</Button></Stack>
      <RetirementPlanner />
    </Box>
  );
}
