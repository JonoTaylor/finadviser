'use client';

import { useState } from 'react';
import Link from 'next/link';
import useSWR from 'swr';
import Decimal from 'decimal.js';
import {
  Accordion, AccordionDetails, AccordionSummary, Alert, Box, Button, Card,
  CardContent, Chip, Divider, Grid, LinearProgress, MenuItem, Skeleton, Slider,
  Stack, Tab, Table, TableBody, TableCell, TableContainer, TableHead, TableRow,
  Tabs, TextField, Typography,
} from '@mui/material';
import ArrowForwardRoundedIcon from '@mui/icons-material/ArrowForwardRounded';
import ExpandMoreRoundedIcon from '@mui/icons-material/ExpandMoreRounded';
import RefreshRoundedIcon from '@mui/icons-material/RefreshRounded';
import { BarChart } from '@mui/x-charts/BarChart';
import { fetchJson } from '@/lib/http/client';
import { buildFinancialPlan } from '@/lib/planning/engine';
import { examplePlanningInput } from '@/lib/planning/example';
import type { FinancialPlan, PlanningProfile, SpendingComparison } from '@/lib/planning/types';
import { formatCurrency } from '@/lib/utils/formatting';
import { softTokens } from '@/theme/theme';
import PageHeader from '@/components/ui/PageHeader';
import MetricCard from '@/components/ui/MetricCard';

type Section = 'overview' | 'spending' | 'wealth' | 'property';
interface OverviewResponse {
  status: 'ready';
  plan: FinancialPlan;
  profile: PlanningProfile;
  profileSaved: boolean;
  source: { scope: string; asOf: string; latestTransactionDate: string | null; warnings: string[] };
}

const money = (value: number | null) => value === null ? 'Not enough data' : formatCurrency(value);
const percent = (value: number | null) => value === null ? 'Not enough data' : `${value.toFixed(1)}%`;
const shortMoney = (value: number) => new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP', notation: 'compact', maximumFractionDigits: 1 }).format(value);

