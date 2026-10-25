'use client';

import { useMemo, useRef, useState } from 'react';
import { buildCategoryLabels } from '@/components/data/categoryLabels';
import RememberPayeeDialog from '@/components/data/RememberPayeeDialog';
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
  MenuItem,
} from '@mui/material';

interface Category {
  id: number;
  name: string;
  parentId?: number | null;
}

interface PropertyOption { id: number; name: string }

/** "Property expenses" and every category below it, at any depth. */
export function propertyExpenseCategoryIds(categories: Category[]): Set<number> {
  const ids = new Set(categories.filter(c => c.name === 'Property expenses' && c.parentId == null).map(c => c.id));
  let grew = ids.size > 0;
  while (grew) {
    grew = false;
    for (const category of categories) {
      if (category.parentId != null && ids.has(category.parentId) && !ids.has(category.id)) { ids.add(category.id); grew = true; }
    }
  }
  return ids;
}

export default function CategoryEditDialog({
  open,
  currentCategoryId,
  description,
  categories,
  onClose,
  onSave,
  journalId,
  onRemembered,
  properties = [],
  propertiesUnavailable = false,
  currentPropertyId = null,
}: {
  open: boolean;
  currentCategoryId: number | null;
  description?: string;
  categories: Category[];
  onClose: () => void;
  /** `propertyId` is undefined when the property link is not being changed. */
  onSave: (categoryId: number, createRule: boolean, propertyId?: number | null) => Promise<void>;
  journalId?: number;
  onRemembered?: () => void | Promise<void>;
  properties?: PropertyOption[];
  propertiesUnavailable?: boolean;
  currentPropertyId?: number | null;
}) {
  const [selected, setSelected] = useState<Category | null>(null);
  const [createRule, setCreateRule] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [rememberPayeeOpen, setRememberPayeeOpen] = useState(false);
  const writing = useRef(false);
  const categoryLabels = useMemo(() => buildCategoryLabels(categories), [categories]);
  const propertyExpenseIds = useMemo(() => propertyExpenseCategoryIds(categories), [categories]);
  // null until the user picks; '' means "not linked to a property".
  const [propertyPick, setPropertyPick] = useState<number | '' | null>(null);
  const isPropertyExpense = selected !== null && propertyExpenseIds.has(selected.id);
  // Offered for property expenses, and for anything already linked (such as
  // rent) so a link is never changed or dropped without the user choosing.
  const showProperty = properties.length > 0 && (isPropertyExpense || currentPropertyId !== null);
  const suggestedProperty: number | '' = currentPropertyId ?? (isPropertyExpense && properties.length === 1 ? properties[0].id : '');
  const propertyChoice = propertyPick ?? suggestedProperty;

  const handleEnter = () => {
    const cat = currentCategoryId ? categories.find(c => c.id === currentCategoryId) ?? null : null;
    setSelected(cat);
    setCreateRule(false);
    setPropertyPick(null);
    setError('');
  };

  const save = async () => {
    if (!selected || writing.current) return;
    writing.current = true;
    setSaving(true);
    setError('');
    try { await onSave(selected.id, createRule, showProperty ? (propertyChoice === '' ? null : propertyChoice) : undefined); }
    catch (caught) { setError(caught instanceof Error ? caught.message : 'The category could not be saved.'); }
    finally { writing.current = false; setSaving(false); }
  };

  return (
    <><Dialog
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
          getOptionLabel={(o) => categoryLabels.get(o.id) ?? o.name}
          value={selected}
          onChange={(_, val) => setSelected(val)}
          renderInput={(params) => <TextField {...params} label="Category" />}
        />
        {showProperty && (
          <TextField
            select
            fullWidth
            sx={{ mt: 2 }}
            label="Property"
            value={propertyChoice}
            disabled={saving}
            onChange={event => setPropertyPick(event.target.value === '' ? '' : Number(event.target.value))}
            // Show "Not linked" rather than a blank field when nothing is chosen.
            slotProps={{ select: { displayEmpty: true }, inputLabel: { shrink: true } }}
            helperText="A linked transaction appears in that property's expenses and tax-year report. A category alone does not make a cost tax-deductible."
          >
            <MenuItem value="">Not linked to a property</MenuItem>
            {properties.map(property => <MenuItem key={property.id} value={property.id}>{property.name}</MenuItem>)}
          </TextField>
        )}
        {isPropertyExpense && propertiesUnavailable && (
          <Alert severity="warning" sx={{ mt: 2 }}>Your properties could not be loaded, so this transaction cannot be linked to one right now. The category can still be saved.</Alert>
        )}
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
            label="Reuse this category for the same exact payment context"
          />
        )}
        {description && <Typography variant="caption" component="p" sx={{ mt: 0.5 }}>This needs an exact description and the same account context. Leave it off for a one-off choice.</Typography>}
        {journalId && <>
          <Button variant="outlined" sx={{ mt: 2 }} disabled={saving || !selected} onClick={() => setRememberPayeeOpen(true)}>Remember this payee</Button>
          <Typography variant="caption" component="p" sx={{ mt: 0.75 }}>For a person or recurring service, save who they are and what the payment means. Confirmed bank payee names can handle changing references.</Typography>
        </>}
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
    </Dialog><RememberPayeeDialog open={rememberPayeeOpen && open} journalId={journalId ?? null} categoryId={selected?.id ?? null} categoryLabel={selected ? categoryLabels.get(selected.id) ?? selected.name : 'Choose a category'} onClose={() => setRememberPayeeOpen(false)} onSaved={async () => { try { await onRemembered?.(); } finally { setRememberPayeeOpen(false); onClose(); } }} /></>
  );
}
