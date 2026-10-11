'use client';

import { useState } from 'react';
import useSWR from 'swr';
import {
  Accordion,
  AccordionDetails,
  AccordionSummary,
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  Divider,
  InputAdornment,
  MenuItem,
  Select,
  Skeleton,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  TextField,
  Typography,
} from '@mui/material';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import SaveIcon from '@mui/icons-material/Save';
import { formatCurrency } from '@/lib/utils/formatting';
import type { OwnerTaxComputationResult, OwnerTaxProfile } from '@/lib/repos/owner-tax.repo';

// The API returns every figure already worked out (and 2dp-formatted) on
// the server; this card only formats and displays, it never does tax maths.

type FormField =
  | 'employmentIncome'
  | 'payeTaxPaid'
  | 'selfEmploymentIncome'
  | 'savingsInterest'
  | 'dividends'
  | 'otherIncome'
  | 'propertyLossesBroughtForward'
  | 'financeCostsBroughtForward';

const FORM_FIELDS: Array<{ name: FormField; label: string; help?: string }> = [
  { name: 'employmentIncome', label: 'Employment income', help: 'Gross pay for the year' },
  { name: 'payeTaxPaid', label: 'PAYE tax paid', help: 'Tax already deducted' },
  { name: 'selfEmploymentIncome', label: 'Self-employment profit' },
  { name: 'otherIncome', label: 'Other income', help: 'Pensions, etc.' },
  { name: 'savingsInterest', label: 'Savings interest' },
  { name: 'dividends', label: 'Dividends', help: 'e.g. from your own company' },
  { name: 'propertyLossesBroughtForward', label: 'Property losses brought forward' },
  { name: 'financeCostsBroughtForward', label: 'Finance costs brought forward', help: 'Unrelieved S.24 mortgage interest' },
];

const LETTING_LABEL = { standard: 'Standard letting', rent_a_room: 'Rent-a-room (in own home)' } as const;
const TREATMENT_LABEL = {
  exempt: 'exempt (within the limit)',
  alternative: 'alternative method (receipts less limit)',
  normal: 'normal method (receipts less expenses)',
} as const;
const LIMIT_LABEL = {
  finance_costs: 'finance costs',
  property_profits: 'property profit',
  adjusted_total_income: 'income above the personal allowance',
  none: '',
} as const;

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) {
    const body = await res.json().catch(() => ({} as { error?: string }));
    throw new Error(body.error || `HTTP ${res.status}`);
  }
  return res.json();
}

async function sendJson(url: string, method: 'PUT' | 'PATCH', payload: unknown): Promise<void> {
  const res = await fetch(url, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({} as { error?: string }));
    throw new Error(body.error || `HTTP ${res.status}`);
  }
}

function Figure({ label, value, bold = false }: { label: string; value: string; bold?: boolean }) {
  return (
    <Box>
      <Typography variant="caption" color="text.secondary">{label}</Typography>
      <Typography variant={bold ? 'h6' : 'body1'} fontWeight={bold ? 700 : 500}>
        {formatCurrency(value)}
      </Typography>
    </Box>
  );
}

function SectionHeading({ children }: { children: React.ReactNode }) {
  return <Typography variant="subtitle2" sx={{ mt: 3, mb: 1 }}>{children}</Typography>;
}

