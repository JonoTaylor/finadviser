'use client';

import { useRef, useState } from 'react';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  TextField,
  Stack,
  MenuItem,
  Typography,
  Box,
  Alert,
  CircularProgress,
  Chip,
} from '@mui/material';
import UploadFileRoundedIcon from '@mui/icons-material/UploadFileRounded';
import type { RentFrequency } from '@/lib/repos/tenancy.repo';

interface ExtractedTenancy {
  tenantName: string | null;
  startDate: string | null;
  endDate: string | null;
  rentAmount: string | null;
  rentFrequency: RentFrequency | null;
  depositAmount: string | null;
  propertyAddress: string | null;
  notes: string | null;
}

interface ImportResult {
  documentId: number;
  extracted: ExtractedTenancy;
  reused: boolean;
}

interface FormState {
  tenantName: string;
  startDate: string;
  endDate: string;
  rentAmount: string;
  rentFrequency: RentFrequency;
  depositAmount: string;
  notes: string;
}

const EMPTY_FORM: FormState = {
  tenantName: '',
  startDate: '',
  endDate: '',
  rentAmount: '',
  rentFrequency: 'monthly',
  depositAmount: '',
  notes: '',
};

function fromExtracted(e: ExtractedTenancy): FormState {
  // Stitch the property address into notes if the AI surfaced one — it's
  // useful confirmation context but doesn't have its own form field
  // (property is pinned by the propertyId on the calling card).
  const notes = [e.notes, e.propertyAddress ? `Address on agreement: ${e.propertyAddress}` : null]
    .filter(Boolean)
    .join('\n\n');
  return {
    tenantName: e.tenantName ?? '',
    startDate: e.startDate ?? '',
    endDate: e.endDate ?? '',
    rentAmount: e.rentAmount ?? '',
    rentFrequency: e.rentFrequency ?? 'monthly',
    depositAmount: e.depositAmount ?? '',
    notes,
  };
}