export default function FinancialPlanView({ initialSection = 'overview' }: { initialSection?: Section }) {
  const { data, error, isLoading, mutate } = useSWR<OverviewResponse>('/api/planning/overview', fetchJson, { shouldRetryOnError: false });
  const [section, setSection] = useState<Section>(initialSection);
  const [example, setExample] = useState(false);
  const [exampleInput, setExampleInput] = useState(() => examplePlanningInput());
  const plan = example ? buildFinancialPlan(exampleInput) : data?.plan;
  const profile = example ? exampleInput.profile ?? {} : data?.profile ?? {};

  return (
    <Box sx={{ maxWidth: 1440, mx: 'auto', '& .MuiTableCell-root': { fontVariantNumeric: 'tabular-nums' } }}>
      <PageHeader
        title={initialSection === 'spending' ? 'Spending analysis' : 'Financial plan'}
        description="Your household cash flow, wealth and priorities, based on recorded financial data."
        actions={<>
          <Button variant="outlined" component={Link} href="/review">Review actions</Button>
          <Button variant="contained" component={Link} href="/chat" endIcon={<ArrowForwardRoundedIcon />}>Ask adviser</Button>
        </>}
      />

      {example && <Alert severity="info" sx={{ mb: 2 }} action={<Button color="inherit" onClick={() => setExample(false)}>Use my data</Button>}><strong>Example household.</strong> These are fictional figures to explore the tools. They are never added to your accounts.</Alert>}
      {!example && error && <Alert severity="warning" sx={{ mb: 2 }} action={<Button color="inherit" onClick={() => void mutate()} startIcon={<RefreshRoundedIcon />}>Retry</Button>}>Your financial data is unavailable. Personal figures and recommendations will appear when your accounts can be loaded.</Alert>}

      {!plan && !isLoading && !example && <Card sx={{ mb: 3 }}><CardContent sx={{ p: { xs: 3, md: 5 } }}>
        <Typography variant="h5">Connect your financial data</Typography>
        <Typography sx={{ mt: 1, mb: 3, maxWidth: 750 }} color="text.secondary">Import your bank statements or connect your accounts, then add your investment balances and property valuations. We’ll show missing information clearly rather than treating it as zero.</Typography>
        <Stack direction="row" gap={1} flexWrap="wrap">
          <Button component={Link} href="/import" variant="contained">Import statements</Button>
          <Button component={Link} href="/settings/connections" variant="outlined">Connect accounts</Button>
          <Button onClick={() => setExample(true)}>Explore an example</Button>
        </Stack>
        <Divider sx={{ my: 3 }} />
        <Typography variant="body2">You can use the retirement planner now with your own assumptions, even before connecting your accounts.</Typography>
      </CardContent></Card>}

      {!plan && isLoading && <Grid container spacing={2}>{[1, 2, 3, 4].map(n => <Grid key={n} size={{ xs: 12, sm: 6, lg: 3 }}><Skeleton variant="rounded" height={140} /></Grid>)}</Grid>}

      {plan && <>
        <Stack direction="row" gap={1} flexWrap="wrap" alignItems="center" sx={{ mb: 2 }}>
          <Chip size="small" label={example ? 'Example household' : 'Whole household · GBP'} color={example ? 'info' : 'default'} />
          <Chip size="small" variant="outlined" label={`${plan.coverage.recentMonthsWithData}/3 recent months recorded`} />
          <Typography variant="caption">As of {plan.asOf} · trends use completed months</Typography>
        </Stack>
        {(plan.coverage.warnings.length > 0 || (!example && data?.source.warnings.length)) && <Accordion sx={{ mb: 2, boxShadow: 'none', border: 1, borderColor: 'divider', borderRadius: '8px', bgcolor: 'background.paper', '&:before': { display: 'none' } }}>
          <AccordionSummary expandIcon={<ExpandMoreRoundedIcon />}><Typography variant="body2" fontWeight={600}>Data coverage and assumptions</Typography></AccordionSummary>
          <AccordionDetails><Stack spacing={1}>{[...new Set([...plan.coverage.warnings, ...(!example ? data?.source.warnings ?? [] : [])])].map(w => <Typography variant="body2" key={w}>{w}</Typography>)}</Stack></AccordionDetails>
        </Accordion>}
        <Grid container spacing={2} sx={{ mb: 3 }}>
          <Grid size={{ xs: 12, sm: 6, lg: 3 }}><Metric label="Monthly cash surplus" value={money(plan.cashflow.monthlySurplus)} detail="Last 3 completed months · average" /></Grid>
          <Grid size={{ xs: 12, sm: 6, lg: 3 }}><Metric label="Monthly spending" value={money(plan.cashflow.monthlySpending)} detail="Net of refunds · transfers excluded" /></Grid>
          <Grid size={{ xs: 12, sm: 6, lg: 3 }}><Metric label="Recorded net worth" value={money(plan.balanceSheet.netWorth)} detail={plan.balanceSheet.missingPropertyValuations ? `${plan.balanceSheet.missingPropertyValuations} property valuations missing` : 'Known assets less recorded debts · household'} /></Grid>
          <Grid size={{ xs: 12, sm: 6, lg: 3 }}><Metric label={plan.emergencyFund.isEstimate ? "Estimated emergency coverage" : "Emergency coverage"} value={plan.emergencyFund.coverageMonths === null ? 'Add essential costs' : `${plan.emergencyFund.coverageMonths.toFixed(1)} months`} detail={plan.emergencyFund.isEstimate ? "Cash estimate; confirm accessibility in My context" : "Using your confirmed cash-access settings"} /></Grid>
        </Grid>

        <Tabs value={section} onChange={(_event, value: Section) => setSection(value)} variant="scrollable" scrollButtons="auto" aria-label="Financial planning sections" sx={{ mb: 3, borderBottom: 1, borderColor: 'divider' }}>
          <Tab value="overview" label="Priorities" id="plan-tab-overview" aria-controls="plan-panel-overview" />
          <Tab value="spending" label="Spending" id="plan-tab-spending" aria-controls="plan-panel-spending" />
          <Tab value="wealth" label="Wealth" id="plan-tab-wealth" aria-controls="plan-panel-wealth" />
          <Tab value="property" label="Property" id="plan-tab-property" aria-controls="plan-panel-property" />
        </Tabs>
        <Box role="tabpanel" id={`plan-panel-${section}`} aria-labelledby={`plan-tab-${section}`}>
          {section === 'overview' && <Grid container spacing={3}>
            <Grid size={{ xs: 12, lg: 8 }}>
              <SectionIntro title="Recommended priorities" description="Actions are ranked from your recorded figures and missing information. Review the evidence before deciding." />
              <Stack spacing={2}>{plan.actions.map((action, index) => <Card key={action.id}><CardContent>
                <Stack direction={{ xs: 'column', sm: 'row' }} justifyContent="space-between" gap={1} alignItems="flex-start">
                  <Stack direction="row" spacing={1.5} alignItems="flex-start"><Box sx={{ width: 28, height: 28, borderRadius: '6px', bgcolor: softTokens.cream, color: 'text.secondary', display: 'grid', placeItems: 'center', fontSize: 12, fontWeight: 700, flexShrink: 0 }}>{index + 1}</Box><Box><Typography variant="caption" sx={{ textTransform: 'capitalize' }}>{action.topic}</Typography><Typography variant="h6">{action.title}</Typography></Box></Stack>
                  <Chip size="small" label={`${action.priority} priority`} color={action.priority === 'high' ? 'warning' : 'default'} />
                </Stack>
                <Typography variant="body2" sx={{ mt: 1.5 }}>{action.detail}</Typography>
                <Box sx={{ mt: 2, pl: 1.5, borderLeft: 2, borderColor: 'divider' }}><Typography variant="caption" sx={{ display: 'block', fontWeight: 600, mb: 0.5 }}>Evidence</Typography><Typography variant="body2">{action.evidence}</Typography></Box>
                <Stack direction="row" gap={1} alignItems="center" flexWrap="wrap" sx={{ mt: 2 }}>
                  <Button component={Link} href={example && action.href.startsWith('/properties/') ? '/properties' : action.href} variant="outlined" size="small">{action.actionLabel}</Button>
                  {action.references.map(ref => <Button key={ref.url} component="a" href={ref.url} target="_blank" rel="noopener noreferrer" size="small">{ref.label} ↗</Button>)}
                </Stack>
              </CardContent></Card>)}</Stack>
            </Grid>
            <Grid size={{ xs: 12, lg: 4 }}><ProfileForm key={JSON.stringify(profile)} profile={profile} example={example} onExampleChange={next => setExampleInput(old => ({ ...old, profile: next }))} onSaved={() => void mutate()} /><ReserveCard plan={plan} /></Grid>
          </Grid>}
          {section === 'spending' && <SpendingSection plan={plan} example={example} onRefresh={() => void mutate()} />}
          {section === 'wealth' && <WealthSection plan={plan} />}
          {section === 'property' && <PropertySection plan={plan} example={example} />}
        </Box>
        <Accordion sx={{ mt: 4, boxShadow: 'none' }}>
          <AccordionSummary expandIcon={<ExpandMoreRoundedIcon />}><Typography variant="body2">How your plan is calculated</Typography></AccordionSummary>
          <AccordionDetails><Stack spacing={1}>{plan.methodology.map(line => <Typography key={line} variant="body2">{line}</Typography>)}<Typography variant="body2">This plan provides information and scenarios. Investment suitability, tax treatment and pension access depend on your circumstances; links provide further reading rather than a verified current tax ruling.</Typography></Stack></AccordionDetails>
        </Accordion>
      </>}
    </Box>
  );
}

