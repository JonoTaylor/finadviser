'use client';

import { Accordion, AccordionDetails, AccordionSummary, Alert, Box, Chip, CircularProgress, Divider, Stack, Typography } from '@mui/material';
import ExpandMoreRoundedIcon from '@mui/icons-material/ExpandMoreRounded';
import type { SpecialistId } from '@/lib/ai/specialists/catalog';
import type { SpecialistResult, SpecialistEvidence } from '@/lib/ai/specialists/contracts';
import { adviserModeName, SpecialistIcon } from './SpecialistTeamSelector';

const STATUS = { complete: 'Reviewed', partial: 'Needs information', unavailable: 'Unavailable', cancelled: 'Stopped' } as const;
const SOURCE_LABELS: Record<string, string> = {
  get_data_intelligence: 'Data coverage', get_finance_workspace: 'Financial workspace', get_financial_plan: 'Financial plan',
  get_financial_identity: 'Personal owner selection', get_owner_tax_profile: 'Tax profile', get_owner_tax_computation: 'Tax computation',
  get_account_balances: 'Recorded account balances', get_monthly_spending: 'Monthly spending', get_income_expense_summary: 'Income and expenses',
  get_debt_summary: 'Recorded debt details', list_investments: 'Investment records', search_transactions: 'Recorded transactions',
};
function sourceName(source: SpecialistEvidence) {
  return SOURCE_LABELS[source.tool] ?? source.tool.replace(/^(get|list)_/, '').replace(/_/g, ' ');
}
function sourceScope(source: SpecialistEvidence): string {
  const values = source.parameters;
  return [values.tax_year ?? values.year, values.start_date, values.end_date].filter(value => typeof value === 'string').join(' · ');
}
function sourceDate(value: string) {
  return new Date(value).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/London' });
}

export default function SpecialistReviews({ results, pending = [] }: { results: SpecialistResult[]; pending?: SpecialistId[] }) {
  if (results.length === 0 && pending.length === 0) return null;
  return <Box component="section" aria-label="Specialist reviews" sx={{ mt: 1.5, minWidth: 0 }}>
    <Stack direction="row" gap={0.75} flexWrap="wrap" alignItems="center" sx={{ mb: 1 }}>
      {pending.map(id => <Chip key={id} size="small" variant="outlined" icon={<CircularProgress size={12} />} label={`${adviserModeName(id)} reviewing`} />)}
      {results.map(result => <Chip key={result.specialistId} size="small" variant="outlined"
        icon={<SpecialistIcon specialistId={result.specialistId} />}
        color={result.status === 'complete' ? 'default' : result.status === 'partial' ? 'warning' : 'default'}
        label={`${result.name} · ${STATUS[result.status]}`} />)}
    </Stack>
    {results.length > 0 && <Accordion disableGutters elevation={0} variant="outlined" sx={{ minWidth: 0, borderRadius: '6px', '&::before': { display: 'none' } }}>
      <AccordionSummary expandIcon={<ExpandMoreRoundedIcon />}><Typography variant="body2" fontWeight={600}>Review the specialist findings</Typography></AccordionSummary>
      <AccordionDetails sx={{ pt: 0, minWidth: 0 }}>
        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 2 }}>These reviews reflect the records at the shown read times, before any later adviser actions. A finished review does not mean every financial record is complete. Specialists do not change your records.</Typography>
        <Stack spacing={2} divider={<Divider />}>
          {results.map(result => <Box key={result.specialistId} sx={{ minWidth: 0, overflowWrap: 'anywhere' }}>
            <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 1 }}><Box sx={{ color: 'primary.main', display: 'flex' }}><SpecialistIcon specialistId={result.specialistId} /></Box><Typography variant="subtitle2">{result.name}</Typography><Chip size="small" label={STATUS[result.status]} variant="outlined" /></Stack>
            {result.message && <Alert severity={result.status === 'complete' ? 'info' : 'warning'} sx={{ mb: 1 }}>{result.message}</Alert>}
            {result.report && <>
              <Typography variant="body2" sx={{ mb: 1.5, whiteSpace: 'pre-wrap' }}>{result.report.summary}</Typography>
              {result.report.findings.length > 0 && <Box sx={{ mb: 1.5 }}>
                <Typography variant="caption" fontWeight={600}>Findings</Typography>
                <Stack spacing={1} sx={{ mt: 0.75 }}>{result.report.findings.map((finding, index) => <Box key={index}>
                  <Typography variant="body2" fontWeight={600}>{finding.title}</Typography>
                  <Typography variant="body2" color="text.secondary" sx={{ whiteSpace: 'pre-wrap' }}>{finding.detail}</Typography>
                  {finding.evidenceIds.length > 0 && <Typography variant="caption" color="text.secondary">Based on: {finding.evidenceIds.map(id => { const source = result.sources.find(item => item.id === id); return source ? sourceName(source) : 'Source unavailable'; }).join(', ')}</Typography>}
                </Box>)}</Stack>
              </Box>}
              {result.report.gaps.length > 0 && <Alert severity="info" sx={{ mb: 1.5 }}>
                <Typography variant="body2" fontWeight={600}>What still needs confirming</Typography>
                {result.report.gaps.map((gap, index) => <Typography key={index} variant="body2" sx={{ mt: 0.5 }}><strong>{gap.field}:</strong> {gap.why}</Typography>)}
              </Alert>}
              {result.report.actions.length > 0 && <Box sx={{ mb: 1.5 }}><Typography variant="caption" fontWeight={600}>Suggested next steps</Typography>
                <Box component="ol" sx={{ pl: 2.5, mt: 0.75, mb: 0 }}>{result.report.actions.map((action, index) => <Box component="li" key={index} sx={{ mb: 0.75 }}><Typography variant="body2" fontWeight={600}>{action.title}</Typography><Typography variant="body2" color="text.secondary">{action.reason}</Typography></Box>)}</Box>
              </Box>}
              {result.report.assumptions.length > 0 && <Box sx={{ mb: 1.5 }}><Typography variant="caption" fontWeight={600}>Assumptions</Typography>{result.report.assumptions.map((assumption, index) => <Typography key={index} variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>{assumption}</Typography>)}</Box>}
              {result.report.warnings.length > 0 && <Alert severity="warning" sx={{ mb: 1.5 }}>{result.report.warnings.map((warning, index) => <Typography key={index} variant="body2" sx={{ mt: index ? 0.5 : 0 }}>{warning}</Typography>)}</Alert>}
            </>}
            {result.sources.length > 0 && <Box sx={{ mt: 1.5 }}>
              <Typography variant="caption" fontWeight={600}>Evidence read for this review</Typography>
              {result.sources.map(source => <Stack key={source.id} direction={{ xs: 'column', sm: 'row' }} gap={0.5} justifyContent="space-between" sx={{ py: 0.5 }}>
                <Typography variant="caption">{sourceName(source)}{sourceScope(source) ? ` · ${sourceScope(source)}` : ''}</Typography>
                <Typography variant="caption" color="text.secondary">{source.status === 'available' ? source.truncated ? 'Partial source read' : 'Read' : 'Unavailable'} · {sourceDate(source.observedAt)}</Typography>
              </Stack>)}
              <Typography variant="caption" color="text.secondary">A source being read does not confirm that its underlying records are complete.</Typography>
            </Box>}
          </Box>)}
        </Stack>
      </AccordionDetails>
    </Accordion>}
  </Box>;
}