export default function TenancyImportDialog({
  open,
  propertyId,
  onClose,
  onCreated,
}: {
  open: boolean;
  propertyId: number;
  onClose: () => void;
  onCreated: () => void;
}) {
  const [phase, setPhase] = useState<'pick' | 'extracting' | 'review' | 'saving'>('pick');
  const [result, setResult] = useState<ImportResult | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [prevOpen, setPrevOpen] = useState(open);
  const fileRef = useRef<HTMLInputElement>(null);

  if (open !== prevOpen) {
    setPrevOpen(open);
    if (open) {
      setPhase('pick');
      setResult(null);
      setForm(EMPTY_FORM);
      setErrorMsg(null);
    }
  }

  const handleFile = async (file: File) => {
    setPhase('extracting');
    setErrorMsg(null);
    try {
      const fd = new FormData();
      fd.append('file', file);
      fd.append('propertyId', String(propertyId));
      const res = await fetch('/api/tenancies/import-pdf', { method: 'POST', body: fd });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }
      const data = (await res.json()) as ImportResult;
      setResult(data);
      setForm(fromExtracted(data.extracted));
      setPhase('review');
    } catch (e) {
      setErrorMsg(e instanceof Error ? e.message : 'Failed to extract tenancy from PDF');
      setPhase('pick');
    }
  };

  const handleSave = async () => {
    if (!result) return;
    setPhase('saving');
    setErrorMsg(null);
    try {
      const res = await fetch('/api/tenancies/from-document', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          documentId: result.documentId,
          propertyId,
          tenantName: form.tenantName,
          startDate: form.startDate,
          endDate: form.endDate || null,
          rentAmount: form.rentAmount,
          rentFrequency: form.rentFrequency,
          depositAmount: form.depositAmount || null,
          notes: form.notes || null,
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }
      onCreated();
      onClose();
    } catch (e) {
      setErrorMsg(e instanceof Error ? e.message : 'Failed to save tenancy');
      setPhase('review');
    }
  };

  const valid = form.tenantName && form.startDate && form.rentAmount;

  return (
    <Dialog open={open} onClose={phase === 'extracting' || phase === 'saving' ? undefined : onClose} maxWidth="sm" fullWidth>
      <DialogTitle>Import tenancy from PDF</DialogTitle>
      <DialogContent>
        {errorMsg && (
          <Alert severity="error" sx={{ mb: 2 }} onClose={() => setErrorMsg(null)}>
            {errorMsg}
          </Alert>
        )}

        {phase === 'pick' && (
          <Stack spacing={2} alignItems="flex-start" sx={{ mt: 1 }}>
            <Typography variant="body2" color="text.secondary">
              Upload an Assured Shorthold Tenancy agreement (PDF, text-based — scanned images aren&rsquo;t supported).
              The AI will extract the tenant, dates, rent, and deposit. You can correct anything before saving.
              The original PDF will be stored in Documents.
            </Typography>
            <input
              ref={fileRef}
              type="file"
              accept="application/pdf"
              hidden
              onChange={e => {
                const file = e.target.files?.[0];
                if (file) handleFile(file);
                if (fileRef.current) fileRef.current.value = '';
              }}
            />
            <Button
              variant="contained"
              startIcon={<UploadFileRoundedIcon />}
              onClick={() => fileRef.current?.click()}
            >
              Choose PDF
            </Button>
          </Stack>
        )}

        {phase === 'extracting' && (
          <Stack direction="row" spacing={2} alignItems="center" sx={{ py: 4 }}>
            <CircularProgress size={20} />
            <Typography variant="body2" color="text.secondary">
              Reading the PDF and extracting tenancy fields…
            </Typography>
          </Stack>
        )}

        {(phase === 'review' || phase === 'saving') && result && (
          <Stack spacing={2} sx={{ mt: 1 }}>
            <Box>
              <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 0.5 }}>
                <Typography variant="caption" color="text.secondary">Source PDF</Typography>
                {result.reused && <Chip size="small" label="re-used existing" variant="outlined" />}
              </Stack>
              <Typography
                variant="body2"
                component="a"
                href={`/api/documents/${result.documentId}/file`}
                target="_blank"
                rel="noopener"
                sx={{ color: 'primary.main', textDecoration: 'underline' }}
              >
                Open extracted document
              </Typography>
            </Box>
            <Typography variant="caption" color="text.secondary">
              Review the AI-extracted fields below — correct any that look wrong, then Save.
            </Typography>
            <TextField
              label="Tenant name(s)"
              required
              value={form.tenantName}
              onChange={e => setForm({ ...form, tenantName: e.target.value })}
            />
            <Stack direction="row" spacing={2}>
              <TextField
                label="Start date"
                type="date"
                required
                fullWidth
                slotProps={{ inputLabel: { shrink: true } }}
                value={form.startDate}
                onChange={e => setForm({ ...form, startDate: e.target.value })}
              />
              <TextField
                label="End date"
                type="date"
                fullWidth
                slotProps={{ inputLabel: { shrink: true } }}
                value={form.endDate}
                onChange={e => setForm({ ...form, endDate: e.target.value })}
                helperText="Leave blank if ongoing"
              />
            </Stack>
            <Stack direction="row" spacing={2}>
              <TextField
                label="Rent amount (£)"
                type="number"
                required
                fullWidth
                value={form.rentAmount}
                onChange={e => setForm({ ...form, rentAmount: e.target.value })}
              />
              <TextField
                select
                label="Frequency"
                fullWidth
                value={form.rentFrequency}
                onChange={e => setForm({ ...form, rentFrequency: e.target.value as RentFrequency })}
              >
                <MenuItem value="monthly">Monthly</MenuItem>
                <MenuItem value="four_weekly">Every 4 weeks</MenuItem>
                <MenuItem value="weekly">Weekly</MenuItem>
                <MenuItem value="quarterly">Quarterly</MenuItem>
                <MenuItem value="annual">Annual</MenuItem>
              </TextField>
            </Stack>
            <TextField
              label="Deposit (£)"
              type="number"
              value={form.depositAmount}
              onChange={e => setForm({ ...form, depositAmount: e.target.value })}
            />
            <TextField
              label="Notes"
              multiline
              minRows={3}
              value={form.notes}
              onChange={e => setForm({ ...form, notes: e.target.value })}
            />
          </Stack>
        )}
      </DialogContent>
      <DialogActions>
        <Button
          onClick={onClose}
          disabled={phase === 'extracting' || phase === 'saving'}
        >
          Cancel
        </Button>
        {(phase === 'review' || phase === 'saving') && (
          <Button
            variant="contained"
            disabled={!valid || phase === 'saving'}
            onClick={handleSave}
          >
            {phase === 'saving' ? 'Saving…' : 'Save tenancy'}
          </Button>
        )}
      </DialogActions>
    </Dialog>
  );
}
