import { Box, Chip, Stack, Typography } from '@mui/material';
import RetirementPlanner from '@/components/planning/RetirementPlanner';

export default function PensionsPage() {
  return (
    <Box>
      <Stack direction="row" alignItems="center" spacing={1.5} sx={{ mb: 1 }}>
        <Typography variant="h4">Pensions &amp; retirement</Typography>
        <Chip label="Plan your future" color="info" size="small" />
      </Stack>
      <Typography variant="body1" color="text.secondary" sx={{ mb: 3, maxWidth: 760 }}>
        See what your pension contributions could build, how inflation changes the picture,
        and what it would take to reach your retirement income goal.
      </Typography>
      <RetirementPlanner />
    </Box>
  );
}