function Metric({ label, value, detail }: { label: string; value: string; detail: string }) {
  return <MetricCard label={label} value={value} detail={detail} />;
}

function SectionIntro({ title, description }: { title: string; description: string }) {
  return <Box sx={{ mb: 2.5 }}><Typography variant="h6">{title}</Typography><Typography variant="body2" sx={{ mt: 0.75, maxWidth: 880 }}>{description}</Typography></Box>;
}

function ProfileForm({ profile, example, onExampleChange, onSaved }: { profile: PlanningProfile; example: boolean; onExampleChange: (next: PlanningProfile) => void; onSaved: () => void }) {
  const [essential, setEssential] = useState(String(profile.essentialMonthlySpending ?? ''));
  const [months, setMonths] = useState(String(profile.emergencyFundMonths ?? 3));
  const [savings, setSavings] = useState(String(profile.monthlySavingsTarget ?? ''));
  const [horizon, setHorizon] = useState(String(profile.investmentHorizonYears ?? ''));
  const [risk, setRisk] = useState<NonNullable<PlanningProfile['riskTolerance']> | ''>(profile.riskTolerance ?? '');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ text: string; error: boolean } | null>(null);
  const value = (s: string) => s.trim() === '' ? null : Number(s);
  const save = async () => {
    const next = { essentialMonthlySpending: value(essential), emergencyFundMonths: value(months), monthlySavingsTarget: value(savings), investmentHorizonYears: value(horizon), riskTolerance: risk || null };
    if ([next.essentialMonthlySpending, next.monthlySavingsTarget, next.investmentHorizonYears].some(v => v !== null && (!Number.isFinite(v) || v < 0)) || next.emergencyFundMonths === null || !Number.isInteger(next.emergencyFundMonths) || next.emergencyFundMonths < 1 || next.emergencyFundMonths > 24 || (next.investmentHorizonYears !== null && next.investmentHorizonYears > 80)) {
      setMessage({ text: 'Enter non-negative amounts, an investment horizon of 0–80 years, and 1–24 months for your cash reserve.', error: true }); return;
    }
    if (example) { onExampleChange({ ...profile, ...next }); return; }
    setBusy(true); setMessage(null);
    try {
      const existing = await fetchJson<{ profile: Record<string, unknown> }>('/api/planning/profile');
      await fetchJson('/api/planning/profile', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...existing.profile, ...next }) });
      setMessage({ text: 'Your planning preferences are saved.', error: false }); onSaved();
    } catch (e) { setMessage({ text: e instanceof Error ? e.message : 'Your preferences could not be saved.', error: true }); }
    finally { setBusy(false); }
  };
  return <Card sx={{ mb: 3 }}><CardContent><Typography variant="h6">Planning preferences</Typography><Typography variant="body2" sx={{ mt: 0.75, mb: 2.5 }}>Set your costs, targets and investment preferences. Blank inputs stay unknown.</Typography>
    <Stack spacing={2}>
      <TextField disabled={busy} label="Essential monthly costs (£)" type="number" value={essential} onChange={e => setEssential(e.target.value)} helperText="Housing, food, bills and minimum debt payments" slotProps={{ htmlInput: { min: 0, step: '0.01' } }} />
      <TextField disabled={busy} label="Cash reserve target (months)" type="number" value={months} onChange={e => setMonths(e.target.value)} helperText="A planning choice; adjust for job and household risk" slotProps={{ htmlInput: { min: 1, max: 24, step: 1 } }} />
      <TextField disabled={busy} label="Monthly savings goal (£)" type="number" value={savings} onChange={e => setSavings(e.target.value)} slotProps={{ htmlInput: { min: 0, step: '0.01' } }} />
      <TextField disabled={busy} label="Investment horizon (years)" type="number" value={horizon} onChange={e => setHorizon(e.target.value)} slotProps={{ htmlInput: { min: 0, max: 80, step: 1 } }} />
      <TextField disabled={busy} select label="Comfort with investment risk" value={risk} onChange={e => setRisk(e.target.value as typeof risk)} helperText="A preference, not a suitability assessment"><MenuItem value="">Not recorded</MenuItem><MenuItem value="low">Low</MenuItem><MenuItem value="medium">Medium</MenuItem><MenuItem value="high">High</MenuItem></TextField>
      {message && <Alert severity={message.error ? 'error' : 'success'}>{message.text}</Alert>}
      <Button variant="contained" onClick={() => void save()} disabled={busy}>{busy ? 'Saving…' : example ? 'Apply example assumptions' : 'Save my preferences'}</Button>
    </Stack>
  </CardContent></Card>;
}

