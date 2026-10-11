'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import Decimal from 'decimal.js';
import {
  Accordion, AccordionDetails, AccordionSummary, Alert, Box, Button,
  Card, CardContent, Checkbox, Chip, CircularProgress, Divider, FormControlLabel,
  Grid, LinearProgress, Skeleton, Stack, Table, TableBody, TableCell,
  TableContainer, TableHead, TableRow, TextField, ToggleButton,
  ToggleButtonGroup, Typography,
} from '@mui/material';
import ExpandMoreRoundedIcon from '@mui/icons-material/ExpandMoreRounded';
import SavingsRoundedIcon from '@mui/icons-material/SavingsRounded';
import BookmarkBorderRoundedIcon from '@mui/icons-material/BookmarkBorderRounded';
import { LineChart } from '@mui/x-charts/LineChart';
import {
  projectRetirement, retirementInputSchema,
  type RetirementInput, type RetirementProjection,
} from '@/lib/retirement/projection';
import { formatCurrency } from '@/lib/utils/formatting';
import { softTokens } from '@/theme/theme';

type FormValues = Record<keyof RetirementInput, string>;
const INITIAL: FormValues = {
  currentAge: '', retirementAge: '67', currentPot: '', monthlyContribution: '',
  monthlyEmployerContribution: '0', annualGrowthRate: '5', annualFeeRate: '0.5',
  inflationRate: '2.5', desiredAnnualIncome: '', expectedAnnualStatePension: '0',
  statePensionAge: '68', withdrawalRate: '3.5', sensitivitySpread: '2',
};

interface PensionAccount {
  id: number;
  name: string;
  investmentKind: string | null;
  ownerName: string | null;
  balance: string;
}

type FieldSpec = {
  key: keyof RetirementInput;
  label: string;
  helper?: string;
  min: number;
  max: number;
  step?: number;
};
const PERSONAL_FIELDS: FieldSpec[] = [
  { key: 'currentAge', label: 'Your current age', min: 18, max: 100, step: 1 },
  { key: 'retirementAge', label: 'Target retirement age', min: 18, max: 100, step: 1, helper: 'A planning goal; check when each pension can be accessed.' },
  { key: 'currentPot', label: 'Current pension pot (£)', min: 0, max: 100_000_000, helper: 'Your defined contribution pensions only. Exclude a defined benefit income promise.' },
  { key: 'desiredAnnualIncome', label: 'Annual retirement income target (£)', min: 0, max: 1_000_000, helper: "Gross income before tax, in today's money." },
];
const CONTRIBUTION_FIELDS: FieldSpec[] = [
  { key: 'monthlyContribution', label: 'Personal contribution credited monthly (£)', min: 0, max: 100_000, helper: 'Gross amount reaching your pension, including relief already credited. Enter 0 if none.' },
  { key: 'monthlyEmployerContribution', label: 'Employer contribution monthly (£)', min: 0, max: 100_000, helper: 'Additional employer money. Keep it separate from your personal amount.' },
  { key: 'expectedAnnualStatePension', label: 'Expected annual State Pension (£)', min: 0, max: 100_000, helper: "In today's money. Leave 0 until you have checked your personal forecast." },
  { key: 'statePensionAge', label: 'Assumed State Pension start age', min: 18, max: 100, step: 1, helper: '68 is an editable assumption, not your confirmed entitlement age.' },
];
const ASSUMPTION_FIELDS: FieldSpec[] = [
  { key: 'annualGrowthRate', label: 'Annual growth before fees (%)', min: -40, max: 25, step: 0.1 },
  { key: 'annualFeeRate', label: 'Annual pension fees (%)', min: 0, max: 10, step: 0.1, helper: 'Use total effective provider, platform and investment fees.' },
  { key: 'inflationRate', label: 'Annual inflation (%)', min: 0, max: 20, step: 0.1 },
  { key: 'withdrawalRate', label: 'Illustrative annual withdrawal (%)', min: 1, max: 10, step: 0.1, helper: 'An income comparison assumption, not a safe or guaranteed withdrawal rate.' },
  { key: 'sensitivitySpread', label: 'Growth sensitivity (percentage points)', min: 0, max: 10, step: 0.1, helper: 'Lower / higher growth = your rate minus / plus this amount.' },
];

