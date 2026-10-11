import { Box } from '@mui/material';
import PortfolioWorkspace from '@/components/finance/PortfolioWorkspace';
import PageHeader from '@/components/ui/PageHeader';

export default function PortfolioPage() {
  return (
    <Box>
      <PageHeader title="Portfolio & fees" description="Review the holdings, allocation and charges inside your pensions, ISAs and investment accounts." />
      <PortfolioWorkspace />
    </Box>
  );
}