function ReserveCard({ plan }: { plan: FinancialPlan }) {
  const reserve = plan.emergencyFund;
  const progress = reserve.targetAmount && reserve.cashAvailable !== null ? Math.max(0, Math.min(100, reserve.cashAvailable / reserve.targetAmount * 100)) : 0;
  return <Card><CardContent><Typography variant="h6">Emergency reserve</Typography><Typography sx={{ fontWeight: 650, fontVariantNumeric: 'tabular-nums', letterSpacing: '-0.03em', fontSize: '1.8rem', my: 1 }}>{money(reserve.cashAvailable)}</Typography><Typography variant="body2">{reserve.isEstimate ? "Estimated accessible cash" : "Recorded cash with confirmed accessibility"}</Typography><LinearProgress variant="determinate" value={progress} aria-label="Emergency fund target progress" sx={{ height: 8, borderRadius: '4px', my: 2 }} /><Typography variant="body2">{reserve.targetAmount === null ? 'Add your essential costs to estimate a reserve target.' : `${money(reserve.targetAmount)} target · ${reserve.targetMonths} months of essential costs`}</Typography>{reserve.shortfall !== null && reserve.shortfall > 0 && <Typography variant="body2" sx={{ mt: 1 }}>{money(reserve.shortfall)} to reach your chosen target</Typography>}<Typography variant="caption" sx={{ display: 'block', mt: 2 }}>{reserve.basis}</Typography></CardContent></Card>;
}