function fromInput(input: RetirementInput): FormValues {
  return Object.fromEntries(Object.entries(input).map(([key, value]) => [key, String(value)])) as FormValues;
}

async function fetchProfile(): Promise<Record<string, unknown>> {
  const response = await fetch('/api/planning/profile', { cache: 'no-store' });
  if (!response.ok) throw new Error('Saved planning information is unavailable. You can keep calculating here.');
  const data: unknown = await response.json().catch(() => {
    throw new Error('Saved planning information could not be read. You can keep calculating here.');
  });
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    throw new Error('Saved planning information could not be read. You can keep calculating here.');
  }
  const envelope = data as Record<string, unknown>;
  if (!envelope.profile || typeof envelope.profile !== 'object' || Array.isArray(envelope.profile)) {
    throw new Error('Saved planning information could not be read. You can keep calculating here.');
  }
  return envelope.profile as Record<string, unknown>;
}

export default function RetirementPlanner() {
  const [values, setValues] = useState<FormValues>(INITIAL);
  const [profileLoading, setProfileLoading] = useState(true);
  const [profileMessage, setProfileMessage] = useState<string | null>(null);
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved' | 'changed' | 'error'>('idle');
  const [saveMessage, setSaveMessage] = useState('');
  const [display, setDisplay] = useState<'real' | 'nominal'>('real');
  const edited = useRef(false);
  const editVersion = useRef(0);

  useEffect(() => {
    let active = true;
    fetchProfile().then(profile => {
      if (!active) return;
      const parsed = retirementInputSchema.safeParse(profile.retirementScenario);
      if (parsed.success && !edited.current) {
        setValues(fromInput(parsed.data));
        setProfileMessage('Your saved retirement scenario is loaded.');
      }
    }).catch((error: unknown) => {
      if (active) setProfileMessage(error instanceof Error ? error.message : 'Saved scenarios are unavailable. The calculator is ready to use.');
    }).finally(() => { if (active) setProfileLoading(false); });
    return () => { active = false; };
  }, []);

  const validation = useMemo(() => {
    const raw = Object.fromEntries(Object.entries(values).map(([key, value]) => [key, value.trim() === '' ? undefined : Number(value)]));
    const parsed = retirementInputSchema.safeParse(raw);
    if (parsed.success) return { input: parsed.data, errors: {} as Partial<Record<keyof RetirementInput, string>> };
    const errors: Partial<Record<keyof RetirementInput, string>> = {};
    for (const issue of parsed.error.issues) {
      const key = issue.path[0] as keyof RetirementInput;
      if (values[key]?.trim()) errors[key] = issue.message;
    }
    return { input: null, errors };
  }, [values]);
  const projection = useMemo(() => validation.input ? projectRetirement(validation.input) : null, [validation.input]);

  const change = (key: keyof RetirementInput, value: string) => {
    edited.current = true;
    editVersion.current += 1;
    setValues(previous => ({ ...previous, [key]: value }));
    setSaveState(previous => previous === 'saving' ? 'saving' : 'idle');
  };
  const field = ({ key, label, helper, min, max, step = 0.01 }: FieldSpec) => (
    <Grid key={key} size={{ xs: 12, sm: 6 }}>
      <TextField
        fullWidth label={label} type="number" value={values[key]}
        onChange={event => change(key, event.target.value)}
        error={Boolean(validation.errors[key])}
        helperText={validation.errors[key] ?? helper}
        slotProps={{ htmlInput: { min, max, step } }}
      />
    </Grid>
  );

  const save = async () => {
    if (!validation.input) return;
    const scenario = validation.input;
    const version = editVersion.current;
    setSaveState('saving');
    try {
      // Read immediately before merging so saving this planner never replaces
      // spending / debt / goals settings with defaults from an old page load.
      const current = await fetchProfile();
      const response = await fetch('/api/planning/profile', {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...current, retirementScenario: scenario,
          currentAge: scenario.currentAge, retirementAge: scenario.retirementAge,
          monthlyPensionContribution: new Decimal(scenario.monthlyContribution).plus(scenario.monthlyEmployerContribution).toNumber(),
          targetRetirementIncome: scenario.desiredAnnualIncome,
          statePensionAnnual: scenario.expectedAnnualStatePension,
        }),
      });
      if (!response.ok) throw new Error('The scenario could not be saved. Your calculations are still available on this page.');
      const changedDuringSave = version !== editVersion.current;
      setSaveState(changedDuringSave ? 'changed' : 'saved');
      setSaveMessage(changedDuringSave
        ? 'The earlier scenario was saved. Your latest changes have not been saved yet.'
        : 'Retirement scenario saved.');
    } catch (error) {
      setSaveState('error');
      setSaveMessage(error instanceof Error ? error.message : 'The scenario could not be saved.');
    }
  };

  return (
    <Stack spacing={3}>
      <Grid container spacing={3}>
        <Grid size={{ xs: 12, lg: 7 }}>
          <Card>
            <CardContent>
              <Stack direction={{ xs: 'column', sm: 'row' }} gap={1} justifyContent="space-between" alignItems={{ sm: 'center' }} sx={{ mb: 2.5 }}>
                <Box>
                  <Typography variant="h6">Scenario inputs</Typography>
                  <Typography variant="body2" sx={{ mt: 0.5 }}>Edit your figures and assumptions to update the projection.</Typography>
                </Box>
                <Chip label="GBP · UK" variant="outlined" />
              </Stack>
              <Grid container spacing={2.5}>{PERSONAL_FIELDS.map(field)}</Grid>
              <Divider sx={{ my: 3 }} />
              <Typography variant="subtitle1" fontWeight={600} sx={{ mb: 2 }}>Contributions and State Pension</Typography>
              <Grid container spacing={2.5}>{CONTRIBUTION_FIELDS.map(field)}</Grid>
              <Typography variant="caption" component="p" sx={{ mt: 2 }}>
                No automatic tax relief is added. Personal and employer deposits stay fixed in pounds, paid at month-end.
              </Typography>
              <Accordion disableGutters elevation={0} sx={{ mt: 2.5, borderTop: 1, borderBottom: 1, borderColor: 'divider', borderRadius: '0px', '&:before': { display: 'none' } }}>
                <AccordionSummary expandIcon={<ExpandMoreRoundedIcon />} aria-controls="retirement-assumptions" id="retirement-assumptions-heading">
                  <Box>
                    <Typography variant="subtitle1" fontWeight={600}>Growth, fees &amp; inflation</Typography>
                    <Typography variant="caption">{values.annualGrowthRate || '—'}% growth · {values.annualFeeRate || '—'}% fees · {values.inflationRate || '—'}% inflation</Typography>
                  </Box>
                </AccordionSummary>
                <AccordionDetails id="retirement-assumptions" sx={{ px: 0, pt: 2, pb: 3 }}>
                  <Grid container spacing={2.5}>{ASSUMPTION_FIELDS.map(field)}</Grid>
                </AccordionDetails>
              </Accordion>
              <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5} alignItems={{ sm: 'center' }} sx={{ mt: 2 }}>
                <Button onClick={save} variant="contained" disabled={!projection || saveState === 'saving' || profileLoading}
                  startIcon={saveState === 'saving' ? <CircularProgress size={16} color="inherit" /> : <BookmarkBorderRoundedIcon />}>
                  {saveState === 'saving' ? 'Saving…' : 'Save scenario'}
                </Button>
                <Typography variant="caption">Saving is optional. Calculations run in your browser.</Typography>
              </Stack>
              <Box aria-live="polite" sx={{ mt: 1.5 }}>
                {profileLoading && <Typography variant="caption">Checking for a saved scenario…</Typography>}
                {!profileLoading && profileMessage && <Typography variant="caption">{profileMessage}</Typography>}
                {saveState === 'saved' && <Alert severity="success" sx={{ mt: 1 }}>{saveMessage}</Alert>}
                {saveState === 'changed' && <Alert severity="info" sx={{ mt: 1 }}>{saveMessage}</Alert>}
                {saveState === 'error' && <Alert severity="error" sx={{ mt: 1 }}>{saveMessage}</Alert>}
              </Box>
            </CardContent>
          </Card>
        </Grid>
        <Grid size={{ xs: 12, lg: 5 }}>
          {projection && validation.input ? (
            <ResultsSummary projection={projection} input={validation.input} />
          ) : (
            <Card sx={{ height: '100%', minHeight: 320 }}>
              <CardContent sx={{ height: '100%', display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'flex-start' }}>
                <Box sx={{ width: 44, height: 44, borderRadius: '8px', bgcolor: softTokens.cream, display: 'grid', placeItems: 'center', mb: 2 }}><SavingsRoundedIcon sx={{ color: 'text.secondary', fontSize: 24 }} /></Box>
                <Typography variant="h6">Projection awaiting inputs</Typography>
                <Typography variant="body2" color="text.secondary" sx={{ mt: 1.5, maxWidth: 360 }}>
                  Add your age, pension balance, monthly contribution and income goal to see your projection.
                  Enter 0 where appropriate.
                </Typography>
                {Object.keys(validation.errors).length > 0 && <Alert severity="error" sx={{ mt: 2 }}>Check the highlighted fields to calculate your scenario.</Alert>}
              </CardContent>
            </Card>
          )}
        </Grid>
      </Grid>

      {projection && validation.input && <>
        <Card>
          <CardContent>
            <Stack direction={{ xs: 'column', sm: 'row' }} justifyContent="space-between" spacing={2}>
              <Box>
                <Typography variant="h6">Pension growth projection</Typography>
                <Typography variant="body2" sx={{ mt: 0.5 }}>Three growth assumptions, with your contributions and fees included.</Typography>
              </Box>
              <ToggleButtonGroup size="small" value={display} exclusive
                aria-label="Projection currency basis" onChange={(_, next) => { if (next) setDisplay(next); }}>
                <ToggleButton value="real">Today&apos;s money</ToggleButton>
                <ToggleButton value="nominal">Future pounds</ToggleButton>
              </ToggleButtonGroup>
            </Stack>
            <Box sx={{ width: '100%', height: 300, mt: 2 }}>
              <LineChart height={300}
                xAxis={[{
                  data: projection.scenarios[1].points.map(point => point.age), label: 'Age', scaleType: 'linear',
                  min: validation.input.currentAge, max: Math.max(validation.input.retirementAge, validation.input.currentAge + 1),
                  tickMinStep: 1, tickNumber: Math.min(6, projection.yearsToRetirement + 1),
                  valueFormatter: (value: number) => String(Math.round(value)),
                }]}
                yAxis={[{ width: 65, tickNumber: 5, valueFormatter: (value: number) => `£${new Intl.NumberFormat('en-GB', { notation: 'compact', maximumFractionDigits: 1 }).format(value)}` }]}
                series={projection.scenarios.map((scenario, index) => ({
                  data: scenario.points.map(point => Number(display === 'real' ? point.realPot : point.nominalPot)),
                  label: `${scenario.label} (${scenario.annualGrowthRate}%)`,
                  color: [softTokens.peach.ink, softTokens.lavender.ink, softTokens.mint.ink][index],
                  showMark: scenario.points.length === 1,
                  valueFormatter: value => value === null ? '' : formatCurrency(value),
                }))}
                margin={{ left: 10, right: 15, top: 15, bottom: 35 }}
              />
            </Box>
            <Typography variant="caption">Values shown {display === 'real' ? "after inflation, in today's purchasing power" : 'in future pounds, before adjusting for inflation'}. These are illustrations, not confidence intervals.</Typography>
          </CardContent>
        </Card>
        <ScenarioComparison projection={projection} input={validation.input} />
      </>}

      <TrackedPensions onUseBalance={balance => change('currentPot', balance)} />

      <Card>
        <CardContent>
          <Typography variant="h6">Pension guidance</Typography>
          <Grid container spacing={3} sx={{ mt: 0.5 }}>
            <Grid size={{ xs: 12, md: 4 }}>
              <Typography variant="subtitle1">Check your pension income</Typography>
              <Typography variant="body2" sx={{ mt: 0.5, mb: 1 }}>Confirm your State Pension forecast and start age. Add other guaranteed income separately when judging your full retirement budget.</Typography>
              <Button component="a" href="https://www.gov.uk/check-state-pension" target="_blank" rel="noopener noreferrer" size="small">Check your State Pension ↗</Button>
            </Grid>
            <Grid size={{ xs: 12, md: 4 }}>
              <Typography variant="subtitle1">Get the employer match</Typography>
              <Typography variant="body2" sx={{ mt: 0.5, mb: 1 }}>Check your workplace scheme&apos;s matching rules and whether a higher personal contribution earns more employer money.</Typography>
              <Button component="a" href="https://www.moneyhelper.org.uk/en/pensions-and-retirement/pensions-basics" target="_blank" rel="noopener noreferrer" size="small">Understand your pension ↗</Button>
            </Grid>
            <Grid size={{ xs: 12, md: 4 }}>
              <Typography variant="subtitle1">Plan how you will draw it</Typography>
              <Typography variant="body2" sx={{ mt: 0.5, mb: 1 }}>Compare drawdown and guaranteed income, income tax and withdrawal timing. Eligible defined contribution pension holders can use Pension Wise.</Typography>
              <Button component="a" href="https://www.moneyhelper.org.uk/en/pensions-and-retirement/pension-wise" target="_blank" rel="noopener noreferrer" size="small">Explore Pension Wise ↗</Button>
            </Grid>
          </Grid>
          <Divider sx={{ my: 2 }} />
          <Typography variant="caption" component="p">
            This model covers defined contribution pots. Returns, fees and inflation are constant assumptions;
            actual markets vary and pensions can fall in value. It excludes income tax, contribution limits,
            defined benefit pensions and changes in earnings or contribution rates. Withdrawal-rate income is an
            initial illustration, not a simulation of how long a pot lasts. Check pension access rules,
            affordability and tax relief limits before changing contributions.
          </Typography>
        </CardContent>
      </Card>
    </Stack>
  );
}

