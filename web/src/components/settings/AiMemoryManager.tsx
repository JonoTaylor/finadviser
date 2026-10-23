'use client';

import { useRef, useState } from 'react';
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
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
} from '@mui/material';
import DeleteIcon from '@mui/icons-material/Delete';
import AddIcon from '@mui/icons-material/Add';
import EditOutlinedIcon from '@mui/icons-material/EditOutlined';
import { AI_MEMORY_MAX_CONTENT_LENGTH } from '@/lib/ai/memory-constants';
import { fetchJson } from '@/lib/http/client';

interface AiMemory {
  id: number;
  content: string;
  source: 'user' | 'ai';
  createdAt: string;
}

const fetcher = async (url: string): Promise<AiMemory[]> => {
  const data = await fetchJson<AiMemory[]>(url);
  if (!Array.isArray(data)) throw new Error('Saved adviser details could not be read. Please retry.');
  return data;
};

// Single source of truth shared with the API + repo so the client
// can't allow content the server will reject.
const MAX_LEN = AI_MEMORY_MAX_CONTENT_LENGTH;

/**
 * Manage the discrete facts the assistant remembers across
 * conversations. Memories show up in the agent's system prompt on
 * every turn, so the user can audit / prune what the AI "knows" here.
 */
export default function AiMemoryManager() {
  const { data, error, isLoading, mutate } = useSWR<AiMemory[]>('/api/ai/memories', fetcher);
  const [draft, setDraft] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState<AiMemory | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState('');
  const [editing, setEditing] = useState<AiMemory | null>(null);
  const [editContent, setEditContent] = useState('');
  const [editSaving, setEditSaving] = useState(false);
  const [editError, setEditError] = useState('');
  const [editConflict, setEditConflict] = useState(false);
  const [latestContent, setLatestContent] = useState<string | null>(null);
  const editPending = useRef(false);
  const [snack, setSnack] = useState<{ open: boolean; message: string; severity: 'success' | 'error' }>({
    open: false, message: '', severity: 'success',
  });

  const handleAdd = async () => {
    const content = draft.trim();
    if (!content || submitting) return;
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
    if (deleting) return;
    setDeleting(true);
    setDeleteError('');
    try {
      const res = await fetch(`/api/ai/memories/${m.id}`, { method: 'DELETE' });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }
      setDeleteConfirm(null);
      await mutate();
    } catch (e) {
      setDeleteError(e instanceof Error ? e.message : 'Deletion could not be confirmed. Please retry.');
    } finally {
      setDeleting(false);
    }
  };

  const handleEdit = async () => {
    if (!editing || editPending.current || editConflict || !editContent.trim()) return;
    editPending.current = true;
    setEditSaving(true);
    setEditError('');
    try {
      const response = await fetch(`/api/ai/memories/${editing.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: editContent, expectedContent: editing.content }),
      });
      if (!response.ok) {
        if (response.status === 409) setEditConflict(true);
        const body = await response.json().catch(() => null);
        throw new Error(body?.error || 'Your edit could not be saved.');
      }
      setEditing(null);
      await mutate();
      setSnack({ open: true, message: 'Adviser detail updated.', severity: 'success' });
    } catch (e) {
      setEditError(e instanceof Error ? e.message : 'Your edit could not be saved.');
    } finally {
      editPending.current = false;
      setEditSaving(false);
    }
  };

  const reviewLatestDetail = async () => {
    if (!editing || editPending.current) return;
    editPending.current = true;
    setEditSaving(true);
    try {
      const memories = await fetcher('/api/ai/memories');
      const latest = memories.find(memory => memory.id === editing.id);
      if (!latest) throw new Error('This memory was removed. Your draft is kept here; it has not been saved.');
      setEditing(latest);
      setLatestContent(latest.content);
      setEditConflict(false);
      setEditError('');
    } catch (error) {
      setEditError(error instanceof Error ? error.message : 'Saved details could not be loaded. Your draft is kept.');
    } finally {
      editPending.current = false;
      setEditSaving(false);
    }
  };

  const list = data ?? [];

  return (
    <>
      <Stack spacing={2}>
        <Typography variant="body2" color="text.secondary">
          Details saved by you or your adviser help personalise future conversations.
          Review or remove them whenever they change.
        </Typography>
        <Alert severity="info">
          You can ask the adviser to remember your salary, bonus and pension arrangement.
          Tax calculations use your saved profile for the selected owner and tax year;
          a remembered detail does not update a tax return automatically.
        </Alert>

        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} alignItems="flex-start">
          <TextField
            fullWidth
            size="small"
            label="Detail for your adviser"
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
        {error && <Alert severity="error" action={<Button color="inherit" size="small" onClick={() => mutate()}>Retry</Button>}>
          Adviser details could not be loaded. {error.message}
        </Alert>}

        {!isLoading && !error && list.length === 0 && (
          <Typography variant="body2" color="text.secondary">
            No saved details yet. Add something you want your adviser to remember.
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
                <Box flex={1} sx={{ minWidth: 0 }}>
                  <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{m.content}</Typography>
                  <Typography variant="caption" color="text.secondary">
                    {new Date(m.createdAt).toLocaleDateString('en-GB', { year: 'numeric', month: 'short', day: 'numeric' })}
                  </Typography>
                </Box>
                <IconButton size="small" disabled={deleting || editSaving} onClick={() => { setEditing(m); setEditContent(m.content); setEditError(''); setEditConflict(false); setLatestContent(null); }} aria-label="Edit memory">
                  <EditOutlinedIcon fontSize="small" />
                </IconButton>
                <IconButton size="small" disabled={deleting || editSaving} onClick={() => { setDeleteError(''); setDeleteConfirm(m); }} aria-label="Delete memory">
                  <DeleteIcon fontSize="small" />
                </IconButton>
              </Box>
            ))}
          </Stack>
        )}
      </Stack>

      <Dialog open={editing !== null} onClose={() => !editSaving && setEditing(null)} maxWidth="sm" fullWidth>
        <DialogTitle>Edit adviser detail</DialogTitle>
        <DialogContent>
          {editError && <Alert severity="error" sx={{ mb: 2 }}>{editError}</Alert>}
          {editConflict && <Button disabled={editSaving} onClick={reviewLatestDetail} sx={{ mb: 2 }}>Review latest saved detail</Button>}
          {latestContent !== null && <Alert severity="info" sx={{ mb: 2, overflowWrap: 'anywhere' }}>Latest saved detail: {latestContent}. Your edit remains below; review it before saving.</Alert>}
          <TextField autoFocus fullWidth multiline minRows={3} label="Saved detail" value={editContent}
            onChange={event => setEditContent(event.target.value)} disabled={editSaving}
            inputProps={{ maxLength: MAX_LEN }} sx={{ mt: 1 }} />
          <Typography variant="caption" color="text.secondary">Changing a memory does not replace the figures in a tax-year profile.</Typography>
        </DialogContent>
        <DialogActions>
          <Button disabled={editSaving} onClick={() => setEditing(null)}>Cancel</Button>
          <Button variant="contained" disabled={editSaving || editConflict || !editContent.trim() || editContent.trim() === editing?.content} onClick={handleEdit}>
            {editSaving ? 'Saving…' : 'Save detail'}
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog open={deleteConfirm !== null} onClose={() => !deleting && setDeleteConfirm(null)} maxWidth="sm" fullWidth>
        <DialogTitle>Remove adviser detail</DialogTitle>
        <DialogContent>
          {deleteError && <Alert severity="error" sx={{ mb: 2 }}>{deleteError}</Alert>}
          <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>This memory will be removed from future adviser context. Figures saved in a tax-year profile are managed separately.</Typography>
          <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{deleteConfirm?.content}</Typography>
        </DialogContent>
        <DialogActions>
          <Button disabled={deleting} onClick={() => setDeleteConfirm(null)}>Cancel</Button>
          <Button disabled={deleting} color="error" variant="contained" onClick={() => deleteConfirm && handleDelete(deleteConfirm)}>{deleting ? 'Removing…' : 'Remove detail'}</Button>
        </DialogActions>
      </Dialog>

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
