'use client';

import { useState } from 'react';
import useSWR from 'swr';
import {
  Box,
  Stack,
  Typography,
  TextField,
  Button,
  IconButton,
  Chip,
  Alert,
  Snackbar,
  CircularProgress,
  Tooltip,
} from '@mui/material';
import DeleteIcon from '@mui/icons-material/Delete';
import AddIcon from '@mui/icons-material/Add';

interface AiMemory {
  id: number;
  content: string;
  source: 'user' | 'ai';
  createdAt: string;
}

const fetcher = async (url: string): Promise<AiMemory[]> => {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
};

const MAX_LEN = 4000;

/**
 * Manage the discrete facts the assistant remembers across
 * conversations. Memories show up in the agent's system prompt on
 * every turn, so the user can audit / prune what the AI "knows" here.
 */
export default function AiMemoryManager() {
  const { data, error, isLoading, mutate } = useSWR<AiMemory[]>('/api/ai/memories', fetcher);
  const [draft, setDraft] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [snack, setSnack] = useState<{ open: boolean; message: string; severity: 'success' | 'error' }>({
    open: false, message: '', severity: 'success',
  });

  const handleAdd = async () => {
    const content = draft.trim();
    if (!content) return;
    setSubmitting(true);
    try {
      const res = await fetch('/api/ai/memories', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }
      setDraft('');
      await mutate();
      setSnack({ open: true, message: 'Memory added.', severity: 'success' });
    } catch (e) {
      setSnack({ open: true, message: e instanceof Error ? e.message : 'Failed to add', severity: 'error' });
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async (m: AiMemory) => {
    if (!confirm(`Delete this memory?\n\n"${m.content}"`)) return;
    try {
      const res = await fetch(`/api/ai/memories/${m.id}`, { method: 'DELETE' });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }
      await mutate();
    } catch (e) {
      setSnack({ open: true, message: e instanceof Error ? e.message : 'Failed to delete', severity: 'error' });
    }
  };

  const list = data ?? [];

  return (
    <>
      <Stack spacing={2}>
        <Typography variant="body2" color="text.secondary">
          Persistent facts the AI remembers across conversations. These are injected into the
          system prompt on every chat turn. The AI can also save new memories itself with the
          <code> remember</code> tool when it learns something durable about you.
        </Typography>

        <Stack direction="row" spacing={1} alignItems="flex-start">
          <TextField
            fullWidth
            size="small"
            placeholder='e.g. "Mortgage payment goes out on the 28th from Monzo"'
            value={draft}
            onChange={e => setDraft(e.target.value)}
            multiline
            minRows={1}
            maxRows={3}
            inputProps={{ maxLength: MAX_LEN }}
            disabled={submitting}
          />
          <Button
            variant="contained"
            startIcon={<AddIcon />}
            onClick={handleAdd}
            disabled={!draft.trim() || submitting}
          >
            Add
          </Button>
        </Stack>

        {isLoading && (
          <Stack direction="row" spacing={1.5} alignItems="center">
            <CircularProgress size={16} />
            <Typography variant="body2" color="text.secondary">Loading memories…</Typography>
          </Stack>
        )}
        {error && <Alert severity="error">{error.message ?? 'Failed to load memories'}</Alert>}

        {!isLoading && !error && list.length === 0 && (
          <Typography variant="body2" color="text.secondary">
            No memories yet. The AI will start saving things it learns as it works with you.
          </Typography>
        )}

        {list.length > 0 && (
          <Stack spacing={1}>
            {list.map(m => (
              <Box
                key={m.id}
                sx={{
                  display: 'flex', alignItems: 'flex-start', gap: 1.5,
                  p: 1.25, borderRadius: 2, bgcolor: 'rgba(255,255,255,0.03)',
                  border: '1px solid', borderColor: 'divider',
                }}
              >
                <Tooltip title={m.source === 'ai' ? 'Saved by the AI' : 'Added by you'}>
                  <Chip
                    size="small"
                    label={m.source}
                    variant="outlined"
                    color={m.source === 'ai' ? 'secondary' : 'primary'}
                    sx={{ height: 22, fontSize: '0.7rem', textTransform: 'uppercase' }}
                  />
                </Tooltip>
                <Box flex={1}>
                  <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap' }}>{m.content}</Typography>
                  <Typography variant="caption" color="text.secondary">
                    {new Date(m.createdAt).toLocaleDateString('en-GB', { year: 'numeric', month: 'short', day: 'numeric' })}
                  </Typography>
                </Box>
                <IconButton size="small" onClick={() => handleDelete(m)} aria-label="Delete memory">
                  <DeleteIcon fontSize="small" />
                </IconButton>
              </Box>
            ))}
          </Stack>
        )}
      </Stack>

      <Snackbar
        open={snack.open}
        autoHideDuration={4000}
        onClose={() => setSnack(s => ({ ...s, open: false }))}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      >
        <Alert
          onClose={() => setSnack(s => ({ ...s, open: false }))}
          severity={snack.severity}
          variant="filled"
          sx={{ width: '100%' }}
        >
          {snack.message}
        </Alert>
      </Snackbar>
    </>
  );
}
