'use client';

import { Alert } from '@mui/material';

export default function DecisionDisclaimer() {
  return (
    <Alert severity="info" variant="outlined" sx={{ mb: 2 }}>
      Decision support, not legal or financial advice. Confirm Ground 1A notice
      timing with a solicitor. Verify mortgage product details with your broker
      or lender.
    </Alert>
  );
}
