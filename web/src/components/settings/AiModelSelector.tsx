'use client';

import { useMemo, useState } from 'react';
import useSWR from 'swr';
import {
  Box,
  Stack,
  Typography,
  Select,
  MenuItem,
  FormControl,
  InputLabel,
  Button,
  Chip,
  Alert,
  Snackbar,
  CircularProgress,
  ListSubheader,
} from '@mui/material';
import { fetchJson } from '@/lib/http/client';

interface AvailableModel {
  id: string;
  name: string;
  description?: string;
  provider?: string;
}

interface ModelSettingResponse {
  modelId: string;
  source: 'db' | 'env' | 'default';
  options: AvailableModel[];
}

const fetcher = async (url: string): Promise<ModelSettingResponse> => {
  const data = await fetchJson<ModelSettingResponse>(url);
  if (!data || typeof data.modelId !== 'string' || !['db', 'env', 'default'].includes(data.source)
    || !Array.isArray(data.options) || data.options.some(option => typeof option.id !== 'string' || typeof option.name !== 'string')) {
    throw new Error('Available adviser models could not be read. Please retry.');
  }
  return data;
};

const SOURCE_LABEL: Record<ModelSettingResponse['source'], string> = {
  db: 'Saved selection',
  env: 'Workspace default',
  default: 'Default',
};

/**
 * Settings dropdown for the active AI model. The list of choices comes
 * live from the Vercel AI Gateway (see /api/settings/ai-model GET) so
 * new models appear automatically as Vercel adds them — no app deploy.
 *
 * Saves persist to app_settings and take effect on the next AI call.
 * "Reset to env / default" clears the row so resolution falls back to
 * MODEL_ID env or the hardcoded default.
 */
export default function AiModelSelector() {
  const { data, error, isLoading, mutate } = useSWR<ModelSettingResponse>(
    '/api/settings/ai-model',
    fetcher,
  );

  const [pending, setPending] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [snackbar, setSnackbar] = useState<{ open: boolean; message: string; severity: 'success' | 'error' }>({
    open: false,
    message: '',
    severity: 'success',
  });

  // Group models by provider so the dropdown is scannable.
  const grouped = useMemo(() => {
    if (!data) return [] as Array<[string, AvailableModel[]]>;
    const map = new Map<string, AvailableModel[]>();
    for (const m of data.options) {
      const provider = m.provider ?? 'other';
      if (!map.has(provider)) map.set(provider, []);
      map.get(provider)!.push(m);
    }
    return [...map.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [data]);

  if (isLoading) {
    return (
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
        <CircularProgress size={16} />
        <Typography variant="body2" color="text.secondary">Loading models…</Typography>
      </Box>
    );
  }
  if (error || !data) {
    return <Alert severity="error" action={<Button color="inherit" size="small" onClick={() => mutate()}>Retry</Button>}>
      Adviser models could not be loaded. {error?.message}
    </Alert>;
  }

  const selected = pending ?? data.modelId;
  const dirty = selected !== data.modelId;
  const known = data.options.find(o => o.id === selected);

  const handleSave = async () => {
    setSubmitting(true);
    try {
      const res = await fetch('/api/settings/ai-model', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ modelId: selected }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({} as { error?: string }));
        throw new Error(body.error || `HTTP ${res.status}`);
      }
      setPending(null);
      await mutate();
      setSnackbar({ open: true, message: `AI model set to ${selected}.`, severity: 'success' });
    } catch (e) {
      setSnackbar({
        open: true,
        message: e instanceof Error ? e.message : 'Failed to save',
        severity: 'error',
      });
    } finally {
      setSubmitting(false);
    }
  };

  const handleReset = async () => {
    setSubmitting(true);
    try {
      const res = await fetch('/api/settings/ai-model', { method: 'DELETE' });
      if (!res.ok) {
        const body = await res.json().catch(() => ({} as { error?: string }));
        throw new Error(body.error || `HTTP ${res.status}`);
      }
      setPending(null);
      await mutate();
      setSnackbar({ open: true, message: 'Using the workspace default model.', severity: 'success' });
    } catch (e) {
      setSnackbar({
        open: true,
        message: e instanceof Error ? e.message : 'Failed to reset',
        severity: 'error',
      });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <>
      <Stack spacing={2}>
        <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
          <Typography variant="body2" color="text.secondary">Current:</Typography>
          <Typography variant="body2" sx={{ fontFamily: 'monospace', overflowWrap: 'anywhere', minWidth: 0 }}>{data.modelId}</Typography>
          <Chip label={SOURCE_LABEL[data.source]} size="small" variant="outlined" />
        </Stack>

        <FormControl fullWidth size="small">
          <InputLabel id="ai-model-select-label" htmlFor="ai-model-select">AI model</InputLabel>
          <Select
            id="ai-model-select"
            labelId="ai-model-select-label"
            label="AI model"
            value={selected}
            disabled={submitting}
            renderValue={(value) => data.options.find(option => option.id === value)?.name ?? value}
            MenuProps={{ slotProps: { paper: { sx: { maxWidth: 'calc(100vw - 32px)' } } } }}
            onChange={(e) => setPending(e.target.value)}
          >
            {grouped.flatMap(([provider, models]) => [
              <ListSubheader key={`hdr-${provider}`} sx={{ fontWeight: 600, textTransform: 'capitalize' }}>
                {provider}
              </ListSubheader>,
              ...models.map(opt => (
                <MenuItem key={opt.id} value={opt.id}>
                  <Stack direction={{ xs: 'column', sm: 'row' }} alignItems="baseline" spacing={0.5} sx={{ width: '100%', minWidth: 0 }}>
                    <Typography variant="body2" sx={{ overflowWrap: 'anywhere', whiteSpace: 'normal' }}>{opt.name}</Typography>
                    <Typography variant="caption" color="text.secondary" sx={{ fontFamily: 'monospace', flex: 1, textAlign: { sm: 'right' }, overflowWrap: 'anywhere', whiteSpace: 'normal' }}>
                      {opt.id}
                    </Typography>
                  </Stack>
                </MenuItem>
              )),
            ])}
            {/* Surface the current modelId even if the gateway no longer
                lists it (e.g. set via env to something that's been
                deprecated) — otherwise the Select would clear visually. */}
            {!known && (
              <MenuItem value={selected}>
                <Typography variant="body2" sx={{ fontFamily: 'monospace' }}>{selected}</Typography>
                <Chip label="not in gateway list" size="small" variant="outlined" color="warning" sx={{ ml: 1 }} />
              </MenuItem>
            )}
          </Select>
        </FormControl>

        <Stack direction="row" gap={1} flexWrap="wrap">
          <Button
            variant="contained"
            size="small"
            onClick={handleSave}
            disabled={!dirty || submitting}
          >
            {submitting && dirty ? 'Saving…' : 'Save'}
          </Button>
          <Button
            variant="outlined"
            size="small"
            onClick={handleReset}
            disabled={data.source !== 'db' || submitting}
          >
            Use workspace default
          </Button>
        </Stack>

        <Typography variant="caption" color="text.secondary">
          Changes apply to your next adviser conversation and other AI features.
        </Typography>
      </Stack>

      <Snackbar
        open={snackbar.open}
        autoHideDuration={4000}
        onClose={() => setSnackbar((s) => ({ ...s, open: false }))}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      >
        <Alert
          onClose={() => setSnackbar((s) => ({ ...s, open: false }))}
          severity={snackbar.severity}
          variant="filled"
          sx={{ width: '100%' }}
        >
          {snackbar.message}
        </Alert>
      </Snackbar>
    </>
  );
}
