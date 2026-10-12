'use client';

import { useState, useCallback } from 'react';
import {
  Box, Typography, Stepper, Step, StepLabel, Card, CardContent,
  Button, Stack, Alert, Accordion, AccordionSummary, AccordionDetails,
} from '@mui/material';
import ExpandMoreRoundedIcon from '@mui/icons-material/ExpandMoreRounded';
import PageHeader from '@/components/ui/PageHeader';
import { fetchJson } from '@/lib/http/client';
import useSWR, { useSWRConfig } from 'swr';
import FileUploadStep from '@/components/import/FileUploadStep';
import ConfigStep from '@/components/import/ConfigStep';
import PreviewTable from '@/components/import/PreviewTable';
import ImportProgress from '@/components/import/ImportProgress';
import BackfillMetadataCard from '@/components/import/BackfillMetadataCard';
import { consumeNdjsonImport } from '@/lib/import/stream-client';
import type { ProgressEvent } from '@/lib/import/stream';
import type { ProcessedImportResult } from '@/lib/import/import-pipeline';
import ImportProcessingSummary from '@/components/data/ImportProcessingSummary';
import { isFinancialDataKey } from '@/components/data/useDataProcessing';

type ImportAccount = Parameters<typeof ConfigStep>[0]['accounts'][number];
type BankConfigs = Parameters<typeof ConfigStep>[0]['bankConfigs'];
const accountsFetcher = async (url: string): Promise<ImportAccount[]> => {
  const data = await fetchJson<unknown>(url);
  if (!Array.isArray(data)) throw new Error('The account list returned an unreadable response.');
  return data as ImportAccount[];
};
const configsFetcher = async (url: string): Promise<BankConfigs> => {
  const data = await fetchJson<unknown>(url);
  if (!data || typeof data !== 'object' || Array.isArray(data) || Object.values(data).some(config => !config || typeof config.name !== 'string' || typeof config.description !== 'string')) {
    throw new Error('Bank formats returned an unreadable response.');
  }
  return data as BankConfigs;
};

const CSV_STEPS = ['Upload File', 'Configure', 'Preview & Import'];
const PDF_STEPS = ['Upload File', 'Preview & Import'];

