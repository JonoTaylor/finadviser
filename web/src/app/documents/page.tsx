'use client';

import { useState } from 'react';
import useSWR from 'swr';
import Link from 'next/link';
import { Box, Card, CardContent, Typography, Stack, Table, TableHead, TableRow, TableCell, TableBody, TableContainer, IconButton, Chip, Link as MuiLink, Alert, Skeleton, Button, TextField, Dialog, DialogTitle, DialogContent, DialogContentText, DialogActions } from '@mui/material';
import DeleteOutlineRoundedIcon from '@mui/icons-material/DeleteOutlineRounded';
import DownloadRoundedIcon from '@mui/icons-material/DownloadRounded';
import OpenInNewRoundedIcon from '@mui/icons-material/OpenInNewRounded';
import PageHeader from '@/components/ui/PageHeader';
import { fetchJson } from '@/lib/http/client';

interface DocumentMeta {
  id: number; kind: 'tenancy_agreement' | 'other'; filename: string; mimeType: string;
  sizeBytes: number; sha256: string; propertyId: number | null; tenancyId: number | null;
  notes: string | null; uploadedAt: string;
}
interface PropertyMeta { id: number; name: string }

const fetcher = async <T,>(url: string): Promise<T[]> => {
  const data = await fetchJson<unknown>(url);
  if (!Array.isArray(data)) throw new Error('The document library returned an unreadable response.');
  return data as T[];
};
const KIND_LABEL: Record<DocumentMeta['kind'], string> = { tenancy_agreement: 'Tenancy agreement', other: 'Other' };
function formatBytes(size: number): string {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / 1024 / 1024).toFixed(1)} MB`;
}
function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-GB', { timeZone: 'Europe/London', year: 'numeric', month: 'short', day: 'numeric' });
}

export default function DocumentsPage() {
  const { data: docs, error, isLoading, mutate } = useSWR<DocumentMeta[]>('/api/documents', fetcher<DocumentMeta>, { shouldRetryOnError: false });
  const { data: properties, error: propertiesError } = useSWR<PropertyMeta[]>('/api/properties', fetcher<PropertyMeta>, { shouldRetryOnError: false });
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<number | null>(null);
  const [pendingDelete, setPendingDelete] = useState<DocumentMeta | null>(null);
  const [query, setQuery] = useState('');

  const propertyName = (id: number | null): string => id === null ? '—' : properties?.find(property => property.id === id)?.name ?? `#${id}`;
  const visibleDocs = (docs ?? []).filter(doc => `${doc.filename} ${doc.notes ?? ''} ${propertyName(doc.propertyId)} ${KIND_LABEL[doc.kind]}`.toLowerCase().includes(query.trim().toLowerCase()));

  const handleDelete = async (doc: DocumentMeta) => {
    if (deleting !== null) return;
    setErrorMsg(null);
    setDeleting(doc.id);
    try {
      await fetchJson(`/api/documents/${doc.id}`, { method: 'DELETE' });
      void mutate(current => current?.filter(item => item.id !== doc.id), { revalidate: true }).catch(() => undefined);
      setPendingDelete(null);
    } catch {
      setErrorMsg('This document could not be deleted. Please try again.');
    } finally {
      setDeleting(null);
    }
  };

  return <Box sx={{ minWidth: 0 }}>
    <PageHeader title="Documents" description="Keep source documents connected to your properties and tenancies." actions={<Button component={Link} href="/properties" variant="outlined" size="small">Manage properties</Button>} />
    <Card><CardContent>
      <Stack direction={{ xs: 'column', sm: 'row' }} justifyContent="space-between" gap={2} alignItems={{ sm: 'center' }} sx={{ mb: 2 }}>
        <Box><Typography variant="subtitle1" sx={{ fontWeight: 600 }}>Document library</Typography><Typography variant="caption">{docs ? `${docs.length} saved document${docs.length === 1 ? '' : 's'}` : 'Your saved source files'}</Typography></Box>
        <TextField size="small" label="Search documents" value={query} onChange={event => setQuery(event.target.value)} disabled={!docs} sx={{ width: { xs: '100%', sm: 280 }, maxWidth: '100%' }} />
      </Stack>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2.5 }}>Upload tenancy agreements from the tenancies tab of the relevant property.</Typography>
      {error && <Alert severity="warning" sx={{ mb: 2 }}>Your documents could not be loaded.{docs ? ' The previously loaded library is shown below.' : ' Please try again.'}<Button size="small" onClick={() => mutate()} sx={{ display: 'block', mt: 0.75 }}>Try again</Button></Alert>}
      {propertiesError && docs?.length ? <Alert severity="info" sx={{ mb: 2 }}>Property names are unavailable. Associated property IDs are still shown.</Alert> : null}
      {isLoading && !docs ? <Skeleton variant="rounded" height={180} sx={{ borderRadius: '6px' }} /> : !docs && error ? null : docs?.length === 0 ? <Box sx={{ py: 4 }}>
        <Typography variant="body2" sx={{ fontWeight: 600 }}>No documents yet</Typography><Typography variant="body2" color="text.secondary" sx={{ mt: 0.75 }}>Store a tenancy agreement from a property to keep its source file available here.</Typography>
      </Box> : visibleDocs.length === 0 ? <Box sx={{ py: 3 }}><Typography variant="body2" color="text.secondary">No documents match your search.</Typography><Button size="small" onClick={() => setQuery('')} sx={{ mt: 1 }}>Clear search</Button></Box> :
        <TableContainer tabIndex={0} role="region" aria-label="Stored document records" sx={{ maxWidth: '100%', overflowX: 'auto' }}>
          <Table size="small" aria-label="Document library" sx={{ minWidth: 850 }}>
            <TableHead><TableRow><TableCell>File</TableCell><TableCell>Type</TableCell><TableCell>Property</TableCell><TableCell>Tenancy</TableCell><TableCell align="right">Size</TableCell><TableCell>Uploaded</TableCell><TableCell align="right">Actions</TableCell></TableRow></TableHead>
            <TableBody>{visibleDocs.map(doc => <TableRow key={doc.id}>
              <TableCell sx={{ maxWidth: 280 }}><MuiLink href={`/api/documents/${doc.id}/file`} target="_blank" rel="noopener" sx={{ fontWeight: 500, overflowWrap: 'anywhere' }}>{doc.filename}</MuiLink></TableCell>
              <TableCell><Chip size="small" label={KIND_LABEL[doc.kind]} variant="outlined" /></TableCell>
              <TableCell>{propertyName(doc.propertyId)}</TableCell><TableCell>{doc.tenancyId !== null ? `#${doc.tenancyId}` : '—'}</TableCell>
              <TableCell align="right" sx={{ whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' }}>{formatBytes(doc.sizeBytes)}</TableCell>
              <TableCell sx={{ whiteSpace: 'nowrap' }}>{formatDate(doc.uploadedAt)}</TableCell>
              <TableCell align="right" sx={{ whiteSpace: 'nowrap' }}>
                <IconButton size="small" component="a" href={`/api/documents/${doc.id}/file`} target="_blank" rel="noopener" title="Open" aria-label={`Open ${doc.filename}`}><OpenInNewRoundedIcon fontSize="small" /></IconButton>
                <IconButton size="small" component="a" href={`/api/documents/${doc.id}/file?download=1`} title="Download" aria-label={`Download ${doc.filename}`}><DownloadRoundedIcon fontSize="small" /></IconButton>
                <IconButton size="small" onClick={() => { setErrorMsg(null); setPendingDelete(doc); }} disabled={deleting !== null} title="Delete" aria-label={`Delete ${doc.filename}`}><DeleteOutlineRoundedIcon fontSize="small" /></IconButton>
              </TableCell>
            </TableRow>)}</TableBody>
          </Table>
        </TableContainer>}
    </CardContent></Card>
    <Dialog open={pendingDelete !== null} onClose={() => { if (deleting === null) setPendingDelete(null); }} aria-labelledby="delete-document-title" maxWidth="xs" fullWidth>
      <DialogTitle id="delete-document-title">Delete this document?</DialogTitle>
      <DialogContent>
        <Typography variant="body2" sx={{ fontWeight: 600, overflowWrap: 'anywhere', mb: 1 }}>{pendingDelete?.filename}</Typography>
        <DialogContentText>This removes the stored source file. Any tenancy created from it will remain in your records.</DialogContentText>
        {errorMsg && <Alert severity="error" sx={{ mt: 2 }}>{errorMsg}</Alert>}
      </DialogContent>
      <DialogActions><Button onClick={() => setPendingDelete(null)} disabled={deleting !== null}>Cancel</Button><Button color="error" variant="contained" onClick={() => { if (pendingDelete) void handleDelete(pendingDelete); }} disabled={deleting !== null}>{deleting !== null ? 'Deleting…' : 'Delete document'}</Button></DialogActions>
    </Dialog>
  </Box>;
}