function ResultsSummary({ projection, input }: { projection: RetirementProjection; input: RetirementInput }) {
  const base = projection.scenarios[1];
  const shortfall = new Decimal(base.realShortfall);
  const target = new Decimal(projection.targetRealPot);
  const progress = target.gt(0) ? Math.min(100, new Decimal(base.finalRealPot).div(target).mul(100).toNumber()) : 100;
  return (
    <Stack spacing={2} aria-live="polite">
      <Card sx={{ borderTop: '3px solid', borderTopColor: 'primary.main' }}>
        <CardContent>
          <Stack direction="row" flexWrap="wrap" gap={1} justifyContent="space-between" alignItems="center">
            <Typography variant="subtitle2">Projected pot at age {input.retirementAge}</Typography>
            <Chip label="Today&apos;s money" size="small" variant="outlined" />
          </Stack>
          <Typography sx={{ fontWeight: 650, fontVariantNumeric: 'tabular-nums', letterSpacing: '-0.04em', fontSize: { xs: 32, sm: 40 }, overflowWrap: 'anywhere', mt: 1.5, lineHeight: 1.2 }}>
            {formatCurrency(base.finalRealPot)}
          </Typography>
          <Typography variant="body2" sx={{ mt: 1 }}>{formatCurrency(base.finalNominalPot)} in future pounds · {projection.yearsToRetirement} years to plan</Typography>
          <Divider sx={{ my: 2 }} />
          <Typography variant="body2">Illustrative initial income, before tax</Typography>
          <Typography variant="h4" sx={{ mt: 0.75, fontVariantNumeric: 'tabular-nums', overflowWrap: 'anywhere' }}>{formatCurrency(base.totalIncomeAtRetirement)}<Typography component="span" variant="body2"> / year</Typography></Typography>
          <Typography variant="caption" component="p" sx={{ mt: 1 }}>
            {formatCurrency(base.privateAnnualIncome)} from the pot at {input.withdrawalRate}% + {formatCurrency(projection.statePensionAtRetirement)} assumed State Pension.
          </Typography>
        </CardContent>
      </Card>
      <Card>
        <CardContent>
          <Stack direction={{ xs: 'column', sm: 'row' }} gap={1} justifyContent="space-between" alignItems={{ sm: 'center' }}>
            <Typography variant="h6">Income target</Typography>
            <Chip size="small" label={shortfall.gt(0) ? 'Projected shortfall' : 'Covered in this scenario'} color={shortfall.gt(0) ? 'warning' : 'success'} />
          </Stack>
          <Typography variant="body2" sx={{ mt: 1 }}>Target pot: {formatCurrency(projection.targetRealPot)} in today&apos;s money.</Typography>
          <LinearProgress variant="determinate" value={progress} aria-label="Illustrative pension pot as a percentage of target" sx={{ mt: 2, mb: 1 }} />
          <Typography variant="caption">{progress.toFixed(0)}% of this illustrative target</Typography>
          {shortfall.gt(0) ? <>
            <Typography variant="h5" sx={{ mt: 2 }}>{formatCurrency(base.realShortfall)} pot gap</Typography>
            <Typography variant="body2" sx={{ mt: 1 }}>
              {base.extraMonthlyContribution === null
                ? 'There is no contribution period before your chosen retirement age. Explore a later age, a different income goal, or other retirement resources.'
                : `An extra ${formatCurrency(base.extraMonthlyContribution)} gross per month would close it under your growth assumption.`}
            </Typography>
            <Typography variant="caption" component="p" sx={{ mt: 1 }}>This is a calculation to explore, subject to affordability and pension contribution rules.</Typography>
          </> : <Typography variant="body2" sx={{ mt: 2 }}>Your entered contributions cover this goal under the chosen assumptions. Compare lower growth before making a decision.</Typography>}
          {projection.yearsBeforeStatePension > 0 && <Alert severity="info" sx={{ mt: 2 }}>
            {projection.yearsBeforeStatePension} years between retirement and your assumed State Pension start.
            The target pot covers the full income goal at retirement; it does not assume State Pension arrives early.
          </Alert>}
        </CardContent>
      </Card>
    </Stack>
  );
}