function SpendingSection({ plan, example, onRefresh }: { plan: FinancialPlan; example: boolean; onRefresh: () => void }) {
  const [search, setSearch] = useState('');
  const [mode, setMode] = useState<'categories' | 'merchants'>('categories');
  const [categoryName, setCategoryName] = useState('');
  const [reduction, setReduction] = useState(15);
  const [budgetBusy, setBudgetBusy] = useState(false);
  const [budgetMessage, setBudgetMessage] = useState<{ text: string; error: boolean } | null>(null);
  const rows = plan.spending[mode].filter(row => row.name.toLowerCase().includes(search.toLowerCase()));
  const choices = plan.spending.categories.filter(row => row.monthlyAverage !== null && row.monthlyAverage > 0 && row.propertyTotal === 0);
  const categoryKey = (row: SpendingComparison) => row.categoryId === undefined ? row.name : String(row.categoryId);
  const chosen = choices.find(row => categoryKey(row) === categoryName) ?? choices[0];
  const potential = chosen?.monthlyAverage === null || chosen?.monthlyAverage === undefined ? null : new Decimal(chosen.monthlyAverage).mul(reduction).div(100).toDecimalPlaces(2).toNumber();
  const proposedBudget = chosen?.monthlyAverage != null && potential !== null ? new Decimal(chosen.monthlyAverage).minus(potential).toDecimalPlaces(2).toNumber() : null;
  const createBudget = async () => {
    if (!chosen || proposedBudget === null || example) return;
    setBudgetBusy(true); setBudgetMessage(null);
    try {
      const categories = await fetchJson<Array<{ id: number; name: string }>>('/api/categories');
      const matches = categories.filter(c => chosen.categoryId === undefined ? c.name === chosen.name : c.id === chosen.categoryId);
      if (matches.length !== 1) throw new Error('This category needs review before a budget can be saved: its name is missing or shared by more than one category.');
      const category = matches[0];
      await fetchJson('/api/budgets', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ categoryId: category.id, monthlyLimit: proposedBudget.toFixed(2), effectiveFrom: plan.asOf }) });
      setBudgetMessage({ text: `Budget saved: ${chosen.name}, ${money(proposedBudget)} per month.`, error: false }); onRefresh();
    } catch (e) { setBudgetMessage({ text: e instanceof Error ? e.message : 'Could not save this budget.', error: true }); }
    finally { setBudgetBusy(false); }
  };
  return <Stack spacing={3}>
    <SectionIntro title="Spending trends" description="Compare the last three completed months with the previous three. Refunds reduce spending; transfers between your accounts stay out of the totals." />
    <Grid container spacing={3}>
      <Grid size={{ xs: 12, lg: 8 }}><Card><CardContent><Typography variant="h6">Income and spending over time</Typography><Typography variant="caption">Blank months mean no imported activity, not zero spending.</Typography><BarChart height={260} xAxis={[{ scaleType: 'band', data: plan.cashflow.months.map(m => m.month) }]} yAxis={[{ valueFormatter: shortMoney }]} series={[{ label: 'Income', color: softTokens.mint.ink, data: plan.cashflow.months.map(m => m.totals?.income ?? null), valueFormatter: v => v === null ? 'Not recorded' : money(v) }, { label: 'Spending', color: softTokens.lavender.deep, data: plan.cashflow.months.map(m => m.totals?.spending ?? null), valueFormatter: v => v === null ? 'Not recorded' : money(v) }]} /></CardContent></Card></Grid>
      <Grid size={{ xs: 12, lg: 4 }}><Card sx={{ height: '100%' }}><CardContent><Typography variant="h6">Cash flow summary</Typography><Stack spacing={1.5} sx={{ mt: 2 }}><DataRow label="Monthly income" value={money(plan.cashflow.monthlyIncome)} /><DataRow label="Personal spending" value={money(plan.cashflow.monthlyPersonalSpending)} /><DataRow label="Property costs" value={money(plan.cashflow.monthlyPropertySpending)} /><Divider /><DataRow label="Cash surplus rate" value={percent(plan.cashflow.savingsRate)} /><DataRow label="Spending change" value={money(plan.cashflow.monthlySpendingChange)} /></Stack><Typography variant="caption" sx={{ display: 'block', mt: 2 }}>This is recorded income less recorded expenses. Recorded mortgage principal is included. Investment deposits and saving transfers are excluded; missing outgoings can reduce what is actually available to save.</Typography></CardContent></Card></Grid>
    </Grid>
    <Card><CardContent><Stack direction={{ xs: 'column', sm: 'row' }} justifyContent="space-between" gap={2}><Tabs value={mode} onChange={(_e, v: typeof mode) => setMode(v)} aria-label="Spending breakdown"><Tab value="categories" label="By category" /><Tab value="merchants" label="By merchant" /></Tabs><TextField label="Search spending" value={search} onChange={e => setSearch(e.target.value)} /></Stack>
      <TableContainer sx={{ mt: 2 }}><Table size="small" aria-label="Spending comparison" sx={{ minWidth: 650 }}><TableHead><TableRow><TableCell>{mode === 'categories' ? 'Category' : 'Merchant'}</TableCell><TableCell align="right">Monthly average</TableCell><TableCell align="right">Previous average</TableCell><TableCell align="right">Change</TableCell><TableCell align="right">Recorded share</TableCell></TableRow></TableHead><TableBody>{rows.slice(0, 30).map(row => <SpendingRow key={row.categoryId ?? row.name} row={row} />)}{rows.length === 0 && <TableRow><TableCell colSpan={5}>No recorded spending matches this view.</TableCell></TableRow>}</TableBody></Table></TableContainer>
    </CardContent></Card>
    <Grid container spacing={3}>
      <Grid size={{ xs: 12, md: 6 }}><Card sx={{ height: '100%' }}><CardContent><Typography variant="h6">Model a spending reduction</Typography><Typography variant="body2" sx={{ mt: 1, mb: 2 }}>Choose a personal-spending category and model a reduction. These are scenarios, not guaranteed savings.</Typography>{choices.length === 0 ? <Typography variant="body2">Import activity across three completed months to build a meaningful monthly savings scenario.</Typography> : <><TextField select fullWidth label="Spending to review" value={chosen ? categoryKey(chosen) : ''} onChange={e => { setCategoryName(e.target.value); setBudgetMessage(null); }}>{choices.map(c => <MenuItem key={categoryKey(c)} value={categoryKey(c)}>{c.name}</MenuItem>)}</TextField><Typography variant="body2" sx={{ mt: 3 }} id="reduction-label">Reduce this category by {reduction}%</Typography><Slider aria-labelledby="reduction-label" value={reduction} onChange={(_e, v) => { setReduction(v as number); setBudgetMessage(null); }} step={5} min={0} max={50} marks={[{ value: 0, label: '0%' }, { value: 25, label: '25%' }, { value: 50, label: '50%' }]} valueLabelDisplay="auto" /><Typography sx={{ fontWeight: 650, fontVariantNumeric: 'tabular-nums', letterSpacing: '-0.03em', fontSize: '1.8rem', mt: 2 }}>{money(potential)} / month</Typography><Typography variant="body2">{potential === null ? '' : `${money(new Decimal(potential).mul(12).toNumber())} annualised, if you sustain the change`}</Typography><Typography variant="caption" sx={{ display: 'block', mt: 1 }}>Proposed monthly budget: {money(proposedBudget)}. Keep essential commitments and realistic habits in mind.</Typography>{budgetMessage && <Alert severity={budgetMessage.error ? 'error' : 'success'} sx={{ mt: 2 }}>{budgetMessage.text}</Alert>}<Button sx={{ mt: 2 }} variant="contained" disabled={example || budgetBusy || reduction === 0} onClick={() => void createBudget()}>{budgetBusy ? 'Saving…' : example ? 'Example budget — not saved' : 'Set this monthly budget'}</Button><Typography variant="caption" sx={{ display: 'block', mt: 1 }}>Saving updates this category’s existing budget, if it has one.</Typography></> }</CardContent></Card></Grid>
      <Grid size={{ xs: 12, md: 6 }}><Card sx={{ height: '100%' }}><CardContent><Typography variant="h6">Regular payments worth reviewing</Typography><Typography variant="body2" sx={{ mt: 1, mb: 2 }}>Similar payments at monthly intervals can reveal commitments. Confirm what each payment is before deciding to cancel or switch.</Typography><Stack spacing={2}>{plan.recurring.slice(0, 8).map(item => <Box key={item.merchant}><Stack direction="row" justifyContent="space-between" gap={1}><Typography variant="body2" fontWeight={600}>{item.merchant}</Typography><Typography variant="body2">{money(item.typicalPayment)}</Typography></Stack><Typography variant="caption">{item.evidence}</Typography><Divider sx={{ mt: 1 }} /></Box>)}</Stack>{plan.recurring.length === 0 && <Typography variant="body2">No convincing monthly pattern found in the recorded history.</Typography>}<Button component={Link} href="/transactions" sx={{ mt: 2 }} variant="outlined">Review transactions</Button></CardContent></Card></Grid>
    </Grid>
    {plan.budgets.length > 0 && <Card><CardContent><Typography variant="h6" sx={{ mb: 2 }}>Budget performance</Typography><Grid container spacing={2}>{plan.budgets.map(b => <Grid size={{ xs: 12, sm: 6, md: 4 }} key={b.categoryId ?? b.category}><Typography variant="body2" fontWeight={600}>{b.category}</Typography><Typography variant="caption">{money(b.observedMonthlySpending)} of {money(b.monthlyLimit)} monthly</Typography><LinearProgress aria-label={`${b.category} budget usage`} variant="determinate" value={Math.max(0, Math.min(100, b.utilisationPercent ?? 0))} color={b.status === 'over-budget' ? 'warning' : 'success'} sx={{ my: 1, height: 7, borderRadius: '4px' }} /><Typography variant="caption">{b.status === 'unknown' ? 'More history needed' : b.status === 'over-budget' ? `${money(b.remaining === null ? null : -b.remaining)} over budget` : `${money(b.remaining)} remaining`}</Typography></Grid>)}</Grid></CardContent></Card>}
  </Stack>;
}

