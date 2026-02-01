'use client';

import { useState } from 'react';
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
  onSave: (categoryId: number, createRule: boolean) => void;
}) {
  const [selected, setSelected] = useState<Category | null>(null);
  const [createRule, setCreateRule] = useState(true);

  const handleEnter = () => {
    const cat = currentCategoryId ? categories.find(c => c.id === currentCategoryId) ?? null : null;
    setSelected(cat);
    setCreateRule(true);
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      maxWidth="sm"
      fullWidth
      TransitionProps={{ onEnter: handleEnter }}
    >
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
        {description && (
          <FormControlLabel
            sx={{ mt: 1 }}
            control={
              <Checkbox
                checked={createRule}
                onChange={(e) => setCreateRule(e.target.checked)}
                size="small"
              />
            }
            label="Create rule for future transactions"
          />
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
        <Button
          variant="contained"
          onClick={() => selected && onSave(selected.id, createRule)}
          disabled={!selected}
        >
          Save
        </Button>
      </DialogActions>
    </Dialog>
  );
}