function ScenarioComparison({ projection, input }: { projection: RetirementProjection; input: RetirementInput }) {
  const base = projection.scenarios[1];
  return (
    <Card>
      <CardContent>
        <Typography variant="h6">Scenario comparison</Typography>
        <Typography variant="body2" sx={{ mt: 0.5 }}>All income and pot comparisons below are in today&apos;s money. Income is before tax.</Typography>
        <TableContainer sx={{ mt: 2 }}>
          <Table size="small" aria-label="Retirement scenario comparison" sx={{ minWidth: 650, '& .MuiTableCell-root': { fontVariantNumeric: 'tabular-nums' } }}>
            <TableHead><TableRow>
              <TableCell>Assumption</TableCell><TableCell align="right">Pot at retirement</TableCell>
              <TableCell align="right">Annual income at retirement</TableCell>
              <TableCell align="right">Extra gross / month to reach goal</TableCell>
            </TableRow></TableHead>
            <TableBody>{projection.scenarios.map(scenario => <TableRow key={scenario.key} sx={scenario.key === 'base' ? { bgcolor: softTokens.fog } : {}}>
              <TableCell><Typography variant="body2" fontWeight={600}>{scenario.label}</Typography><Typography variant="caption">{scenario.annualGrowthRate}% growth before fees</Typography></TableCell>
              <TableCell align="right">{formatCurrency(scenario.finalRealPot)}</TableCell>
              <TableCell align="right">{formatCurrency(scenario.totalIncomeAtRetirement)}</TableCell>
              <TableCell align="right">{scenario.extraMonthlyContribution === null ? 'No time to contribute' : formatCurrency(scenario.extraMonthlyContribution)}</TableCell>
            </TableRow>)}</TableBody>
          </Table>
        </TableContainer>
        {projection.yearsBeforeStatePension > 0 && input.expectedAnnualStatePension > 0 && <Typography variant="body2" sx={{ mt: 2 }}>
          Once your assumed State Pension begins at {input.statePensionAge}, the initial income comparison becomes {formatCurrency(base.totalIncomeAfterStatePension)} a year.
          This holds the retirement pot illustration constant; the intervening drawdown is not modelled.
        </Typography>}
        <Divider sx={{ my: 2 }} />
        <Typography variant="subtitle2">Projected pot breakdown · base growth assumption</Typography>
        <Grid container spacing={2} sx={{ mt: 0.5 }}>
          {[
            ['Starting pension', formatCurrency(input.currentPot)],
            ['Personal deposits', formatCurrency(base.personalContributions)],
            ['Employer deposits', formatCurrency(base.employerContributions)],
            ['Investment growth / loss', formatCurrency(base.investmentGrowth)],
            ['Fees deducted', formatCurrency(base.feesPaid)],
          ].map(([label, value]) => <Grid key={label} size={{ xs: 6, md: 'grow' }}><Typography variant="caption">{label}</Typography><Typography variant="subtitle1" sx={{ fontVariantNumeric: 'tabular-nums', overflowWrap: 'anywhere' }}>{value}</Typography></Grid>)}
        </Grid>
        <Typography variant="caption" component="p" sx={{ mt: 2 }}>Growth is before fees. Starting pension + deposits + growth − fees = the final pot in future pounds, subject to penny rounding.</Typography>
      </CardContent>
    </Card>
  );
}

