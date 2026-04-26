'use client';

import { useState } from 'react';
import useSWR from 'swr';
import {
  Box,
  Card,
  CardContent,
  Typography,
  Stack,
  Table,
  TableHead,
  TableRow,
  TableCell,
  TableBody,
  IconButton,
  Chip,
  Link as MuiLink,
  Snackbar,
  Alert,
  CircularProgress,
} from '@mui/material';
import DeleteIcon from '@mui/icons-material/Delete';
import DownloadRoundedIcon from '@mui/icons-material/DownloadRounded';
import OpenInNewRoundedIcon from '@mui/icons-material/OpenInNewRounded';

interface DocumentMeta {
  id: number;
  kind: 'tenancy_agreement' | 'other';
  filename: string;
  mimeType: string;
  sizeBytes: number;
  sha256: string;
  propertyId: number | null;
  tenancyId: number | null;
  notes: string | null;
  uploadedAt: string;
}

interface PropertyMeta {
  id: number;
  name: string;
}

const fetcher = (url: string) => fetch(url).then(r => r.json());

const KIND_LABEL: Record<DocumentMeta['kind'], string> = {
  tenancy_agreement: 'Tenancy agreement',
  other: 'Other',
};

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString('en-GB', {
      year: 'numeric', month: 'short', day: 'numeric',
    });
  } catch {
    return iso;
  }
}

export default function DocumentsPage() {
  const { data: docs, error, isLoading, mutate } = useSWR<DocumentMeta[]>('/api/documents', fetcher);
  const { data: properties } = useSWR<PropertyMeta[]>('/api/properties', fetcher);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const propertyName = (id: number | null): string => {
    if (id === null) return '—';
    const p = properties?.find(p => p.id === id);
    return p?.name ?? `#${id}`;
  };

  const handleDelete = async (doc: DocumentMeta) => {
    if (!confirm(`Delete "${doc.filename}"? This will not delete any tenancy created from it.`)) return;
    try {
      const res = await fetch(`/api/documents/${doc.id}`, { method: 'DELETE' });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }
      mutate();
    } catch (e) {
      setErrorMsg(e instanceof Error ? e.message : 'Failed to delete document');
    }
  };

  return (
    <Box>
      <Box sx={{ mb: 3 }}>
        <Typography variant="h4">Documents</Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
          Stored source documents — tenancy agreements and other files referenced from elsewhere in the app.
          Upload via &ldquo;Import from PDF&rdquo; on a property&rsquo;s tenancies tab.
        </Typography>
      </Box>

      <Card>
        <CardContent>
          {isLoading ? (
            <Stack direction="row" spacing={1.5} alignItems="center">
              <CircularProgress size={18} />
              <Typography variant="body2" color="text.secondary">Loading documents…</Typography>
            </Stack>
          ) : error ? (
            <Alert severity="error">{error.message ?? 'Failed to load documents'}</Alert>
          ) : !docs || docs.length === 0 ? (
            <Typography variant="body2" color="text.secondary">
              No documents stored yet.
            </Typography>
          ) : (
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>File</TableCell>
                  <TableCell>Type</TableCell>
                  <TableCell>Property</TableCell>
                  <TableCell>Tenancy</TableCell>
                  <TableCell align="right">Size</TableCell>
                  <TableCell>Uploaded</TableCell>
                  <TableCell align="right" />
                </TableRow>
              </TableHead>
              <TableBody>
                {docs.map(doc => (
                  <TableRow key={doc.id}>
                    <TableCell>
                      <MuiLink href={`/api/documents/${doc.id}/file`} target="_blank" rel="noopener">
                        {doc.filename}
                      </MuiLink>
                    </TableCell>
                    <TableCell>
                      <Chip size="small" label={KIND_LABEL[doc.kind]} variant="outlined" />
                    </TableCell>
                    <TableCell>{propertyName(doc.propertyId)}</TableCell>
                    <TableCell>{doc.tenancyId !== null ? `#${doc.tenancyId}` : '—'}</TableCell>
                    <TableCell align="right">{formatBytes(doc.sizeBytes)}</TableCell>
                    <TableCell>{formatDate(doc.uploadedAt)}</TableCell>
                    <TableCell align="right">
                      <IconButton
                        size="small"
                        component="a"
                        href={`/api/documents/${doc.id}/file`}
                        target="_blank"
                        rel="noopener"
                        title="Open"
                      >
                        <OpenInNewRoundedIcon fontSize="small" />
                      </IconButton>
                      <IconButton
                        size="small"
                        component="a"
                        href={`/api/documents/${doc.id}/file?download=1`}
                        title="Download"
                      >
                        <DownloadRoundedIcon fontSize="small" />
                      </IconButton>
                      <IconButton size="small" onClick={() => handleDelete(doc)} title="Delete">
                        <DeleteIcon fontSize="small" />
                      </IconButton>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Snackbar
        open={Boolean(errorMsg)}
        autoHideDuration={6000}
        onClose={() => setErrorMsg(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      >
        <Alert severity="error" onClose={() => setErrorMsg(null)}>
          {errorMsg}
        </Alert>
      </Snackbar>
    </Box>
  );
}
