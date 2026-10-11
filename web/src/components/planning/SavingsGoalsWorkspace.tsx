'use client';

import { useRef, useState, type FormEvent } from 'react';
import useSWR from 'swr';
import Decimal from 'decimal.js';
import Link from 'next/link';
import {
  Alert, Box, Button, Card, CardContent, Chip, Dialog, DialogActions,
  DialogContent, DialogTitle, Divider, LinearProgress, MenuItem,
  Skeleton, Snackbar, Stack, Tab, Tabs, TextField, Typography,
} from '@mui/material';
import AddRoundedIcon from '@mui/icons-material/AddRounded';
import EditRoundedIcon from '@mui/icons-material/EditRounded';
import SavingsRoundedIcon from '@mui/icons-material/SavingsRounded';
import ArrowForwardRoundedIcon from '@mui/icons-material/ArrowForwardRounded';
import CheckRoundedIcon from '@mui/icons-material/CheckRounded';
import { alpha } from '@mui/material/styles';
import { fetchJson } from '@/lib/http/client';
import { londonTodayIso } from '@/lib/dates/today';
import { formatCurrency } from '@/lib/utils/formatting';
import { savingsGoalBodySchema, savingsGoalPatchSchema } from '@/lib/validation/financial-plans';
import { serifFamily, softTokens } from '@/theme/theme';

export interface SavingsGoal {
  id: number;
  name: string;
  targetAmount: string;
  currentAmount: string;
  targetDate: string | null;
  accountId: number | null;
  status: 'active' | 'completed' | 'cancelled';
}

interface GoalPlan {
  remaining: Decimal;
  progress: number;
  timing: 'reached' | 'inactive' | 'undated' | 'overdue' | 'today' | 'scheduled';
  contributions: number | null;
  monthlyContribution: Decimal | null;
}

/** Equal monthly contributions start today; short months use their final day. */
export function savingsGoalPlan(
  goal: Pick<SavingsGoal, 'targetAmount' | 'currentAmount' | 'targetDate' | 'status'>,
  asOf = londonTodayIso(),
): GoalPlan {
  const target = new Decimal(goal.targetAmount);
  const current = new Decimal(goal.currentAmount);
  const remaining = Decimal.max(0, target.minus(current));
  const progress = target.gt(0) ? Decimal.min(100, Decimal.max(0, current.div(target).times(100))).toNumber() : 0;
  const base = { remaining, progress, contributions: null, monthlyContribution: null };
  if (goal.status !== 'active') return { ...base, timing: 'inactive' };
  if (remaining.isZero()) return { ...base, timing: 'reached' };
  if (!goal.targetDate) return { ...base, timing: 'undated' };
  if (goal.targetDate < asOf) return { ...base, timing: 'overdue' };
  if (goal.targetDate === asOf) return { ...base, timing: 'today' };

  const [year, month, day] = asOf.split('-').map(Number);
  const [targetYear, targetMonth] = goal.targetDate.split('-').map(Number);
  let monthOffset = (targetYear - year) * 12 + targetMonth - month;
  const lastDay = new Date(Date.UTC(year, month - 1 + monthOffset + 1, 0)).getUTCDate();
  const lastContributionDate = new Date(Date.UTC(year, month - 1 + monthOffset, Math.min(day, lastDay))).toISOString().slice(0, 10);
  if (lastContributionDate > goal.targetDate) monthOffset -= 1;
  const contributions = Math.max(1, monthOffset + 1);
  return {
    remaining,
    progress,
    timing: 'scheduled',
    contributions,
    monthlyContribution: remaining.div(contributions).toDecimalPlaces(2, Decimal.ROUND_CEIL),
  };
}

