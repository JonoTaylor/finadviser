'use client';

import { useRef, useState } from 'react';
import {
  Box,
  Card,
  CardContent,
  Typography,
  Stack,
  Button,
  Select,
  MenuItem,
  FormControl,
  InputLabel,
  Alert,
  CircularProgress,
  Collapse,
  Chip,
  Table,
  TableHead,
  TableRow,
  TableCell,
  TableBody,
  IconButton,
} from '@mui/material';
import UploadFileRoundedIcon from '@mui/icons-material/UploadFileRounded';
import HistoryEduRoundedIcon from '@mui/icons-material/HistoryEduRounded';
import ExpandMoreRoundedIcon from '@mui/icons-material/ExpandMoreRounded';

interface AccountOption { id: number; name: string }
interface BankConfigOption { name: string; description: string }

interface BackfillResult {
  totalRows: number;
  rowsWithMetadata: number;
  matchedExisting: number;
  inserted: number;
  filledFields: number;
  noChange: number;
  unmatched: Array<{
    date: string;
    description: string;
    amount: string;
    externalId: string | null;
    reason: 'no_match' | 'ambiguous_external_id';
  }>;
}

const REASON_LABEL: Record<BackfillResult['unmatched'][number]['reason'], string> = {
  no_match: 'no match',
  ambiguous_external_id: 'ambiguous tx_id',
};

/**
 * Re-upload a Monzo (or other rich) export to enrich existing journal
 * entries with merchant / type / external-id metadata, without
 * creating new transactions. COALESCE semantics — never overwrites a
 * non-null field. Useful one-off after a bank profile gains new
 * column mappings (the Monzo profile in PR #23 is the motivating
 * case).
 */
export default function BackfillMetadataCard({
  accounts,
  bankConfigs,
}: {
  accounts: AccountOption[];
  bankConfigs: Record<string, BankConfigOption>;
}) {
  const [bankConfig, setBankConfig] = useState('monzo');
  const [accountName, setAccountName] = useState('Bank');
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<BackfillResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showUnmatched, setShowUnmatched] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const handleFile = async (file: File) => {
    setSubmitting(true);
    setError(null);
    setResult(null);
    try {
      const fd = new FormData();
      fd.append('file', file);
      fd.append('bankConfig', bankConfig);
      fd.append('accountName', accountName);
      const res = await fetch('/api/import/backfill-metadata', { method: 'POST', body: fd });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }
      const data = (await res.json()) as BackfillResult;
      setResult(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to backfill');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Card sx={{ mt: 4 }}>
      <CardContent>
        <Stack direction="row" alignItems="center" spacing={1.5} sx={{ mb: 1 }}>
          <HistoryEduRoundedIcon color="secondary" />
          <Typography variant="h6">Backfill metadata onto existing transactions</Typography>
        </Stack>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          Re-upload a Monzo CSV here to enrich transactions you&rsquo;ve <strong>already imported</strong> with
          merchant / type / external-id columns the original import didn&rsquo;t capture. No new
          journal entries are created. Existing non-null metadata fields are preserved (COALESCE),
          so this is safe to re-run.
        </Typography>

        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} sx={{ mb: 2 }}>
          <FormControl size="small" sx={{ minWidth: 200 }}>
            <InputLabel>Account</InputLabel>
            <Select value={accountName} label="Account" onChange={e => setAccountName(e.target.value)}>
              {accounts.map(a => <MenuItem key={a.id} value={a.name}>{a.name}</MenuItem>)}
            </Select>
          </FormControl>
          <FormControl size="small" sx={{ minWidth: 240 }}>
            <InputLabel>Bank config</InputLabel>
            <Select value={bankConfig} label="Bank config" onChange={e => setBankConfig(e.target.value)}>
              {Object.values(bankConfigs).map(b => (
                <MenuItem key={b.name} value={b.name}>{b.description}</MenuItem>
              ))}
            </Select>
          </FormControl>
          <input
            ref={fileRef}
            type="file"
            accept=".csv,text/csv"
            hidden
            onChange={e => {
              const f = e.target.files?.[0];
              if (f) handleFile(f);
              if (fileRef.current) fileRef.current.value = '';
            }}
          />
          <Button
            variant="contained"
            startIcon={submitting ? <CircularProgress size={16} color="inherit" /> : <UploadFileRoundedIcon />}
            disabled={submitting || !accountName || !bankConfig}
            onClick={() => fileRef.current?.click()}
          >
            {submitting ? 'Backfilling…' : 'Upload CSV'}
          </Button>
        </Stack>

        {error && <Alert severity="error" onClose={() => setError(null)} sx={{ mb: 2 }}>{error}</Alert>}

        {result && (
          <Box>
            <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap sx={{ mb: 1.5 }}>
              <Chip size="small" variant="outlined" label={`Rows in CSV: ${result.totalRows}`} />
              <Chip size="small" variant="outlined" label={`With metadata: ${result.rowsWithMetadata}`} />
              <Chip size="small" color="success" label={`Matched existing: ${result.matchedExisting}`} />
              <Chip size="small" color="primary" label={`New metadata rows: ${result.inserted}`} />
              <Chip size="small" color="info" label={`Filled NULL fields: ${result.filledFields}`} />
              <Chip size="small" variant="outlined" label={`No change: ${result.noChange}`} />
              {result.unmatched.length > 0 && (
                <Chip size="small" color="warning" label={`Unmatched: ${result.unmatched.length}`} />
              )}
            </Stack>

            {result.unmatched.length > 0 && (
              <>
                <Stack direction="row" alignItems="center" spacing={1}>
                  <Typography variant="caption" color="text.secondary">
                    {result.unmatched.length} CSV rows didn&rsquo;t match any existing journal on this account.
                    They were ignored — re-import them through the regular flow if you want them recorded.
                  </Typography>
                  <IconButton size="small" onClick={() => setShowUnmatched(s => !s)} aria-label="Toggle unmatched">
                    <ExpandMoreRoundedIcon
                      sx={{ transition: 'transform .2s', transform: showUnmatched ? 'rotate(180deg)' : 'none' }}
                    />
                  </IconButton>
                </Stack>
                <Collapse in={showUnmatched}>
                  <Box sx={{ mt: 1, maxHeight: 280, overflow: 'auto' }}>
                    <Table size="small">
                      <TableHead>
                        <TableRow>
                          <TableCell>Date</TableCell>
                          <TableCell>Description</TableCell>
                          <TableCell align="right">Amount</TableCell>
                          <TableCell>tx_id</TableCell>
                          <TableCell>Reason</TableCell>
                        </TableRow>
                      </TableHead>
                      <TableBody>
                        {result.unmatched.map((u, i) => (
                          <TableRow key={i}>
                            <TableCell>{u.date}</TableCell>
                            <TableCell sx={{ maxWidth: 360, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                              {u.description}
                            </TableCell>
                            <TableCell align="right">{u.amount}</TableCell>
                            <TableCell sx={{ fontFamily: 'monospace', fontSize: '0.75rem', color: 'text.secondary' }}>
                              {u.externalId ?? '—'}
                            </TableCell>
                            <TableCell>
                              <Chip
                                size="small"
                                variant="outlined"
                                color={u.reason === 'ambiguous_external_id' ? 'warning' : 'default'}
                                label={REASON_LABEL[u.reason]}
                                sx={{ height: 22, fontSize: '0.7rem' }}
                              />
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </Box>
                </Collapse>
              </>
            )}
          </Box>
        )}
      </CardContent>
    </Card>
  );
}
