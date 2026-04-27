'use client';

import { use } from 'react';
import useSWR from 'swr';
import {
  Box, Typography, Card, CardContent, Stack, Chip, Alert, IconButton, Table,
  TableHead, TableBody, TableRow, TableCell, Tooltip,
} from '@mui/material';
import ArrowBackRoundedIcon from '@mui/icons-material/ArrowBackRounded';
import { format, formatDistanceToNow } from 'date-fns';
import Link from 'next/link';
import { softTokens } from '@/theme/theme';

interface SyncRunRow {
  id: number;
  startedAt: string;
  finishedAt: string | null;
  status: 'running' | 'success' | 'partial' | 'error';
  txnsAdded: number;
  txnsUpdated: number;
  errorMessage: string | null;
}

interface ConnectionDetail {
  id: number;
  providerDisplayName: string;
  institutionName: string;
  status: string;
  lastSyncedAt: string | null;
}

interface Response {
  connection: ConnectionDetail;
  runs: SyncRunRow[];
}

const fetcher = async (url: string) => {
  const res = await fetch(url);
  const body = await res.json();
  if (!res.ok) throw new Error(body?.error ?? `Request failed: ${res.status}`);
  return body;
};

const STATUS_CHIP: Record<SyncRunRow['status'], { label: string; tile: string; ink: string }> = {
  running: { label: 'Running',  tile: softTokens.lavender.main, ink: softTokens.lavender.ink },
  success: { label: 'Success',  tile: softTokens.mint.main,     ink: softTokens.mint.ink },
  partial: { label: 'Partial',  tile: softTokens.lemon.main,    ink: softTokens.lemon.ink },
  error:   { label: 'Error',    tile: softTokens.peach.main,    ink: softTokens.peach.ink },
};

export default function SyncRunsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const connectionId = parseInt(id, 10);

  const { data, error, isLoading } = useSWR<Response>(
    Number.isNaN(connectionId) ? null : `/api/banking/connections/${connectionId}/sync-runs`,
    fetcher,
    { revalidateOnFocus: false, refreshInterval: 30_000 },
  );

  if (Number.isNaN(connectionId)) {
    return <Alert severity="error">Invalid connection id.</Alert>;
  }

  return (
    <Box>
      <Box sx={{ mb: 3, display: 'flex', alignItems: 'center', gap: 1.5 }}>
        <IconButton size="small" component={Link} href="/settings/connections">
          <ArrowBackRoundedIcon />
        </IconButton>
        <Box>
          <Typography variant="h4">Sync history</Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mt: 0.25 }}>
            {data ? `${data.connection.providerDisplayName} - ${data.connection.institutionName}` : 'Loading...'}
          </Typography>
        </Box>
      </Box>

      {error && <Alert severity="error" sx={{ mb: 2 }}>{error.message}</Alert>}
      {isLoading && <Typography variant="body2" color="text.secondary">Loading sync runs...</Typography>}

      {data && (
        <Stack spacing={2}>
          <Card>
            <CardContent>
              <Stack direction="row" spacing={3} flexWrap="wrap" useFlexGap>
                <Box>
                  <Typography variant="caption" color="text.secondary" sx={{ display: 'block', textTransform: 'uppercase', fontSize: '0.7rem', letterSpacing: '0.05em' }}>
                    Last successful sync
                  </Typography>
                  <Typography variant="body1" sx={{ fontWeight: 500 }}>
                    {data.connection.lastSyncedAt
                      ? `${formatDistanceToNow(new Date(data.connection.lastSyncedAt), { addSuffix: true })}`
                      : 'Never'}
                  </Typography>
                </Box>
                <Box>
                  <Typography variant="caption" color="text.secondary" sx={{ display: 'block', textTransform: 'uppercase', fontSize: '0.7rem', letterSpacing: '0.05em' }}>
                    Run count (last 50)
                  </Typography>
                  <Typography variant="body1" sx={{ fontWeight: 500 }}>{data.runs.length}</Typography>
                </Box>
              </Stack>
            </CardContent>
          </Card>

          <Card>
            <CardContent>
              {data.runs.length === 0 ? (
                <Typography variant="body2" color="text.secondary">
                  No sync runs yet. The daily cron writes one row per connection per day; manual syncs from the connections page also show up here.
                </Typography>
              ) : (
                <Table size="small">
                  <TableHead>
                    <TableRow>
                      <TableCell>Started</TableCell>
                      <TableCell>Status</TableCell>
                      <TableCell align="right">Added</TableCell>
                      <TableCell align="right">Updated</TableCell>
                      <TableCell>Duration</TableCell>
                      <TableCell>Error</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {data.runs.map(r => {
                      const chip = STATUS_CHIP[r.status];
                      const started = new Date(r.startedAt);
                      const finished = r.finishedAt ? new Date(r.finishedAt) : null;
                      const durationMs = finished ? finished.getTime() - started.getTime() : null;
                      return (
                        <TableRow key={r.id}>
                          <TableCell sx={{ whiteSpace: 'nowrap' }}>
                            <Tooltip title={format(started, 'd MMM yyyy HH:mm:ss')}>
                              <span>{formatDistanceToNow(started, { addSuffix: true })}</span>
                            </Tooltip>
                          </TableCell>
                          <TableCell>
                            <Chip
                              label={chip.label}
                              size="small"
                              sx={{ bgcolor: chip.tile, color: chip.ink, fontWeight: 600 }}
                            />
                          </TableCell>
                          <TableCell align="right" sx={{ fontFeatureSettings: '"tnum"' }}>{r.txnsAdded}</TableCell>
                          <TableCell align="right" sx={{ fontFeatureSettings: '"tnum"' }}>{r.txnsUpdated}</TableCell>
                          <TableCell sx={{ whiteSpace: 'nowrap', color: 'text.secondary' }}>
                            {durationMs !== null ? `${(durationMs / 1000).toFixed(1)}s` : '...'}
                          </TableCell>
                          <TableCell sx={{ color: 'text.secondary', fontSize: '0.78rem', maxWidth: 360 }}>
                            {r.errorMessage ?? ''}
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </Stack>
      )}
    </Box>
  );
}
