'use client';

import Link from 'next/link';
import { Alert, Box, Button, Chip, Stack, Typography } from '@mui/material';
import ArrowForwardRoundedIcon from '@mui/icons-material/ArrowForwardRounded';
import type { ProcessedImportResult } from '@/lib/import/import-pipeline';

export default function ImportProcessingSummary({ processing }: { processing?: ProcessedImportResult['categorization'] }) {
  const applied = processing && typeof processing.ruleBased === 'number' && typeof processing.learned === 'number' && typeof processing.aiCategorized === 'number' ? processing.ruleBased + processing.learned + processing.aiCategorized : null;
  return <Box sx={{ mt: 2.5, pt: 2, borderTop: 1, borderColor: 'divider' }}>
    <Typography variant="subtitle2" component="h2" sx={{ mb: 1 }}>Your data assistant</Typography>
    {processing ? <>
      <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap sx={{ mb: 1.25 }}><Chip variant="outlined" size="small" label={applied === null ? 'Processing counts unavailable' : `${applied} categorised automatically`} />{typeof processing.reviewQueued === 'number' && <Chip variant="outlined" size="small" label={`${processing.reviewQueued} sent for review`} />}</Stack>
      <Typography variant="body2" color="text.secondary">{processing.available === null ? 'The remaining processing queue could not be assessed.' : `${processing.available} records remain queued across your accounts.`} Review counts cover this processing pass.</Typography>
      {(processing.status === 'unavailable' || processing.aiSkippedReason) && <Alert severity="info" sx={{ mt: 1.5 }}>{processing.aiSkippedReason === 'processing_failed' ? 'Your transactions were saved, but automatic processing could not finish. Open the assistant to retry.' : processing.aiSkippedReason || 'Automatic processing is unavailable. Your imported records were saved.'}</Alert>}
      {processing.busy && <Alert severity="info" sx={{ mt: 1.5 }}>Another processing run is active. Your import has been saved.</Alert>}
    </> : <Typography variant="body2" color="text.secondary">Your import is saved. Open the assistant to organise the records and review missing information.</Typography>}
    <Button component={Link} href="/data" variant="outlined" endIcon={<ArrowForwardRoundedIcon />} sx={{ mt: 1.5 }}>Review data and next steps</Button>
  </Box>;
}
