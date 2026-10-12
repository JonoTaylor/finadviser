'use client';

import { Alert, Box, Chip, Stack, Typography } from '@mui/material';
import type { CategorizationResult } from '@/lib/categorization/types';

export default function ProcessingSummary({ result }: { result: CategorizationResult }) {
  const applied = result.ruleBased + result.aiCategorized + result.learned;
  return <Box aria-live="polite">
    <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap sx={{ mb: 1 }}>
      <Chip label={`${applied} categorised`} color={applied ? 'success' : 'default'} variant="outlined" size="small" />
      <Chip label={`${result.reviewQueued} sent for review`} variant="outlined" size="small" />
      <Chip label={`${result.available} queued`} variant="outlined" size="small" />
    </Stack>
    {result.aiSkippedReason && <Alert severity={result.deferredReason === 'time_budget' ? 'info' : 'warning'} sx={{ mb: 1 }}>{result.aiSkippedReason}</Alert>}
    {result.busy && <Alert severity="info" sx={{ mb: 1 }}>Another processing run is active. Your records will update when it finishes.</Alert>}
    {result.conflicts > 0 && <Typography variant="body2" color="text.secondary">{result.conflicts} records changed during processing. Their newer versions were kept.</Typography>}
  </Box>;
}
