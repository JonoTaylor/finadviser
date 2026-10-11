'use client';

import { useState } from 'react';
import {
  Card,
  CardContent,
  Typography,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  IconButton,
  Button,
  Chip,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  TextField,
  Autocomplete,
  MenuItem,
  Stack,
  Box,
  Tooltip,
  Alert,
  CircularProgress,
} from '@mui/material';
import EditRoundedIcon from '@mui/icons-material/EditRounded';
import DeleteRoundedIcon from '@mui/icons-material/DeleteRounded';
import { softTokens } from '@/theme/theme';
import AddRoundedIcon from '@mui/icons-material/AddRounded';
import RuleRoundedIcon from '@mui/icons-material/RuleRounded';
import useSWR from 'swr';
import { fetchJson } from '@/lib/http/client';

const fetcher = async <T,>(url: string): Promise<T[]> => {
  const data = await fetchJson<T[]>(url);
  if (!Array.isArray(data)) throw new Error('The saved list could not be read. Please retry.');
  return data;
};

interface Rule {
  id: number;
  pattern: string;
  match_type: string;
  category_id: number;
  priority: number;
  source: string;
  category_name: string | null;
}

interface Category {
  id: number;
  name: string;
}

const MATCH_TYPES = [
  { value: 'contains', label: 'Contains' },
  { value: 'startswith', label: 'Starts with' },
  { value: 'exact', label: 'Exact' },
  { value: 'regex', label: 'Regex' },
];

const SOURCE_COLORS: Record<string, 'info' | 'secondary' | 'default'> = {
  user: 'info',
  ai: 'secondary',
  system: 'default',
};

interface RuleFormData {
  pattern: string;
  matchType: string;
  categoryId: number | null;
  priority: number;
}

