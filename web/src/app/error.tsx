'use client';

import { startTransition, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useSWRConfig } from 'swr';
import { Alert, Box, Button, Stack, Typography } from '@mui/material';
import RefreshRoundedIcon from '@mui/icons-material/RefreshRounded';
import PageHeader from '@/components/ui/PageHeader';

/**
 * Page-level error boundary. It renders inside the root layout, so the
 * navigation stays usable and moving to another page clears the error.
 */
export default function PageError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const router = useRouter();
  const { mutate } = useSWRConfig();

  useEffect(() => {
    console.error('Page failed to render', error);
  }, [error]);

  const retry = () => {
    // Drop cached responses first: a remount would otherwise render the same
    // response that failed. Every hook on the page refetches when it mounts.
    void mutate(() => true, undefined, { revalidate: false });
    startTransition(() => {
      router.refresh();
      reset();
    });
  };

  const detail = error.digest ? `Reference ${error.digest}` : error.message;

  return <Box>
    <PageHeader title="This page could not be displayed" />
    <Alert severity="warning" action={<Button color="inherit" size="small" startIcon={<RefreshRoundedIcon />} onClick={retry}>Retry</Button>}>
      Something went wrong while showing this page. Your saved financial data has not been changed. Retry, or use the navigation to continue elsewhere.
    </Alert>
    <Stack direction="row" gap={1} sx={{ mt: 2 }}>
      <Button component={Link} href="/" variant="outlined" size="small">Go to the overview</Button>
    </Stack>
    {detail && <Typography variant="caption" component="p" sx={{ mt: 2, overflowWrap: 'anywhere' }}>Technical detail: {detail}</Typography>}
  </Box>;
}
