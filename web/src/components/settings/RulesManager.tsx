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
} from '@mui/material';
import { alpha } from '@mui/material/styles';
import EditRoundedIcon from '@mui/icons-material/EditRounded';
import DeleteRoundedIcon from '@mui/icons-material/DeleteRounded';
import AddRoundedIcon from '@mui/icons-material/AddRounded';
import RuleRoundedIcon from '@mui/icons-material/RuleRounded';
import useSWR from 'swr';

const fetcher = (url: string) => fetch(url).then(r => r.json());

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
  const { data: rules, mutate } = useSWR<Rule[]>('/api/categories/rules', fetcher);
  const { data: categories } = useSWR<Category[]>('/api/categories', fetcher);

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingRule, setEditingRule] = useState<Rule | null>(null);
  const [formData, setFormData] = useState<RuleFormData>({
    pattern: '',
    matchType: 'contains',
    categoryId: null,
    priority: 0,
  });
  const [deleteConfirm, setDeleteConfirm] = useState<number | null>(null);

  const openAddDialog = () => {
    setEditingRule(null);
    setFormData({ pattern: '', matchType: 'contains', categoryId: null, priority: 0 });
    setDialogOpen(true);
  };

  const openEditDialog = (rule: Rule) => {
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
    if (!formData.pattern || !formData.categoryId) return;

    if (editingRule) {
      await fetch(`/api/categories/rules?id=${editingRule.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          pattern: formData.pattern,
          matchType: formData.matchType,
          categoryId: formData.categoryId,
          priority: formData.priority,
        }),
      });
    } else {
      await fetch('/api/categories/rules', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          pattern: formData.pattern,
          matchType: formData.matchType,
          categoryId: formData.categoryId,
          priority: formData.priority,
          source: 'user',
        }),
      });
    }
    setDialogOpen(false);
    mutate();
  };

  const handleDelete = async (id: number) => {
    await fetch(`/api/categories/rules?id=${id}`, { method: 'DELETE' });
    setDeleteConfirm(null);
    mutate();
  };

  const selectedCategory = categories?.find(c => c.id === formData.categoryId) ?? null;

  return (
    <>
      <Card>
        <CardContent>
          <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 2 }}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
              <Box
                sx={{
                  width: 36, height: 36, borderRadius: 2.5,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  bgcolor: alpha('#F97316', 0.12),
                }}
              >
                <RuleRoundedIcon sx={{ fontSize: 20, color: '#F97316' }} />
              </Box>
              <Typography variant="h6">Categorization Rules</Typography>
              {rules && (
                <Chip label={rules.length} size="small" variant="outlined" />
              )}
            </Box>
            <Button size="small" startIcon={<AddRoundedIcon />} onClick={openAddDialog}>
              Add Rule
            </Button>
          </Box>

          {rules && rules.length > 0 ? (
            <TableContainer>
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
                        <IconButton size="small" onClick={() => openEditDialog(rule)}>
                          <EditRoundedIcon fontSize="small" />
                        </IconButton>
                        <IconButton size="small" color="error" onClick={() => setDeleteConfirm(rule.id)}>
                          <DeleteRoundedIcon fontSize="small" />
                        </IconButton>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableContainer>
          ) : (
            <Typography variant="body2" color="text.secondary">
              No categorization rules yet. Rules are created automatically when you categorize transactions or use auto-categorize.
            </Typography>
          )}
        </CardContent>
      </Card>

      {/* Add/Edit Dialog */}
      <Dialog open={dialogOpen} onClose={() => setDialogOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>{editingRule ? 'Edit Rule' : 'Add Rule'}</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ mt: 1 }}>
            <TextField
              label="Pattern"
              value={formData.pattern}
              onChange={(e) => setFormData(prev => ({ ...prev, pattern: e.target.value }))}
              fullWidth
            />
            <TextField
              select
              label="Match Type"
              value={formData.matchType}
              onChange={(e) => setFormData(prev => ({ ...prev, matchType: e.target.value }))}
              fullWidth
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
            />
            <TextField
              label="Priority"
              type="number"
              value={formData.priority}
              onChange={(e) => setFormData(prev => ({ ...prev, priority: parseInt(e.target.value) || 0 }))}
              fullWidth
            />
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDialogOpen(false)}>Cancel</Button>
          <Button
            variant="contained"
            onClick={handleSave}
            disabled={!formData.pattern || !formData.categoryId}
          >
            {editingRule ? 'Update' : 'Create'}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Delete Confirmation */}
      <Dialog open={deleteConfirm !== null} onClose={() => setDeleteConfirm(null)}>
        <DialogTitle>Delete Rule</DialogTitle>
        <DialogContent>
          <Typography>Are you sure you want to delete this rule?</Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDeleteConfirm(null)}>Cancel</Button>
          <Button color="error" variant="contained" onClick={() => deleteConfirm && handleDelete(deleteConfirm)}>
            Delete
          </Button>
        </DialogActions>
      </Dialog>
    </>
  );
}
