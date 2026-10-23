'use client';

import { useRef, useState } from 'react';
import useSWR from 'swr';
import { Alert, Box, Button, Chip, Divider, InputAdornment, MenuItem, Stack, TextField, Typography } from '@mui/material';
import SaveIcon from '@mui/icons-material/Save';
import RefreshIcon from '@mui/icons-material/Refresh';
import type { OwnerTaxProfile } from '@/lib/repos/owner-tax.repo';
import { emptyTaxProfileFacts, type TaxMoneyField, type TaxProfileFacts } from '@/lib/tax/profileFacts';
import { buildTaxProfilePatch, type TaxProfileDraft } from './taxProfileDraft';

const MONEY_FIELDS: { name: TaxMoneyField; label: string; help?: string }[] = [
  { name: 'employmentIncome', label: 'Total employment income', help: 'Actual whole-year pay. Overrides the salary + bonus projection above.' },
  { name: 'payeTaxPaid', label: 'PAYE tax paid', help: 'Income tax already deducted for this year; check your P60 or payslips.' },
  { name: 'selfEmploymentIncome', label: 'Self-employment profit' },
  { name: 'otherIncome', label: 'Other income', help: 'For example, taxable pension income.' },
  { name: 'savingsInterest', label: 'Savings interest' },
  { name: 'dividends', label: 'Dividends' },
  { name: 'propertyLossesBroughtForward', label: 'Property losses brought forward' },
  { name: 'financeCostsBroughtForward', label: 'Finance costs brought forward', help: 'Previously unrelieved Section 24 finance costs.' },
];
const NUMERIC_FACTS: { name: keyof TaxProfileFacts; label: string; unit: '£' | '%'; help?: string }[] = [
  { name: 'baseSalary', label: 'Annual base salary', unit: '£', help: 'Gross contractual rate. Salary + bonus is a projection; enter actual whole-year pay below when available.' },
  { name: 'bonusPercent', label: 'Bonus as % of base', unit: '%', help: 'Use a percentage or cash amount, rather than both.' },
  { name: 'bonusAmount', label: 'Bonus cash amount', unit: '£', help: 'Only the bonus paid or expected in this tax year.' },
  { name: 'employeePensionPercent', label: 'Your pension contribution', unit: '%' },
  { name: 'employerPensionPercent', label: 'Employer pension contribution', unit: '%', help: 'Matching is remembered separately; it is not your income deduction.' },
  { name: 'pensionAnnualAmount', label: 'Annual employee pension (gross)', unit: '£', help: 'Gross employee contribution for the year, including basic-rate relief where applicable; exclude employer contributions.' },
];
const SELECT_FACTS: { name: keyof TaxProfileFacts; label: string; help?: string; options: [string, string][] }[] = [
  { name: 'bonusIsEstimate', label: 'Bonus status', options: [['', 'Unknown'], ['true', 'Estimate for this tax year'], ['false', 'Confirmed for this tax year']] },
  { name: 'pensionBasis', label: 'Pension contribution basis', options: [['unknown', 'Unknown'], ['base_salary', 'Base salary only'], ['total_pay', 'Total pay including bonus'], ['qualifying_earnings', 'Qualifying earnings']] },
  { name: 'pensionMethod', label: 'Pension tax treatment', help: 'Check payroll or your pension provider if unsure.', options: [['unknown', 'Unknown'], ['salary_sacrifice', 'Salary sacrifice'], ['net_pay', 'Net pay arrangement'], ['relief_at_source', 'Relief at source']] },
  { name: 'employmentIncomeBasis', label: 'Employment income basis', help: 'Prevents deducting pension contributions twice.', options: [['unknown', 'Unknown'], ['gross_before_pension', 'Gross before employee pension'], ['taxable_pay_after_pension', 'Taxable pay after pension deduction']] },
  { name: 'jurisdiction', label: 'Tax residence', options: [['unknown', 'Unconfirmed'], ['england_wales_ni', 'England, Wales or Northern Ireland'], ['scotland', 'Scotland (calculation unsupported)']] },
];
const GRID = { display: 'grid', gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, minmax(0, 1fr))', lg: 'repeat(3, minmax(0, 1fr))' }, gap: 2 } as const;

async function fetchProfile(url: string): Promise<OwnerTaxProfile> {
  const response = await fetch(url);
  const body = await response.json();
  if (!response.ok) throw new Error(body.error || 'Unable to load tax profile');
  return body;
}

type TaxProfileEditorProps = {
  ownerId: number | string; year: string; ownerName?: string; onSaved?: () => Promise<unknown>;
};