function SpendingRow({ row }: { row: SpendingComparison }) {
  return <TableRow sx={{ '& td:not(:first-of-type)': { whiteSpace: 'nowrap' } }}><TableCell><Typography variant="body2" fontWeight={500}>{row.name}</Typography><Typography variant="caption">{row.transactionCount} entries{row.propertyTotal > 0 ? ' · includes property costs' : ''}</Typography></TableCell><TableCell align="right">{money(row.monthlyAverage)}</TableCell><TableCell align="right">{money(row.previousMonthlyAverage)}</TableCell><TableCell align="right" sx={{ color: row.monthlyChange !== null && row.monthlyChange > 0 ? softTokens.peach.ink : 'text.primary' }}>{row.monthlyChange !== null && row.monthlyChange > 0 ? '+' : ''}{money(row.monthlyChange)}</TableCell><TableCell align="right">{percent(row.sharePercent)}</TableCell></TableRow>;
}

function DataRow({ label, value }: { label: string; value: string }) {
  return <Stack direction="row" justifyContent="space-between" gap={2}><Typography variant="body2">{label}</Typography><Typography variant="body2" fontWeight={600} textAlign="right" sx={{ fontVariantNumeric: 'tabular-nums' }}>{value}</Typography></Stack>;
}

function WealthSection({ plan }: { plan: FinancialPlan }) {
  const b = plan.balanceSheet;
  return <Stack spacing={3}><SectionIntro title="Balance sheet" description="Your balance sheet shows what is liquid, what is invested, and what is tied up in property or retirement. Account types alone cannot tell us whether your holdings are diversified." /><Grid container spacing={3}><Grid size={{ xs: 12, md: 6 }}><Card sx={{ height: '100%' }}><CardContent><Typography variant="h6" sx={{ mb: 2 }}>Asset and debt breakdown</Typography><Stack spacing={1.5}><DataRow label="Accessible cash" value={money(b.cash)} /><DataRow label="Investments outside pensions" value={money(b.investments)} /><DataRow label="Pensions" value={money(b.pensions)} /><DataRow label="Property equity" value={money(b.propertyEquity)} /><DataRow label="Other debts" value={money(b.otherDebt)} /><Divider /><DataRow label="Recorded household net worth" value={money(b.netWorth)} /></Stack><Typography variant="caption" sx={{ mt: 2, display: 'block' }}>{b.propertySharePercent === null ? 'Property concentration cannot be calculated without asset values.' : `${percent(b.propertySharePercent)} of recorded gross assets are in property. Property valuations do not create spendable cash.`}</Typography>{b.unclassifiedAssets > 0 && <Alert severity="info" sx={{ mt: 2 }}>{b.unclassifiedAssets} asset accounts need classification before cash reserves can be assessed fully.</Alert>}<Button component={Link} href="/investments" variant="outlined" sx={{ mt: 2 }}>Review investment balances</Button></CardContent></Card></Grid><Grid size={{ xs: 12, md: 6 }}><ReserveCard plan={plan} /></Grid></Grid>
    <Grid container spacing={3}>{[
      { title: 'Cash and investment horizons', text: 'Keep near-term commitments and your reserve in accessible cash. For longer-term goals, compare investment risk, access restrictions, fees and your ability to tolerate losses before choosing an account or investment.', href: 'https://www.fca.org.uk/investsmart', label: 'FCA investing guidance' },
      { title: 'Investment allocation', text: 'An ISA or pension describes tax treatment, not the underlying investments. Review funds, asset mix, concentration and total fees. A collection of accounts is not evidence of diversification.', href: '/investments', label: 'Manage investment accounts' },
      { title: 'Retirement planning', text: 'Compare contributions, employer payments, charges and inflation. Model different returns, and check your own State Pension forecast instead of assuming the full amount.', href: '/pensions', label: 'Model my retirement' },
    ].map(item => <Grid size={{ xs: 12, md: 4 }} key={item.title}><Card sx={{ height: '100%' }}><CardContent><Typography variant="h6">{item.title}</Typography><Typography variant="body2" sx={{ my: 2 }}>{item.text}</Typography>{item.href.startsWith('http') ? <Button component="a" href={item.href} target="_blank" rel="noopener noreferrer">{item.label} ↗</Button> : <Button component={Link} href={item.href}>{item.label}</Button>}</CardContent></Card></Grid>)}</Grid>
  </Stack>;
}