export default function TaxComputationCard({ ownerId, year }: { ownerId: number | string; year: string }) {
  const computationKey = `/api/owners/${ownerId}/tax-computation?year=${encodeURIComponent(year)}`;
  const profileKey = `/api/owners/${ownerId}/tax-profile?year=${encodeURIComponent(year)}`;

  const { data, error, isLoading, mutate: mutateComputation } = useSWR<OwnerTaxComputationResult>(
    computationKey,
    getJson,
  );
  const { data: profile, mutate: mutateProfile } = useSWR<OwnerTaxProfile>(profileKey, getJson);

  // Only the fields the user has typed into; everything else shows the
  // saved value. Avoids copying server data into state with an effect.
  const [draft, setDraft] = useState<Partial<Record<FormField | 'notes', string>>>({});
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [savedNote, setSavedNote] = useState(false);

  const dirty = Object.keys(draft).length > 0;
  const valueOf = (name: FormField | 'notes'): string => {
    if (draft[name] !== undefined) return draft[name] as string;
    if (!profile) return '';
    if (name === 'notes') return profile.notes ?? '';
    return profile[name];
  };

  const handleSave = async () => {
    if (!profile) return;
    setSaving(true);
    setFormError(null);
    setSavedNote(false);
    try {
      const payload: Record<string, string> = {};
      for (const f of FORM_FIELDS) payload[f.name] = valueOf(f.name) || '0';
      payload.notes = valueOf('notes');
      await sendJson(profileKey, 'PUT', payload);
      setDraft({});
      setSavedNote(true);
      await Promise.all([mutateProfile(), mutateComputation()]);
    } catch (e) {
      setFormError(e instanceof Error ? e.message : 'Failed to save tax profile');
    } finally {
      setSaving(false);
    }
  };

  const handleLettingType = async (propertyId: number, lettingType: string) => {
    setFormError(null);
    try {
      await sendJson(`/api/properties/${propertyId}`, 'PATCH', { lettingType });
      await mutateComputation();
    } catch (e) {
      setFormError(e instanceof Error ? e.message : 'Failed to update letting type');
    }
  };

  if (isLoading && !data) {
    return (
      <Card sx={{ mb: 3 }}>
        <CardContent>
          <Typography variant="h6" gutterBottom>Tax computation</Typography>
          <Skeleton variant="rounded" height={240} />
        </CardContent>
      </Card>
    );
  }
  if (error || !data) {
    return (
      <Card sx={{ mb: 3 }}>
        <CardContent>
          <Typography variant="h6" gutterBottom>Tax computation</Typography>
          <Alert severity="error">{error?.message ?? 'Failed to load tax computation'}</Alert>
        </CardContent>
      </Card>
    );
  }

  const sa = data.selfAssessment;
  const poa = sa.paymentsOnAccount;
  const fc = data.financeCosts;
  const roomPool = data.property.rentARoomPool;
  const mtdColor = data.mtd.scope === 'in_scope' ? 'warning' : data.mtd.scope === 'below_threshold' ? 'success' : 'default';
  const mtdLabel =
    data.mtd.scope === 'in_scope' ? 'MTD ITSA mandatory'
      : data.mtd.scope === 'below_threshold' ? 'Below MTD threshold'
        : 'No MTD phase';

  return (
    <Card sx={{ mb: 3 }}>
      <CardContent>
        <Stack direction={{ xs: 'column', md: 'row' }} justifyContent="space-between" alignItems={{ md: 'baseline' }} spacing={1} sx={{ mb: 1 }}>
          <Typography variant="h6">Tax computation</Typography>
          <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
            <Typography variant="caption" color="text.secondary">
              Tax year {data.taxYear} · {data.rates.taxYear} rates, England/Wales/NI
            </Typography>
            {data.rates.provisional && <Chip size="small" color="warning" label="Provisional rates" />}
            {data.rates.assumed && <Chip size="small" color="warning" label="Rates assumed" />}
          </Stack>
        </Stack>

        <Alert severity="info" sx={{ mb: 2 }}>
          {data.disclaimer} Figures use {data.owner.name}&apos;s share of each property and the tax profile below.
        </Alert>
        {data.warnings.map(w => (
          <Alert key={w} severity="warning" sx={{ mb: 1 }}>{w}</Alert>
        ))}

        {/* ---- Headline numbers ---- */}
        <Stack
          direction={{ xs: 'column', sm: 'row' }}
          spacing={4}
          divider={<Divider flexItem orientation="vertical" />}
          sx={{ mt: 2 }}
        >
          <Figure label="Tax attributable to rental income" value={data.taxOnRentalIncome.amount} bold />
          <Figure label="Total income tax" value={data.incomeTax.liability} />
          <Figure label="PAYE already paid" value={sa.payeTaxPaid} />
          <Figure label={sa.isRefund ? 'Overpaid (repayment)' : `Balance due by ${sa.deadline}`} value={sa.isRefund ? sa.refundDue : sa.amountDue} bold />
        </Stack>

        {/* ---- Property profit and method ---- */}
        <SectionHeading>Property profit</SectionHeading>
        <Typography variant="body2" sx={{ mb: 1 }}>{data.property.methodReason}</Typography>
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>{roomPool ? 'Method and rent-a-room treatment' : 'Method'}</TableCell>
              <TableCell align="right">Taxed property profit</TableCell>
              <TableCell align="right">S.24 credit</TableCell>
              <TableCell align="right">Income tax</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {data.property.methods.map(m => (
              <TableRow key={`${m.method}-${m.rentARoom ?? 'standard'}`} selected={m.chosen}>
                <TableCell>
                  {m.label}{' '}
                  {m.chosen && <Chip size="small" color="primary" label="Used" />}
                  {!m.available && <Typography variant="caption" color="text.secondary" display="block">{m.note}</Typography>}
                </TableCell>
                <TableCell align="right">{m.available ? formatCurrency(m.propertyProfit ?? '0') : '–'}</TableCell>
                <TableCell align="right">{m.available ? formatCurrency(m.financeCostReducer ?? '0') : '–'}</TableCell>
                <TableCell align="right">{m.available ? formatCurrency(m.liability ?? '0') : '–'}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        {data.property.rentARoom.map(r => (
          <Typography key={r.name} variant="body2" color="text.secondary" sx={{ mt: 1 }}>
            Rent-a-room, {r.name}: receipts {formatCurrency(r.receipts)}
            {r.shared ? ' (shared)' : ''}, expenses {formatCurrency(r.expenses)}, mortgage interest {formatCurrency(r.financeCosts)}.
          </Typography>
        ))}
        {roomPool && (
          <>
            <Typography variant="body2" sx={{ mt: 1 }}>
              Rent-a-room, all lettings pooled: receipts {formatCurrency(roomPool.receipts)} against a single{' '}
              {formatCurrency(roomPool.limit)} limit{roomPool.shared ? ' (shared)' : ''} → {TREATMENT_LABEL[roomPool.treatment]};
              effect on the property business {formatCurrency(roomPool.taxable)}{roomPool.taxable.startsWith('-') ? ' (a loss)' : ''}.
            </Typography>
            <Typography variant="body2" color="text.secondary">{roomPool.reason}</Typography>
          </>
        )}
        {data.property.hasLosses ? (
          <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
            Losses brought forward {formatCurrency(data.property.lossesBroughtForward)}, used {formatCurrency(data.property.lossesUsed)},
            carried forward {formatCurrency(data.property.lossesCarriedForward)}.
          </Typography>
        ) : null}

        {/* ---- S.24 ---- */}
        {fc.hasFinanceCosts && (
          <>
            <SectionHeading>Mortgage interest relief (Section 24)</SectionHeading>
            <Typography variant="body2">
              Finance costs {formatCurrency(fc.available)} → {fc.reliefRatePct}% relief on {formatCurrency(fc.relieved)}
              {fc.limitedBy !== 'none' && ` (limited by ${LIMIT_LABEL[fc.limitedBy]})`} = <strong>{formatCurrency(fc.reducer)}</strong> off the tax bill.
              {fc.hasCarriedForward && ` ${formatCurrency(fc.carriedForward)} carries forward to next year.`}
            </Typography>
          </>
        )}

        {/* ---- Tax by band ---- */}
        <SectionHeading>Tax by band</SectionHeading>
        <Typography variant="caption" color="text.secondary" display="block" sx={{ mb: 1 }}>
          Personal allowance {formatCurrency(data.incomeTax.personalAllowance.effective)}
          {data.incomeTax.personalAllowance.tapered && ` (reduced by ${formatCurrency(data.incomeTax.personalAllowance.taperReduction)} for income over £100,000)`}.
          Total income {formatCurrency(data.income.total)}.
        </Typography>
        {data.incomeTax.rows.length === 0 ? (
          <Typography variant="body2" color="text.secondary">No taxable income after allowances.</Typography>
        ) : (
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>Income</TableCell>
                <TableCell>Band</TableCell>
                <TableCell align="right">Amount</TableCell>
                <TableCell align="right">Rate</TableCell>
                <TableCell align="right">Tax</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {data.incomeTax.rows.map((r, i) => (
                <TableRow key={`${r.layer}-${r.kind}-${i}`}>
                  <TableCell>{r.layerLabel}</TableCell>
                  <TableCell>{r.kindLabel}</TableCell>
                  <TableCell align="right">{formatCurrency(r.income)}</TableCell>
                  <TableCell align="right">{r.ratePct}%</TableCell>
                  <TableCell align="right">{formatCurrency(r.tax)}</TableCell>
                </TableRow>
              ))}
              <TableRow>
                <TableCell colSpan={4}>Tax before reductions</TableCell>
                <TableCell align="right">{formatCurrency(data.incomeTax.taxBeforeReductions)}</TableCell>
              </TableRow>
              <TableRow>
                <TableCell colSpan={4}>Less S.24 mortgage-interest credit</TableCell>
                <TableCell align="right">-{formatCurrency(data.incomeTax.financeCostReducer)}</TableCell>
              </TableRow>
              <TableRow>
                <TableCell colSpan={4}><strong>Total income tax</strong></TableCell>
                <TableCell align="right"><strong>{formatCurrency(data.incomeTax.liability)}</strong></TableCell>
              </TableRow>
            </TableBody>
          </Table>
        )}

        {/* ---- Self Assessment ---- */}
        <SectionHeading>Self Assessment and payments on account</SectionHeading>
        <Typography variant="body2" sx={{ mb: 1 }}>
          {sa.isRefund
            ? `Income tax is ${formatCurrency(data.incomeTax.liability)} and PAYE paid is ${formatCurrency(sa.payeTaxPaid)}, so a repayment of ${formatCurrency(sa.refundDue)} is likely.`
            : `Income tax ${formatCurrency(data.incomeTax.liability)} less PAYE ${formatCurrency(sa.payeTaxPaid)} leaves ${formatCurrency(sa.amountDue)} to pay by ${sa.deadline}.`}
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mb: poa.required ? 1 : 0 }}>{poa.reason}</Typography>
        {poa.required && (
          <Table size="small">
            <TableBody>
              {poa.instalments.map((p, i) => (
                <TableRow key={p.dueDate}>
                  <TableCell>Payment on account {i + 1}</TableCell>
                  <TableCell>{p.dueDate}</TableCell>
                  <TableCell align="right">{formatCurrency(p.amount)}</TableCell>
                </TableRow>
              ))}
              <TableRow>
                <TableCell colSpan={2}><strong>Due on {sa.deadline} (balance + first payment)</strong></TableCell>
                <TableCell align="right"><strong>{formatCurrency(poa.dueOnDeadline)}</strong></TableCell>
              </TableRow>
            </TableBody>
          </Table>
        )}

        {/* ---- MTD ---- */}
        <SectionHeading>Making Tax Digital</SectionHeading>
        <Stack direction="row" spacing={1} alignItems="flex-start">
          <Chip size="small" color={mtdColor} label={mtdLabel} />
          <Typography variant="body2">{data.mtd.summary}</Typography>
        </Stack>

        {/* ---- How each property is let ---- */}
        {data.properties.length > 0 && (
          <>
            <SectionHeading>How each property is let</SectionHeading>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>Property</TableCell>
                  <TableCell align="right">Share</TableCell>
                  <TableCell align="right">Gross income</TableCell>
                  <TableCell>Letting type</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {data.properties.map(p => (
                  <TableRow key={p.propertyId}>
                    <TableCell>{p.propertyName}</TableCell>
                    <TableCell align="right">{parseFloat(p.allocationPct)}%</TableCell>
                    <TableCell align="right">{formatCurrency(p.grossIncome)}</TableCell>
                    <TableCell>
                      <Select
                        size="small"
                        value={p.lettingType}
                        onChange={e => handleLettingType(p.propertyId, e.target.value)}
                        inputProps={{ 'aria-label': `Letting type for ${p.propertyName}` }}
                      >
                        <MenuItem value="standard">{LETTING_LABEL.standard}</MenuItem>
                        <MenuItem value="rent_a_room">{LETTING_LABEL.rent_a_room}</MenuItem>
                      </Select>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </>
        )}

        {/* ---- Tax profile form ---- */}
        <SectionHeading>Tax profile for {data.taxYear}</SectionHeading>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          Things the ledger can&apos;t know. Enter whole-year figures for {data.owner.name}.
          {!data.profileSaved && ' Nothing has been saved for this year yet.'}
        </Typography>
        <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, 1fr)', md: 'repeat(4, 1fr)' }, gap: 2 }}>
          {FORM_FIELDS.map(f => (
            <TextField
              key={f.name}
              size="small"
              label={f.label}
              helperText={f.help}
              value={valueOf(f.name)}
              onChange={e => setDraft(d => ({ ...d, [f.name]: e.target.value }))}
              disabled={!profile}
              slotProps={{
                input: { startAdornment: <InputAdornment position="start">£</InputAdornment> },
                htmlInput: { inputMode: 'decimal' },
              }}
            />
          ))}
        </Box>
        <TextField
          size="small"
          label="Notes"
          fullWidth
          multiline
          minRows={2}
          sx={{ mt: 2 }}
          value={valueOf('notes')}
          onChange={e => setDraft(d => ({ ...d, notes: e.target.value }))}
          disabled={!profile}
        />
        {formError && <Alert severity="error" sx={{ mt: 2 }}>{formError}</Alert>}
        <Stack direction="row" spacing={2} alignItems="center" sx={{ mt: 2 }}>
          <Button variant="contained" size="small" startIcon={<SaveIcon />} onClick={handleSave} disabled={!dirty || saving || !profile}>
            {saving ? 'Saving…' : 'Save and recalculate'}
          </Button>
          {savedNote && !dirty && <Typography variant="caption" color="success.main">Saved</Typography>}
        </Stack>

        {/* ---- Working ---- */}
        <Accordion disableGutters variant="outlined" sx={{ mt: 3 }}>
          <AccordionSummary expandIcon={<ExpandMoreIcon />}>
            <Typography variant="subtitle2">Step-by-step working</Typography>
          </AccordionSummary>
          <AccordionDetails>
            <Table size="small">
              <TableBody>
                {data.breakdown.map((line, i) => (
                  <TableRow key={i}>
                    <TableCell sx={{ whiteSpace: 'nowrap', color: 'text.secondary', verticalAlign: 'top' }}>{line.section}</TableCell>
                    <TableCell>{line.text}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            <Typography variant="caption" color="text.secondary" display="block" sx={{ mt: 1 }}>
              Rates from GOV.UK: {data.rates.sources.slice(0, 3).join(', ')}
              {data.rates.sources.length > 3 ? ` and ${data.rates.sources.length - 3} more.` : '.'}
            </Typography>
          </AccordionDetails>
        </Accordion>
      </CardContent>
    </Card>
  );
}
