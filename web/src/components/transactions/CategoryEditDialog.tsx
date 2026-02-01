'use client';

import { useState, useEffect } from 'react';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  Autocomplete,
  TextField,
} from '@mui/material';

interface Category {
  id: number;
  name: string;
}

export default function CategoryEditDialog({
  open,
  currentCategoryId,
  categories,
  onClose,
  onSave,
}: {
  open: boolean;
  currentCategoryId: number | null;
  categories: Category[];
  onClose: () => void;
  onSave: (categoryId: number) => void;
}) {
  const [selected, setSelected] = useState<Category | null>(null);

  useEffect(() => {
    if (open && currentCategoryId) {
      const cat = categories.find(c => c.id === currentCategoryId);
      setSelected(cat ?? null);
    } else {
      setSelected(null);
    }
  }, [open, currentCategoryId, categories]);

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>Change Category</DialogTitle>
      <DialogContent>
        <Autocomplete
          sx={{ mt: 1 }}
          options={categories}
          getOptionLabel={(o) => o.name}
          value={selected}
          onChange={(_, val) => setSelected(val)}
          renderInput={(params) => <TextField {...params} label="Category" />}
        />
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
        <Button
          variant="contained"
          onClick={() => selected && onSave(selected.id)}
          disabled={!selected}
        >
          Save
        </Button>
      </DialogActions>
    </Dialog>
  );
}