export default function TaxProfileEditor(props: TaxProfileEditorProps) {
  return <TaxProfileEditorContent key={`${props.ownerId}:${props.year}`} {...props} />;
}

function TaxProfileEditorContent({ ownerId, year, ownerName, onSaved }: TaxProfileEditorProps) {
  const key = `/api/owners/${ownerId}/tax-profile?year=${encodeURIComponent(year)}`;
  const { data: profile, error, mutate } = useSWR<OwnerTaxProfile>(key, fetchProfile);
  const [draft, setDraft] = useState<TaxProfileDraft>({ core: {}, facts: {} });
  const [baseRevision, setBaseRevision] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const pending = useRef(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [conflict, setConflict] = useState(false);
  const [reviewedLatest, setReviewedLatest] = useState(false);
  const dirty = Object.keys(draft.core).length + Object.keys(draft.facts).length > 0;
  const facts = profile?.facts ?? emptyTaxProfileFacts;
  const coreValue = (name: TaxMoneyField | 'notes') => draft.core[name] !== undefined ? draft.core[name]!
    : name === 'notes' ? profile?.notes ?? ''
      : profile?.knownFields?.includes(name) ? profile[name] : '';
  const factValue = (name: keyof TaxProfileFacts) => draft.facts[name] !== undefined ? draft.facts[name]!
    : facts[name] === null ? '' : String(facts[name]);

  function editCore(name: TaxMoneyField | 'notes', value: string) {
    if (saving || !profile) return;
    if (baseRevision === null) setBaseRevision(profile.revision ?? 0);
    setDraft(previous => ({ ...previous, core: { ...previous.core, [name]: value } }));
    setSaved(false);
  }
  function editFact(name: keyof TaxProfileFacts, value: string) {
    if (saving || !profile) return;
    if (baseRevision === null) setBaseRevision(profile.revision ?? 0);
    setDraft(previous => ({ ...previous, facts: {
      ...previous.facts, [name]: value,
      ...(value.trim() && name === 'bonusPercent' ? { bonusAmount: '' } : {}),
      ...(value.trim() && name === 'bonusAmount' ? { bonusPercent: '' } : {}),
    } }));
    setSaved(false);
  }
  async function save() {
    if (!profile || !dirty || pending.current || conflict) return;
    pending.current = true;
    setSaving(true);
    setFormError(null);
    setSaved(false);
    let persisted = false;
    try {
      const payload = buildTaxProfilePatch(draft, baseRevision ?? profile.revision);
      const response = await fetch(key, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
      const body = await response.json();
      if (!response.ok) {
        if (response.status === 409) setConflict(true);
        throw new Error(body.error || 'Unable to save tax profile. Your entries have been kept.');
      }
      persisted = true;
      await mutate(body, { revalidate: false });
      setDraft({ core: {}, facts: {} });
      setBaseRevision(null);
      setReviewedLatest(false);
      setSaved(true);
      if (onSaved) await onSaved();
    } catch (saveError) {
      const message = saveError instanceof Error ? saveError.message : 'Unable to save tax profile';
      setFormError(persisted ? 'Your profile was saved, but the calculation could not be refreshed. Refresh this page to retry the calculation.' : message.startsWith('[') ? 'Check the amounts and selections. Amounts need at most two decimal places; percentages must be between 0 and 100. Your entries have been kept.' : message);
    } finally {
      pending.current = false;
      setSaving(false);
    }
  }
  async function reviewLatest() {
    if (pending.current) return;
    pending.current = true;
    setSaving(true);
    try {
      const latest = await mutate();
      if (latest) {
        setBaseRevision(latest.revision);
        setConflict(false);
        setReviewedLatest(true);
        setFormError(null);
      }
    } catch {
      setFormError('The latest saved profile could not be loaded. Your entries have been kept.');
    } finally {
      pending.current = false;
      setSaving(false);
    }
  }

  return <Box component="section" aria-label={`Tax profile for ${year}`} sx={{ mt: 3 }}>
    <Divider sx={{ mb: 3 }} />
    <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} justifyContent="space-between" sx={{ mb: 1 }}>
      <Typography variant="h6">Tax profile · {year}</Typography>
      <Chip size="small" variant="outlined" color={profile?.saved ? 'primary' : 'default'} label={profile?.saved ? 'Saved to platform' : 'Not yet saved'} />
    </Stack>
    <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
      {ownerName ? `${ownerName}’s` : 'Your'} whole-year figures for {year}. The adviser can save these facts from chat and use them in the same calculation.
      Leave missing amounts blank; enter 0 only when confirmed. Current facts from another year are not copied automatically.
    </Typography>
    {error && <Alert severity="error" sx={{ mb: 2 }}>The saved profile could not be loaded. {error.message} <Button size="small" onClick={() => void mutate()}>Retry</Button></Alert>}
    <Typography variant="subtitle2" sx={{ mb: 2 }}>Salary, bonus and pension</Typography>
    <Box sx={GRID}>
      {NUMERIC_FACTS.map(field => <TextField key={field.name} size="small" label={field.label} value={factValue(field.name)}
        onChange={event => editFact(field.name, event.target.value)} disabled={!profile || saving}
        helperText={field.help ?? 'Unknown until entered'}
        slotProps={{ input: { startAdornment: <InputAdornment position="start">{field.unit}</InputAdornment> }, htmlInput: { inputMode: 'decimal' } }} />)}
      {SELECT_FACTS.map(field => <TextField key={field.name} select size="small" label={field.label} value={factValue(field.name)}
        onChange={event => editFact(field.name, event.target.value)} disabled={!profile || saving} helperText={field.help}>
        {field.options.map(([value, label]) => <MenuItem key={value} value={value}>{label}</MenuItem>)}
      </TextField>)}
    </Box>
    <Alert severity="info" sx={{ my: 2 }}>
      A pension percentage alone does not establish tax relief. Confirm the contribution basis, payroll treatment and annual employee amount.
      The bonus must belong to this tax year; estimated amounts remain estimates.
    </Alert>
    <Typography variant="subtitle2" sx={{ mt: 3, mb: 2 }}>Income and tax already paid</Typography>
    <Box sx={GRID}>{MONEY_FIELDS.map(field => <TextField key={field.name} size="small" label={field.label} value={coreValue(field.name)}
      placeholder="Unknown" onChange={event => editCore(field.name, event.target.value)} disabled={!profile || saving}
      helperText={field.help ?? 'Blank means unknown; 0 means confirmed none.'}
      slotProps={{ input: { startAdornment: <InputAdornment position="start">£</InputAdornment> }, htmlInput: { inputMode: 'decimal' } }} />)}</Box>
    <TextField size="small" fullWidth multiline minRows={2} label="Notes" value={coreValue('notes')}
      onChange={event => editCore('notes', event.target.value)} disabled={!profile || saving} sx={{ mt: 2 }} />
    {profile?.updatedAt && <Typography variant="caption" color="text.secondary" display="block" sx={{ mt: 1 }}>Last saved {new Date(profile.updatedAt).toLocaleString('en-GB', { timeZone: 'UTC' })} UTC · revision {profile.revision}</Typography>}
    {formError && <Alert severity="error" sx={{ mt: 2 }}>{formError}</Alert>}
    {conflict && <Alert severity="warning" sx={{ mt: 2 }}>Another tab or the adviser changed this profile. Your entries are kept. Load the latest saved values before saving your edits.
      <Button startIcon={<RefreshIcon />} size="small" onClick={() => void reviewLatest()} disabled={saving}>Review latest saved profile</Button>
    </Alert>}
    {reviewedLatest && <Alert severity="info" sx={{ mt: 2 }}>
      Latest saved values for the fields you edited: {[
        ...Object.keys(draft.core).map(name => `${MONEY_FIELDS.find(field => field.name === name)?.label ?? name}: ${name === 'notes' ? profile?.notes ?? 'Unknown' : profile?.knownFields?.includes(name as TaxMoneyField) ? profile[name as TaxMoneyField] : 'Unknown'}`),
        ...Object.keys(draft.facts).map(name => `${NUMERIC_FACTS.find(field => field.name === name)?.label ?? SELECT_FACTS.find(field => field.name === name)?.label ?? name}: ${facts[name as keyof TaxProfileFacts] ?? 'Unknown'}`),
      ].join('; ')}. Your edits remain in the form. Saving applies only those edited fields.
    </Alert>}
    <Stack direction="row" spacing={2} alignItems="center" sx={{ mt: 2 }}>
      <Button variant="contained" size="small" startIcon={<SaveIcon />} onClick={() => void save()} disabled={!profile || !dirty || saving || conflict}>
        {saving ? 'Saving…' : reviewedLatest ? 'Save my edits and recalculate' : 'Save and recalculate'}
      </Button>
      {saved && !dirty && <Typography role="status" variant="caption" color="success.main">Saved to platform</Typography>}
    </Stack>
  </Box>;
}
