import { Box, Chip, Stack, Typography } from '@mui/material';
import PortfolioWorkspace from '@/components/finance/PortfolioWorkspace';

export default function PortfolioPage() {
  return (
    <Box>
      <Stack direction="row" alignItems="center" flexWrap="wrap" gap={1.5} sx={{ mb: 1 }}>
        <Typography variant="h4">Portfolio &amp; fees</Typography>
        <Chip label="Know what you own" color="info" size="small" />
      </Stack>
      <Typography color="text.secondary" sx={{ mb: 3, maxWidth: 780 }}>
        Connect the investments inside your pensions, ISAs and other accounts. See your recorded asset mix,
        reconciliation gaps and known annual charges in one place.
      </Typography>
      <PortfolioWorkspace />
    </Box>
  );
}