export default function RulesManager() {
  const { data: rules, error: rulesError, isLoading: rulesLoading, mutate } = useSWR<Rule[]>('/api/categories/rules', fetcher<Rule>);
  const { data: categories, error: categoriesError, isLoading: categoriesLoading, mutate: reloadCategories } = useSWR<Category[]>('/api/categories', fetcher<Category>);

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingRule, setEditingRule] = useState<Rule | null>(null);
  const [formData, setFormData] = useState<RuleFormData>({
    pattern: '',
    matchType: 'contains',
    categoryId: null,
    priority: 0,
  });
  const [deleteConfirm, setDeleteConfirm] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');

  const openAddDialog = () => {
    setSaveError('');
    setEditingRule(null);
    setFormData({ pattern: '', matchType: 'contains', categoryId: null, priority: 0 });
    setDialogOpen(true);
  };

  const openEditDialog = (rule: Rule) => {
    setSaveError('');
    setEditingRule(rule);
    setFormData({
      pattern: rule.pattern,
      matchType: rule.match_type,
      categoryId: rule.category_id,
      priority: rule.priority,
    });
    setDialogOpen(true);
  };

  const handleSave = async () => {
    if (!formData.pattern.trim() || !formData.categoryId || saving) return;
    setSaving(true);
    setSaveError('');
    try {
      await fetchJson(editingRule ? `/api/categories/rules?id=${editingRule.id}` : '/api/categories/rules', {
        method: editingRule ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          pattern: formData.pattern, matchType: formData.matchType,
          categoryId: formData.categoryId, priority: formData.priority,
          ...(!editingRule ? { source: 'user' } : {}),
        }),
      });
      setDialogOpen(false);
      await mutate();
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : 'The rule could not be saved. Your entries are still here.');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: number) => {
    if (saving) return;
    setSaving(true);
    setSaveError('');
    try {
      await fetchJson(`/api/categories/rules?id=${id}`, { method: 'DELETE' });
      setDeleteConfirm(null);
      await mutate();
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : 'The rule could not be deleted. Please retry.');
    } finally {
      setSaving(false);
    }
  };

  const selectedCategory = categories?.find(c => c.id === formData.categoryId) ?? null;

  return (
    <>
      <Card>
        <CardContent>
          <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 1.5, flexWrap: 'wrap', mb: 2 }}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
              <Box
                sx={{
                  width: 36, height: 36, borderRadius: 2.5,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  bgcolor: softTokens.lemon.main,
                  color: softTokens.lemon.ink,
                }}
              >
                <RuleRoundedIcon sx={{ fontSize: 20 }} />
              </Box>
              <Typography variant="h6">Categorisation rules</Typography>
              {rules && (
                <Chip label={rules.length} size="small" variant="outlined" />
              )}
            </Box>
            <Button size="small" variant="outlined" startIcon={<AddRoundedIcon />} onClick={openAddDialog} disabled={saving || rulesLoading || categoriesLoading || !!rulesError || !!categoriesError || !categories}>
              Add rule
            </Button>
          </Box>

          {rulesError && <Alert severity="error" sx={{ mb: 1.5 }} action={<Button color="inherit" size="small" onClick={() => mutate()}>Retry</Button>}>
            Rules could not be loaded. {rulesError.message}
          </Alert>}
          {categoriesError && <Alert severity="error" sx={{ mb: 1.5 }} action={<Button color="inherit" size="small" onClick={() => reloadCategories()}>Retry</Button>}>
            Categories could not be loaded. {categoriesError.message}
          </Alert>}
          {rulesLoading && <Stack direction="row" spacing={1.25} alignItems="center"><CircularProgress size={16} /><Typography variant="body2" color="text.secondary">Loading rules…</Typography></Stack>}
          {rules && rules.length > 0 ? (
            <TableContainer sx={{ overflowX: 'auto' }}>
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell>Pattern</TableCell>
                    <TableCell>Match Type</TableCell>
                    <TableCell>Category</TableCell>
                    <TableCell>Priority</TableCell>
                    <TableCell>Source</TableCell>
                    <TableCell align="right">Actions</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {rules.map((rule) => (
                    <TableRow key={rule.id}>
                      <TableCell sx={{ maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        <Tooltip title={rule.pattern}>
                          <span>{rule.pattern}</span>
                        </Tooltip>
                      </TableCell>
                      <TableCell>{rule.match_type}</TableCell>
                      <TableCell>{rule.category_name ?? '—'}</TableCell>
                      <TableCell>{rule.priority}</TableCell>
                      <TableCell>
                        <Chip
                          label={rule.source}
                          size="small"
                          color={SOURCE_COLORS[rule.source] ?? 'default'}
                          variant="outlined"
                        />
                      </TableCell>
                      <TableCell align="right">
                        <IconButton size="small" onClick={() => openEditDialog(rule)} aria-label={`Edit rule ${rule.pattern}`} disabled={saving || !!categoriesError || !categories}>
                          <EditRoundedIcon fontSize="small" />
                        </IconButton>
                        <IconButton size="small" color="error" aria-label={`Delete rule ${rule.pattern}`} disabled={saving} onClick={() => { setSaveError(''); setDeleteConfirm(rule.id); }}>
                          <DeleteRoundedIcon fontSize="small" />
                        </IconButton>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableContainer>
          ) : !rulesLoading && !rulesError && rules ? (
            <Typography variant="body2" color="text.secondary">
              No rules yet. Add a rule to categorise matching transactions consistently.
            </Typography>
          ) : null}
        </CardContent>
      </Card>

      {/* Add/Edit Dialog */}
      <Dialog open={dialogOpen} onClose={() => !saving && setDialogOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>{editingRule ? 'Edit rule' : 'Add rule'}</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ mt: 1 }}>
            {saveError && <Alert severity="error">{saveError} Your entries have been kept.</Alert>}
            {categoriesError && <Alert severity="error" action={<Button color="inherit" size="small" onClick={() => reloadCategories()}>Retry</Button>}>Categories are unavailable. Your entries are still here.</Alert>}
            <TextField
              label="Pattern"
              value={formData.pattern}
              onChange={(e) => setFormData(prev => ({ ...prev, pattern: e.target.value }))}
              fullWidth
              disabled={saving}
            />
            <TextField
              select
              label="Match Type"
              value={formData.matchType}
              onChange={(e) => setFormData(prev => ({ ...prev, matchType: e.target.value }))}
              fullWidth
              disabled={saving}
            >
              {MATCH_TYPES.map((mt) => (
                <MenuItem key={mt.value} value={mt.value}>{mt.label}</MenuItem>
              ))}
            </TextField>
            <Autocomplete
              options={categories ?? []}
              getOptionLabel={(o) => o.name}
              value={selectedCategory}
              onChange={(_, val) => setFormData(prev => ({ ...prev, categoryId: val?.id ?? null }))}
              renderInput={(params) => <TextField {...params} label="Category" />}
              disabled={saving || !!categoriesError}
            />
            <TextField
              label="Priority"
              type="number"
              value={formData.priority}
              onChange={(e) => setFormData(prev => ({ ...prev, priority: parseInt(e.target.value) || 0 }))}
              fullWidth
              disabled={saving}
            />
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDialogOpen(false)} disabled={saving}>Cancel</Button>
          <Button
            variant="contained"
            onClick={handleSave}
            disabled={saving || !formData.pattern.trim() || !formData.categoryId || !!categoriesError}
          >
            {saving ? 'Saving…' : editingRule ? 'Update rule' : 'Create rule'}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Delete Confirmation */}
      <Dialog open={deleteConfirm !== null} onClose={() => !saving && setDeleteConfirm(null)}>
        <DialogTitle>Delete rule</DialogTitle>
        <DialogContent>
          {saveError && <Alert severity="error" sx={{ mb: 2 }}>{saveError} Deletion could not be confirmed.</Alert>}
          <Typography>Are you sure you want to delete this rule?</Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDeleteConfirm(null)} disabled={saving}>Cancel</Button>
          <Button color="error" variant="contained" disabled={saving} onClick={() => deleteConfirm && handleDelete(deleteConfirm)}>
            {saving ? 'Deleting…' : 'Delete rule'}
          </Button>
        </DialogActions>
      </Dialog>
    </>
  );
}