function displayDate(iso: string): string {
  return new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${iso}T00:00:00Z`));
}

function ContributionSummary({ plan, compact = false }: { plan: GoalPlan; compact?: boolean }) {
  if (plan.timing === 'scheduled') return (
    <Box>
      <Typography variant="caption">Monthly planning amount</Typography>
      <Typography variant={compact ? 'h6' : 'h5'} sx={{ mt: 0.5, overflowWrap: 'anywhere' }}>{formatCurrency(plan.monthlyContribution!)}</Typography>
      <Typography variant="caption" sx={{ display: 'block', mt: 0.5 }}>{plan.contributions} equal {plan.contributions === 1 ? 'contribution' : 'contributions'}, starting now.</Typography>
    </Box>
  );
  if (plan.timing === 'today') return <Alert severity="warning">Due today: {formatCurrency(plan.remaining)} still to save. Choose a later date if you need more time.</Alert>;
  if (plan.timing === 'overdue') return <Alert severity="warning">Target date has passed. {formatCurrency(plan.remaining)} remains; update the date to make a new saving plan.</Alert>;
  if (plan.timing === 'reached') return <Alert severity="success" icon={<CheckRoundedIcon fontSize="inherit" />}>Target reached. Mark this goal completed when you are ready.</Alert>;
  if (plan.timing === 'undated') return <Typography variant="body2" color="text.secondary">Add a target date to calculate a monthly planning amount.</Typography>;
  return <Typography variant="body2" color="text.secondary">This goal is {plan.remaining.isZero() ? 'fully funded' : 'archived'}. Monthly planning is paused while it is inactive.</Typography>;
}

export default function SavingsGoalsWorkspace() {
  const { data, error, isLoading, mutate } = useSWR<SavingsGoal[]>('/api/savings-goals', fetchJson, { shouldRetryOnError: false });
  const [filter, setFilter] = useState<SavingsGoal['status'] | 'all'>('active');
  const [editor, setEditor] = useState<{ goal: SavingsGoal | null } | null>(null);
  const [success, setSuccess] = useState('');
  const today = londonTodayIso();
  const goals = data ?? [];
  const activeGoals = goals.filter(goal => goal.status === 'active');
  const visibleGoals = filter === 'all' ? goals : goals.filter(goal => goal.status === filter);
  const recorded = activeGoals.reduce((sum, goal) => sum.plus(goal.currentAmount), new Decimal(0));
  const remaining = activeGoals.reduce((sum, goal) => sum.plus(savingsGoalPlan(goal, today).remaining), new Decimal(0));
  const datedPlans = activeGoals.map(goal => savingsGoalPlan(goal, today)).filter(plan => plan.timing === 'scheduled');
  const monthly = datedPlans.reduce((sum, plan) => sum.plus(plan.monthlyContribution!), new Decimal(0));
  const unscheduled = activeGoals.filter(goal => ['undated', 'today', 'overdue'].includes(savingsGoalPlan(goal, today).timing));

  const handleSaved = async (saved: SavingsGoal, isNew: boolean) => {
    await mutate(existing => {
      const list = existing ?? [];
      return isNew ? [...list, saved] : list.map(goal => goal.id === saved.id ? saved : goal);
    }, { revalidate: false });
    setEditor(null);
    setSuccess(isNew ? 'Savings goal created.' : 'Savings goal updated.');
  };

  return (
    <Box sx={{ pt: { xs: 4, md: 0 } }}>
      <Stack direction={{ xs: 'column', sm: 'row' }} alignItems={{ xs: 'stretch', sm: 'center' }} justifyContent="space-between" gap={2} sx={{ mb: 3 }}>
        <Box>
          <Typography variant="overline" sx={{ color: softTokens.mint.ink, letterSpacing: '0.14em' }}>Give your money a purpose</Typography>
          <Typography variant="h4" component="h1">Savings goals</Typography>
          <Typography variant="body2" sx={{ mt: 1, maxWidth: 640 }}>Build your emergency fund, save for a home, or plan your next big purchase. Set the target, record what you have saved, and see the next step.</Typography>
        </Box>
        <Button variant="contained" startIcon={<AddRoundedIcon />} onClick={() => setEditor({ goal: null })} disabled={Boolean(error || isLoading)} sx={{ flexShrink: 0, alignSelf: { xs: 'flex-start', sm: 'center' } }}>Add savings goal</Button>
      </Stack>

      {isLoading ? <Skeleton variant="rounded" height={180} sx={{ mb: 3 }} /> : error ? (
        <Alert severity="warning" action={<Button size="small" onClick={() => void mutate()}>Retry</Button>} sx={{ mb: 3 }}>Savings goals could not be loaded. Your saved targets and balances are unavailable; retry when your connection is restored.</Alert>
      ) : (
        <Card sx={{ mb: 3, bgcolor: softTokens.cream }}>
          <CardContent>
            <Stack direction={{ xs: 'column', md: 'row' }} gap={{ xs: 2.5, md: 5 }}>
              <Box sx={{ flex: 1, minWidth: 0 }}><Typography variant="caption">Recorded across active goals</Typography><Typography variant="h3" sx={{ fontFamily: serifFamily, mt: 0.5, overflowWrap: 'anywhere' }}>{formatCurrency(recorded)}</Typography><Typography variant="caption">{activeGoals.length} active {activeGoals.length === 1 ? 'goal' : 'goals'}</Typography></Box>
              <Box sx={{ flex: 1, minWidth: 0 }}><Typography variant="caption">Still to save</Typography><Typography variant="h4" sx={{ mt: 1, overflowWrap: 'anywhere' }}>{formatCurrency(remaining)}</Typography><Typography variant="caption">Remaining across active targets</Typography></Box>
              <Box sx={{ flex: 1, minWidth: 0 }}><Typography variant="caption">Monthly plan for dated goals</Typography><Typography variant="h4" sx={{ mt: 1, overflowWrap: 'anywhere' }}>{datedPlans.length ? formatCurrency(monthly) : '—'}</Typography><Typography variant="caption">{datedPlans.length ? `${datedPlans.length} scheduled ${datedPlans.length === 1 ? 'goal' : 'goals'} · starting now` : 'No future dated goals to calculate'}{unscheduled.length > 0 ? ` · ${unscheduled.length} ${unscheduled.length === 1 ? 'goal needs' : 'goals need'} a date review` : ''}</Typography></Box>
            </Stack>
            <Divider sx={{ my: 2 }} />
            <Typography variant="caption">Recorded amounts are your own allocations, not automatic account balances or additional net worth. Allocate the same savings to one goal only. Monthly amounts are a plan, not money already saved.</Typography>
          </CardContent>
        </Card>
      )}

      {!error && !isLoading && (
        <>
          <Tabs value={filter} onChange={(_, value) => setFilter(value)} variant="scrollable" scrollButtons="auto" allowScrollButtonsMobile aria-label="Savings goal status" sx={{ mb: 3, minHeight: 42 }}>
            {(['active', 'completed', 'cancelled', 'all'] as const).map(status => <Tab key={status} value={status} label={`${status === 'all' ? 'All goals' : status[0].toUpperCase() + status.slice(1)} (${status === 'all' ? goals.length : goals.filter(goal => goal.status === status).length})`} sx={{ textTransform: 'none', minHeight: 42, px: 2 }} />)}
          </Tabs>
          {visibleGoals.length === 0 ? (
            <Card><CardContent sx={{ py: 5, textAlign: 'center' }}>
              <Box sx={{ bgcolor: softTokens.mint.main, color: softTokens.mint.ink, width: 64, height: 64, display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: 4, mx: 'auto', mb: 2 }}><SavingsRoundedIcon fontSize="large" /></Box>
              <Typography variant="h6">{goals.length === 0 ? 'What would you like to save for?' : `No ${filter} goals`}</Typography>
              <Typography variant="body2" sx={{ mt: 1, mb: 3, maxWidth: 500, mx: 'auto' }}>{goals.length === 0 ? 'Start with a safety cushion, a property deposit, or something you are looking forward to. A target makes your next contribution easier to plan.' : 'Choose another status to review saved goals, or create your next target.'}</Typography>
              <Button variant="contained" startIcon={<AddRoundedIcon />} onClick={() => setEditor({ goal: null })}>Create a savings goal</Button>
            </CardContent></Card>
          ) : (
            <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', lg: 'repeat(2, minmax(0, 1fr))' }, gap: 3 }}>
              {visibleGoals.map(goal => {
                const plan = savingsGoalPlan(goal, today);
                return (
                  <Card key={goal.id} component="article" aria-label={goal.name}>
                    <CardContent>
                      <Stack direction="row" justifyContent="space-between" alignItems="flex-start" gap={2} sx={{ mb: 2 }}>
                        <Box sx={{ minWidth: 0 }}><Typography variant="h6" component="h2" sx={{ overflowWrap: 'anywhere' }}>{goal.name}</Typography><Typography variant="caption">{goal.targetDate ? `Target: ${displayDate(goal.targetDate)}` : 'No target date'}</Typography></Box>
                        <Chip label={goal.status[0].toUpperCase() + goal.status.slice(1)} size="small" color={goal.status === 'completed' ? 'success' : goal.status === 'active' ? 'info' : 'default'} sx={{ flexShrink: 0 }} />
                      </Stack>
                      <Stack direction="row" justifyContent="space-between" gap={1} sx={{ mb: 1 }}><Typography variant="body2" sx={{ minWidth: 0, overflowWrap: 'anywhere' }}><Box component="span" sx={{ fontWeight: 700 }}>{formatCurrency(goal.currentAmount)}</Box> recorded</Typography><Typography variant="body2" sx={{ flexShrink: 0 }}>{Math.floor(plan.progress)}%</Typography></Stack>
                      <LinearProgress variant="determinate" value={plan.progress} aria-label={`${goal.name} saving progress`} sx={{ bgcolor: alpha(softTokens.mint.deep, 0.2), '& .MuiLinearProgress-bar': { bgcolor: softTokens.mint.ink } }} />
                      <Stack direction="row" justifyContent="space-between" gap={2} sx={{ mt: 1, mb: 3 }}><Typography variant="caption" sx={{ minWidth: 0, overflowWrap: 'anywhere' }}>Target {formatCurrency(goal.targetAmount)}</Typography><Typography variant="caption" sx={{ minWidth: 0, overflowWrap: 'anywhere' }}>{formatCurrency(plan.remaining)} remaining</Typography></Stack>
                      <Box sx={{ bgcolor: softTokens.cream, borderRadius: 3, p: 2, mb: 2 }}><ContributionSummary plan={plan} /></Box>
                      <Button variant="outlined" size="small" startIcon={<EditRoundedIcon />} onClick={() => setEditor({ goal })} aria-label={`Edit ${goal.name}`}>Edit goal &amp; progress</Button>
                    </CardContent>
                  </Card>
                );
              })}
            </Box>
          )}
          <Stack direction={{ xs: 'column', sm: 'row' }} justifyContent="space-between" alignItems={{ xs: 'flex-start', sm: 'center' }} gap={2} sx={{ mt: 3 }}>
            <Typography variant="caption" sx={{ maxWidth: 650 }}>Equal contributions start today and repeat on the same calendar day each month; short months use their last day. Rounded up to the nearest penny. Interest and investment returns are excluded. Dates use the UK calendar.</Typography>
            <Button component={Link} href="/plan" endIcon={<ArrowForwardRoundedIcon />} sx={{ flexShrink: 0 }}>Review my financial plan</Button>
          </Stack>
        </>
      )}

      {editor && <GoalEditor key={editor.goal?.id ?? 'new'} goal={editor.goal} today={today} onClose={() => setEditor(null)} onSaved={handleSaved} />}
      <Snackbar open={Boolean(success)} autoHideDuration={5000} onClose={() => setSuccess('')}><Alert severity="success" onClose={() => setSuccess('')}>{success}</Alert></Snackbar>
    </Box>
  );
}

function GoalEditor({ goal, today, onClose, onSaved }: {
  goal: SavingsGoal | null;
  today: string;
  onClose: () => void;
  onSaved: (saved: SavingsGoal, isNew: boolean) => Promise<void>;
}) {
  const [form, setForm] = useState({ name: goal?.name ?? '', targetAmount: goal?.targetAmount ?? '', currentAmount: goal?.currentAmount ?? '0', targetDate: goal?.targetDate ?? '', status: goal?.status ?? 'active' });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saveError, setSaveError] = useState('');
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);
  const previewBody = savingsGoalBodySchema.safeParse({ name: form.name || 'Goal', targetAmount: form.targetAmount, currentAmount: form.currentAmount, targetDate: form.targetDate || null });
  const preview = previewBody.success ? savingsGoalPlan({ ...previewBody.data, currentAmount: previewBody.data.currentAmount ?? '0', targetDate: previewBody.data.targetDate ?? null, status: form.status }, today) : null;

  const change = (field: keyof typeof form, value: string) => {
    setForm(current => ({ ...current, [field]: value }));
    setErrors(current => ({ ...current, [field]: '' }));
    setSaveError('');
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (savingRef.current) return;
    const body = { name: form.name, targetAmount: form.targetAmount, currentAmount: form.currentAmount, targetDate: form.targetDate || null, accountId: goal?.accountId ?? null };
    const parsed = goal ? savingsGoalPatchSchema.safeParse({ ...body, id: goal.id, status: form.status }) : savingsGoalBodySchema.safeParse(body);
    if (!parsed.success) {
      setErrors(Object.fromEntries(parsed.error.issues.map(issue => [String(issue.path[0]), issue.message])));
      return;
    }
    savingRef.current = true;
    setSaving(true);
    setSaveError('');
    try {
      const saved = await fetchJson<SavingsGoal>('/api/savings-goals', { method: goal ? 'PATCH' : 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(parsed.data) });
      await onSaved(saved, !goal);
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : 'Your savings goal could not be saved. Please try again.');
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  };

  return (
    <Dialog open fullWidth maxWidth="sm" onClose={() => { if (!savingRef.current) onClose(); }} disableEscapeKeyDown={saving} aria-labelledby="goal-editor-title">
      <Box component="form" onSubmit={submit} noValidate>
        <DialogTitle id="goal-editor-title">{goal ? 'Edit savings goal' : 'Create a savings goal'}</DialogTitle>
        <DialogContent>
          <Stack spacing={2.5} sx={{ pt: 1 }}>
            {saveError && <Alert severity="error">{saveError} Your entries are still here; review them and retry.</Alert>}
            <TextField label="Goal name" required autoFocus fullWidth value={form.name} onChange={event => change('name', event.target.value)} disabled={saving} error={Boolean(errors.name)} helperText={errors.name} slotProps={{ htmlInput: { maxLength: 160 } }} />
            <Stack direction={{ xs: 'column', sm: 'row' }} gap={2}>
              <TextField label="Target amount (£)" required fullWidth value={form.targetAmount} onChange={event => change('targetAmount', event.target.value)} disabled={saving} error={Boolean(errors.targetAmount)} helperText={errors.targetAmount || 'The total you want to save.'} slotProps={{ htmlInput: { inputMode: 'decimal' } }} />
              <TextField label="Already saved (£)" required fullWidth value={form.currentAmount} onChange={event => change('currentAmount', event.target.value)} disabled={saving} error={Boolean(errors.currentAmount)} helperText={errors.currentAmount || 'Your recorded allocation to this goal.'} slotProps={{ htmlInput: { inputMode: 'decimal' } }} />
            </Stack>
            <TextField label="Target date (optional)" type="date" fullWidth value={form.targetDate} onChange={event => change('targetDate', event.target.value)} disabled={saving} error={Boolean(errors.targetDate)} helperText={errors.targetDate || 'Leave empty if you have not set a deadline.'} slotProps={{ inputLabel: { shrink: true } }} />
            {goal && <TextField select label="Goal status" value={form.status} onChange={event => change('status', event.target.value)} fullWidth disabled={saving} helperText="Completed and cancelled goals stay available in your history."><MenuItem value="active">Active</MenuItem><MenuItem value="completed">Completed</MenuItem><MenuItem value="cancelled">Cancelled</MenuItem></TextField>}
            {preview && <Box sx={{ bgcolor: softTokens.cream, p: 2, borderRadius: 3 }}><Typography variant="caption" sx={{ display: 'block', mb: 1 }}>Your plan preview</Typography><ContributionSummary plan={preview} compact /></Box>}
            <Typography variant="caption">Saving a goal records your target and progress. It does not move money or change your account balance.</Typography>
          </Stack>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 3 }}><Button onClick={onClose} disabled={saving}>Cancel</Button><Button type="submit" variant="contained" disabled={saving}>{saving ? 'Saving…' : goal ? 'Save changes' : 'Create goal'}</Button></DialogActions>
      </Box>
    </Dialog>
  );
}
