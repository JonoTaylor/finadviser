'use client';

import { Box, LinearProgress, Typography } from '@mui/material';
import type { ProgressEvent } from '@/lib/import/stream';

/**
 * Progress bar + status copy driven by the streaming import endpoints.
 * Determinate when we have a (processed, total) pair; indeterminate
 * otherwise (parsing, dedupe lookup, categorisation — all bounded
 * but unmeasurable in advance).
 */
export default function ImportProgress({ event }: { event: ProgressEvent | null }) {
  if (!event) return null;

  // Determinate only when we actually have a total > 0. If every row in
  // the batch is a duplicate, total is 0 and we'd otherwise pass an
  // undefined value to a determinate LinearProgress, which warns and
  // renders broken styling. Show indeterminate in that edge case.
  const isMeasurable = event.phase === 'saving' && event.total > 0;
  const value = isMeasurable && event.phase === 'saving'
    ? Math.min(100, Math.round((event.processed / event.total) * 100))
    : undefined;

  return (
    <Box sx={{ mb: 2 }}>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 0.5 }}>
        {labelFor(event)}
      </Typography>
      <LinearProgress
        variant={isMeasurable ? 'determinate' : 'indeterminate'}
        value={value}
      />
    </Box>
  );
}

function labelFor(event: ProgressEvent): string {
  switch (event.phase) {
    case 'parsing':            return 'Parsing the file…';
    case 'parsed':             return `Parsed ${event.total} row${event.total === 1 ? '' : 's'}.`;
    case 'checking-duplicates':return `Checking ${event.total} row${event.total === 1 ? '' : 's'} for duplicates…`;
    case 'categorising':       return `Categorising ${event.total} transaction${event.total === 1 ? '' : 's'}…`;
    case 'saving':             return `Saving transactions… ${event.processed} of ${event.total}`;
    case 'done':               return 'Done.';
    case 'error':              return `Error: ${event.message}`;
  }
}
