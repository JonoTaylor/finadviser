'use client';

import { useRef, useState } from 'react';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  Autocomplete,
  TextField,
  FormControlLabel,
  Checkbox,
  Alert,
  Typography,
} from '@mui/material';

interface Category {
  id: number;
  name: string;
}

export default function CategoryEditDialog({
  open,
  currentCategoryId,
  description,
  categories,
  onClose,
  onSave,
}: {
  open: boolean;
  currentCategoryId: number | null;
  description?: string;
  categories: Category[];
  onClose: () => void;
  onSave: (categoryId: number, createRule: boolean) => Promise<void>;
}) {
  const [selected, setSelected] = useState<Category | null>(null);
  const [createRule, setCreateRule] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const writing = useRef(false);

  const handleEnter = () => {
    const cat = currentCategoryId ? categories.find(c => c.id === currentCategoryId) ?? null : null;
    setSelected(cat);
    setCreateRule(true);
    setError('');
  };

  const save = async () => {
    if (!selected || writing.current) return;
    writing.current = true;
    setSaving(true);
    setError('');
    try { await onSave(selected.id, createRule); }
    catch (caught) { setError(caught instanceof Error ? caught.message : 'The category could not be saved.'); }
    finally { writing.current = false; setSaving(false); }
  };

  return (
    <Dialog
      open={open}
      onClose={() => { if (!writing.current) onClose(); }}
      disableEscapeKeyDown={saving}
      maxWidth="sm"
      fullWidth
      TransitionProps={{ onEnter: handleEnter }}
    >
      <DialogTitle>Change category</DialogTitle>
      <DialogContent>
        {description && <Typography variant="body2" sx={{ mb: 2, overflowWrap: 'anywhere' }}>{description}</Typography>}
        {error && <Alert severity="error" sx={{ mb: 2 }}>{error} Your selection is still here.</Alert>}
        <Autocomplete
          sx={{ mt: 1 }}
          options={categories}
          disabled={saving}
          isOptionEqualToValue={(option, value) => option.id === value.id}
          getOptionLabel={(o) => o.name}
          value={selected}
          onChange={(_, val) => setSelected(val)}
          renderInput={(params) => <TextField {...params} label="Category" />}
        />
        {description && (
          <FormControlLabel
            sx={{ mt: 1 }}
            control={
              <Checkbox
                checked={createRule}
                onChange={(e) => setCreateRule(e.target.checked)}
                size="small"
                disabled={saving}
              />
            }
            label="Create rule for future transactions"
          />
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={saving}>Cancel</Button>
        <Button
          variant="contained"
          onClick={() => void save()}
          disabled={!selected || saving}
        >
          {saving ? 'Saving…' : 'Save category'}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