function PropertySection({ plan, example }: { plan: FinancialPlan; example: boolean }) {
  return <Stack spacing={3}><SectionIntro title="Property performance" description="Put equity beside debt, rental income and recorded operating costs. A gross yield is only a starting point: vacancies, repairs, tax and mortgage costs affect your return." /><Grid container spacing={3}>{plan.properties.map(property => <Grid key={property.id} size={{ xs: 12, md: 6 }}><Card sx={{ height: '100%' }}><CardContent><Typography variant="h6">{property.name}</Typography><Typography sx={{ fontWeight: 650, fontVariantNumeric: 'tabular-nums', letterSpacing: '-0.03em', fontSize: '2rem', my: 1 }}>{money(property.equity)}</Typography><Typography variant="caption">Recorded equity</Typography><Stack spacing={1.5} sx={{ my: 3 }}><DataRow label="Valuation" value={money(property.value)} /><DataRow label="Mortgage debt" value={money(property.debt)} /><DataRow label="Loan to value" value={percent(property.loanToValuePercent)} /><Divider /><DataRow label={example ? "Illustrative monthly rent" : "Observed monthly rent"} value={money(property.monthlyRent)} /><DataRow label={example ? "Illustrative monthly costs" : "Observed monthly costs"} value={money(property.monthlyCosts)} /><DataRow label="Operating surplus estimate" value={money(property.monthlyOperatingSurplus)} /><DataRow label="Gross rental yield" value={percent(property.grossYieldPercent)} /></Stack>{property.warnings.map(w => <Typography variant="caption" key={w} sx={{ display: 'block', mb: 1 }}>{w}</Typography>)}<Typography variant="caption" sx={{ display: 'block', mb: 2 }}>Monthly amounts use recorded cash flow across three completed months, or explicit example assumptions. Rent history does not establish future occupancy; cost history may omit tax and future repairs.</Typography><Button variant="outlined" component={Link} href={example ? '/properties' : property.href}>Manage property</Button></CardContent></Card></Grid>)}</Grid>{plan.properties.length === 0 && <Card><CardContent><Typography variant="h6">Add your property portfolio</Typography><Typography variant="body2" sx={{ my: 2 }}>Add valuations, mortgages, ownership and tenancy agreements to compare equity and operating performance.</Typography><Button component={Link} href="/properties" variant="contained">Manage properties</Button></CardContent></Card>}<Alert severity="info">Keep a separate property reserve for void periods, repairs and mortgage-rate changes. Personal emergency cash and rental-business reserves have different jobs.</Alert></Stack>;
}
