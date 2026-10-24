'use client';

import { Alert, Box, Button, Chip, Stack, Typography } from '@mui/material';
import type { CategorizationResult } from '@/lib/categorization/types';

export default function ProcessingSummary({ result, onContinue, running = false }: { result: CategorizationResult; onContinue?: () => void; running?: boolean }) {
  const applied = result.ruleBased + result.aiCategorized + result.learned;
  const paused = result.deferredReason === 'time_budget';
  return <Box aria-live="polite">
    <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap sx={{ mb: 1 }}>
      <Chip label={`${applied} categorised`} color={applied ? 'success' : 'default'} variant="outlined" size="small" />
      <Chip label={`${result.reviewQueued} sent for review`} variant="outlined" size="small" />
      <Chip label={`${result.available} queued`} variant="outlined" size="small" />
    </Stack>
    {paused && <Alert severity="info" sx={{ mb: 1 }} action={onContinue && result.hasMore ? <Button size="small" disabled={running} onClick={onContinue}>Continue processing</Button> : undefined}>
      {running ? 'Completed decisions are saved as processing continues.' : 'Processing paused at the time limit.'} {result.available > 0 ? `${result.available} records remain queued. ` : ''}{!running && (applied + result.reviewQueued > 0 ? 'Completed decisions have been saved. ' : '')}{!running && result.hasMore && 'You can retry the remaining records.'}
    </Alert>}
    {result.aiSkippedReason && !paused && !result.busy && <Alert severity="warning" sx={{ mb: 1 }}>{result.aiSkippedReason}</Alert>}
    {result.busy && <Alert severity="info" sx={{ mb: 1 }}>Another processing run is active. Your records will update when it finishes.</Alert>}
    {result.conflicts > 0 && <Typography variant="body2" color="text.secondary">{result.conflicts} records changed during processing. Their newer versions were kept.</Typography>}
  </Box>;
}