export default function ImportPage() {
  const { mutate: refreshFinancialData } = useSWRConfig();
  const [activeStep, setActiveStep] = useState(0);
  const [file, setFile] = useState<File | null>(null);
  const [fileType, setFileType] = useState<'csv' | 'pdf'>('csv');
  const [csvContent, setCsvContent] = useState('');
  const [bankConfig, setBankConfig] = useState('generic-csv');
  // Default kept as 'Bank' so the PDF flow (which skips ConfigStep
  // entirely - handleFileSelect routes straight to /api/import/preview)
  // doesn't 400 on empty accountName. Users on the CSV path see the
  // dropdown with "Bank" pre-selected if such an account exists, or
  // the placeholder otherwise; either way an explicit pick still
  // lands a real account on Preview.
  const [accountName, setAccountName] = useState('Bank');
  const [preview, setPreview] = useState<Array<Record<string, unknown>> | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [importing, setImporting] = useState(false);
  const [progress, setProgress] = useState<ProgressEvent | null>(null);
  const [result, setResult] = useState<ProcessedImportResult | null>(null);
  const [error, setError] = useState('');

  const { data: bankConfigs, error: configsError, isLoading: configsLoading, mutate: mutateConfigs } = useSWR('/api/import/bank-configs', configsFetcher, { shouldRetryOnError: false });
  const { data: accounts, error: accountsError, isLoading: accountsLoading, mutate: mutateAccounts } = useSWR('/api/accounts', accountsFetcher, { shouldRetryOnError: false });

  const steps = fileType === 'pdf' ? PDF_STEPS : CSV_STEPS;

  const handleFileSelect = useCallback(async (f: File) => {
    setFile(f);
    setError('');
    const isPdf = f.name.toLowerCase().endsWith('.pdf');
    setFileType(isPdf ? 'pdf' : 'csv');

    if (isPdf) {
      // PDF: skip config, go straight to preview via AI parsing
      setPreviewing(true);
      setProgress(null);
      try {
        const formData = new FormData();
        formData.append('file', f);
        formData.append('bankConfig', 'pdf');
        formData.append('accountName', accountName);

        const data = await consumeNdjsonImport<Array<Record<string, unknown>>>(
          '/api/import/preview',
          { method: 'POST', body: formData },
          setProgress,
        );
        setPreview(data);
        setActiveStep(1); // PDF step 1 = Preview
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Failed to parse PDF');
      } finally {
        setPreviewing(false);
        setProgress(null);
      }
    } else {
      // CSV: read content and go to config step
      const content = await f.text();
      setCsvContent(content);
      setActiveStep(1); // CSV step 1 = Configure
    }
  }, [accountName]);

  const handleConfigure = useCallback(async () => {
    if (!file) return;
    setError('');
    setPreviewing(true);
    setProgress(null);
    try {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('bankConfig', bankConfig);
      formData.append('accountName', accountName);

      const data = await consumeNdjsonImport<Array<Record<string, unknown>>>(
        '/api/import/preview',
        { method: 'POST', body: formData },
        setProgress,
      );
      setPreview(data);
      setActiveStep(2);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Preview failed');
    } finally {
      setPreviewing(false);
      setProgress(null);
    }
  }, [file, bankConfig, accountName]);

  const handleImport = useCallback(async () => {
    setImporting(true);
    setError('');
    setProgress(null);
    try {
      const init: RequestInit = fileType === 'pdf'
        ? {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ parsedTransactions: preview, accountName }),
          }
        : {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ csvContent, bankConfig, accountName }),
          };

      const data = await consumeNdjsonImport<ProcessedImportResult>(
        '/api/import/confirm',
        init,
        setProgress,
      );
      setResult(data);
      void refreshFinancialData(isFinancialDataKey);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Import failed');
    } finally {
      setImporting(false);
      setProgress(null);
    }
  }, [fileType, csvContent, bankConfig, accountName, preview, refreshFinancialData]);

  const handleReset = () => {
    setActiveStep(0);
    setFile(null);
    setFileType('csv');
    setCsvContent('');
    setPreview(null);
    setResult(null);
    setError('');
    setProgress(null);
  };

  // Determine if we're on the preview step
  const isPreviewStep = fileType === 'pdf' ? activeStep === 1 : activeStep === 2;

  return (
    <Box sx={{ minWidth: 0 }}>
      <PageHeader title="Import transactions" description="Bring your CSV exports and PDF statements into one financial record." actions={activeStep === 0 ? <Button variant="outlined" size="small" onClick={() => document.getElementById('file-upload')?.click()} disabled={previewing || importing}>Choose file</Button> : undefined} />

      <Stepper activeStep={activeStep} alternativeLabel sx={{ mb: 3, '& .MuiStepLabel-label': { fontSize: '0.75rem' }, '& .MuiStepIcon-root': { fontSize: 22 } }}>
        {steps.map(label => (
          <Step key={label}><StepLabel>{label}</StepLabel></Step>
        ))}
      </Stepper>

      {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
      {(accountsError || configsError) && <Alert severity="warning" sx={{ mb: 2 }}>Account choices or bank formats could not be loaded. CSV configuration and metadata enrichment need these lists.<Button size="small" onClick={() => { void mutateAccounts(); void mutateConfigs(); }} sx={{ display: 'block', mt: 0.75 }}>Try again</Button></Alert>}

      {(previewing || importing) && <ImportProgress event={progress} />}

      {result ? (
        <Card>
          <CardContent>
            <Alert severity="success" sx={{ mb: 2 }}>Import complete!</Alert>
            <Typography>Imported: {result.importedCount}</Typography>
            <Typography>Duplicates skipped: {result.duplicateCount}</Typography>
            <Typography>Total rows: {result.totalCount}</Typography>
            <ImportProcessingSummary processing={result.categorization} />
            <Button variant="contained" sx={{ mt: 2 }} onClick={handleReset}>
              Import Another
            </Button>
          </CardContent>
        </Card>
      ) : (
        <>
          {activeStep === 0 && <Box sx={{ '& .MuiCardContent-root > .MuiBox-root': { p: { xs: 3, sm: 5 }, borderRadius: '6px', borderWidth: 1 }, '& .MuiCardContent-root > .MuiBox-root > .MuiBox-root': { width: 44, height: 44, borderRadius: '6px' }, '& .MuiCardContent-root > .MuiBox-root > .MuiBox-root svg': { fontSize: 24 } }}><FileUploadStep onFileSelect={handleFileSelect} /></Box>}

          {activeStep === 1 && fileType === 'csv' && !(accountsError || configsError) && (accountsLoading || configsLoading ? <Card><CardContent><Typography variant="body2" color="text.secondary">Loading account choices and bank formats…</Typography></CardContent></Card> : (
            <ConfigStep
              bankConfig={bankConfig}
              accountName={accountName}
              bankConfigs={bankConfigs ?? {}}
              accounts={accounts ?? []}
              onBankConfigChange={setBankConfig}
              onAccountNameChange={setAccountName}
              onAccountsChanged={() => mutateAccounts()}
              onNext={handleConfigure}
              onBack={() => setActiveStep(0)}
              busy={previewing}
            />
          ))}

          {isPreviewStep && preview && (
            <Box sx={{ minWidth: 0 }}>
              <Box role="region" aria-label="Import preview records" tabIndex={0} sx={{ overflowX: 'auto', maxWidth: '100%', '& .MuiCard-root': { minWidth: 580 } }}><PreviewTable transactions={preview} /></Box>
              <Stack direction="row" spacing={2} flexWrap="wrap" useFlexGap sx={{ mt: 2 }}>
                <Button onClick={() => { setActiveStep(0); setPreview(null); }} disabled={importing}>Back</Button>
                <Button variant="contained" onClick={handleImport} disabled={importing}>
                  {importing ? 'Importing…' : 'Confirm Import'}
                </Button>
              </Stack>
            </Box>
          )}
        </>
      )}

      {/* Separate flow: enrich existing transactions with new metadata
          columns instead of importing fresh ones. Lives below the main
          importer because it's an occasional one-off rather than the
          common path. */}
      <Accordion disableGutters elevation={0} sx={{ mt: 3, border: 1, borderColor: 'divider', borderRadius: '8px', '&:before': { display: 'none' }, overflow: 'hidden' }} slotProps={{ transition: { unmountOnExit: true } }}>
        <AccordionSummary expandIcon={<ExpandMoreRoundedIcon />}><Box><Typography variant="subtitle2" sx={{ color: 'text.primary', fontWeight: 600 }}>Enrich previously imported transactions</Typography><Typography variant="caption">Add missing merchant and transaction details from a fresh CSV export.</Typography></Box></AccordionSummary>
        <AccordionDetails sx={{ p: 0, '& > .MuiCard-root': { mt: 0, border: 0, borderRadius: 0 }, '& .MuiFormControl-root': { minWidth: { xs: '0 !important', sm: '200px !important' }, maxWidth: '100%', flex: { sm: '1 1 200px' } }, '& .MuiCardContent-root > .MuiStack-root': { flexWrap: 'wrap', rowGap: 2 } }}>
          {accountsError || configsError ? <Alert severity="info" sx={{ m: 2 }}>Metadata enrichment is unavailable until your account choices and bank formats can be loaded.</Alert> : accountsLoading || configsLoading ? <Typography variant="body2" sx={{ p: 2 }}>Loading account choices and bank formats…</Typography> : <BackfillMetadataCard accounts={accounts ?? []} bankConfigs={bankConfigs ?? {}} />}
        </AccordionDetails>
      </Accordion>
    </Box>
  );
}