function TrackedPensions({ onUseBalance }: { onUseBalance: (balance: string) => void }) {
  const [accounts, setAccounts] = useState<PensionAccount[]>([]);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [selected, setSelected] = useState<number[]>([]);
  useEffect(() => {
    let active = true;
    fetch('/api/investments').then(async response => {
      if (!response.ok) throw new Error('Pension accounts could not be loaded.');
      const data: unknown = await response.json();
      if (!Array.isArray(data)) throw new Error('Pension accounts could not be read.');
      const pensions = data.filter((account): account is PensionAccount =>
        account && typeof account === 'object' && typeof account.id === 'number'
        && typeof account.name === 'string' && account.investmentKind === 'pension'
        && ['string', 'number'].includes(typeof account.balance)
        && new Decimal(account.balance).isFinite() && new Decimal(account.balance).gte(0));
      if (active) { setAccounts(pensions); setStatus('ready'); }
    }).catch(() => { if (active) setStatus('error'); });
    return () => { active = false; };
  }, []);
  const selectedBalance = accounts.filter(account => selected.includes(account.id))
    .reduce((total, account) => total.plus(account.balance), new Decimal(0));
  return (
    <Card>
      <CardContent>
        <Stack direction={{ xs: 'column', sm: 'row' }} justifyContent="space-between" alignItems={{ sm: 'center' }} spacing={1}>
          <Box><Typography variant="h6">Your tracked pensions</Typography><Typography variant="body2" sx={{ mt: 0.5 }}>Select only the pots that belong in this person&apos;s scenario. Balances are manually tracked.</Typography></Box>
          <Button component={Link} href="/investments" variant="outlined" size="small">Manage pension accounts</Button>
        </Stack>
        {status === 'loading' ? <Skeleton variant="rectangular" height={70} sx={{ mt: 2, borderRadius: '8px' }} />
          : status === 'error' ? <Alert severity="info" sx={{ mt: 2 }}>Tracked pension balances are unavailable. Enter your current pot above to keep planning.</Alert>
            : accounts.length === 0 ? <Typography variant="body2" sx={{ mt: 2 }}>No pension accounts tracked yet. Add one in Investments, or enter a balance directly in the calculator.</Typography>
              : <>
                <Stack spacing={0.5} sx={{ mt: 2 }}>
                  {accounts.map(account => <Stack key={account.id} direction="row" justifyContent="space-between" alignItems="center" spacing={1}>
                    <FormControlLabel control={<Checkbox checked={selected.includes(account.id)} onChange={(_, checked) => setSelected(previous => checked ? [...previous, account.id] : previous.filter(id => id !== account.id))} />}
                      label={<Box><Typography variant="body2">{account.name}</Typography><Typography variant="caption">{account.ownerName || 'Owner not recorded'}</Typography></Box>} />
                    <Typography variant="subtitle1">{formatCurrency(account.balance)}</Typography>
                  </Stack>)}
                </Stack>
                <Button variant="outlined" sx={{ mt: 2 }} disabled={selected.length === 0 || selectedBalance.gt(100_000_000)} onClick={() => onUseBalance(selectedBalance.toFixed(2))}>
                  Use selected balance · {formatCurrency(selectedBalance)}
                </Button>
              </>}
      </CardContent>
    </Card>
  );
}
