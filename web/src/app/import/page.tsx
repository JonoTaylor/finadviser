'use client';

import { useState, useCallback } from 'react';
import {
  Box, Typography, Stepper, Step, StepLabel, Card, CardContent,
  Button, Stack, Alert,
} from '@mui/material';
import useSWR from 'swr';
import FileUploadStep from '@/components/import/FileUploadStep';
import ConfigStep from '@/components/import/ConfigStep';
import PreviewTable from '@/components/import/PreviewTable';

const fetcher = (url: string) => fetch(url).then(r => r.json());

const CSV_STEPS = ['Upload File', 'Configure', 'Preview & Import'];
const PDF_STEPS = ['Upload File', 'Preview & Import'];

export default function ImportPage() {
  const [activeStep, setActiveStep] = useState(0);
  const [file, setFile] = useState<File | null>(null);
  const [fileType, setFileType] = useState<'csv' | 'pdf'>('csv');
  const [csvContent, setCsvContent] = useState('');
  const [bankConfig, setBankConfig] = useState('generic-csv');
  const [accountName, setAccountName] = useState('Bank');
  const [preview, setPreview] = useState<Array<Record<string, unknown>> | null>(null);
  const [skipped, setSkipped] = useState<Array<{ rowNumber: number; reason: string }>>([]);
  const [importing, setImporting] = useState(false);
  const [result, setResult] = useState<{
    importedCount: number;
    duplicateCount: number;
    skippedCount?: number;
    totalCount: number;
    skipped?: Array<{ rowNumber: number; reason: string }>;
  } | null>(null);
  const [error, setError] = useState('');

  const { data: bankConfigs } = useSWR('/api/import/bank-configs', fetcher);
  const { data: accounts } = useSWR('/api/accounts', fetcher);

  const steps = fileType === 'pdf' ? PDF_STEPS : CSV_STEPS;

  const handleFileSelect = useCallback(async (f: File) => {
    setFile(f);
    setError('');
    const isPdf = f.name.toLowerCase().endsWith('.pdf');
    setFileType(isPdf ? 'pdf' : 'csv');

    if (isPdf) {
      // PDF: skip config, go straight to preview via AI parsing
      try {
        const formData = new FormData();
        formData.append('file', f);
        formData.append('bankConfig', 'pdf');
        formData.append('accountName', accountName);

        const res = await fetch('/api/import/preview', { method: 'POST', body: formData });
        if (!res.ok) {
          const err = await res.json();
          throw new Error(err.error || 'PDF preview failed');
        }
        const data = await res.json();
        setPreview(data.transactions ?? []);
        setSkipped(data.skipped ?? []);
        setActiveStep(1); // PDF step 1 = Preview
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Failed to parse PDF');
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
    try {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('bankConfig', bankConfig);
      formData.append('accountName', accountName);

      const res = await fetch('/api/import/preview', { method: 'POST', body: formData });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || 'Preview failed');
      }
      const data = await res.json();
      setPreview(data.transactions ?? []);
      setSkipped(data.skipped ?? []);
      setActiveStep(2);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Preview failed');
    }
  }, [file, bankConfig, accountName]);

  const handleImport = useCallback(async () => {
    setImporting(true);
    setError('');
    try {
      let res: Response;
      if (fileType === 'pdf') {
        // PDF: send pre-parsed transactions
        res = await fetch('/api/import/confirm', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ parsedTransactions: preview, accountName }),
        });
      } else {
        // CSV: send raw content for server-side parsing
        res = await fetch('/api/import/confirm', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ csvContent, bankConfig, accountName }),
        });
      }
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || 'Import failed');
      }
      const data = await res.json();
      setResult(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Import failed');
    } finally {
      setImporting(false);
    }
  }, [fileType, csvContent, bankConfig, accountName, preview]);

  const handleReset = () => {
    setActiveStep(0);
    setFile(null);
    setFileType('csv');
    setCsvContent('');
    setPreview(null);
    setSkipped([]);
    setResult(null);
    setError('');
  };

  // Determine if we're on the preview step
  const isPreviewStep = fileType === 'pdf' ? activeStep === 1 : activeStep === 2;

  return (
    <Box>
      <Box sx={{ mb: 4 }}>
        <Typography variant="h4">Import Transactions</Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
          Upload CSV files or PDF bank statements to import transactions
        </Typography>
      </Box>

      <Stepper activeStep={activeStep} sx={{ mb: 4 }}>
        {steps.map(label => (
          <Step key={label}><StepLabel>{label}</StepLabel></Step>
        ))}
      </Stepper>

      {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}

      {result ? (
        <Card>
          <CardContent>
            <Alert severity="success" sx={{ mb: 2 }}>Import complete!</Alert>
            <Typography>Imported: {result.importedCount}</Typography>
            <Typography>Duplicates skipped: {result.duplicateCount}</Typography>
            {typeof result.skippedCount === 'number' && result.skippedCount > 0 && (
              <Typography>Rows skipped (parse errors): {result.skippedCount}</Typography>
            )}
            <Typography>Total rows: {result.totalCount}</Typography>
            {result.skipped && result.skipped.length > 0 && (
              <Alert severity="warning" sx={{ mt: 2 }}>
                <Typography variant="subtitle2" sx={{ mb: 1 }}>
                  {result.skipped.length} row(s) could not be parsed:
                </Typography>
                <Box component="ul" sx={{ m: 0, pl: 3 }}>
                  {result.skipped.slice(0, 10).map((s) => (
                    <li key={s.rowNumber}>
                      Row {s.rowNumber}: {s.reason}
                    </li>
                  ))}
                  {result.skipped.length > 10 && (
                    <li>... and {result.skipped.length - 10} more</li>
                  )}
                </Box>
              </Alert>
            )}
            <Button variant="contained" sx={{ mt: 2 }} onClick={handleReset}>
              Import Another
            </Button>
          </CardContent>
        </Card>
      ) : (
        <>
          {activeStep === 0 && <FileUploadStep onFileSelect={handleFileSelect} />}

          {activeStep === 1 && fileType === 'csv' && (
            <ConfigStep
              bankConfig={bankConfig}
              accountName={accountName}
              bankConfigs={bankConfigs ?? {}}
              accounts={accounts ?? []}
              onBankConfigChange={setBankConfig}
              onAccountNameChange={setAccountName}
              onNext={handleConfigure}
              onBack={() => setActiveStep(0)}
            />
          )}

          {isPreviewStep && preview && (
            <Box>
              {skipped.length > 0 && (
                <Alert severity="warning" sx={{ mb: 2 }}>
                  <Typography variant="subtitle2" sx={{ mb: 1 }}>
                    {skipped.length} row(s) skipped during parsing:
                  </Typography>
                  <Box component="ul" sx={{ m: 0, pl: 3 }}>
                    {skipped.slice(0, 10).map((s) => (
                      <li key={s.rowNumber}>
                        Row {s.rowNumber}: {s.reason}
                      </li>
                    ))}
                    {skipped.length > 10 && (
                      <li>... and {skipped.length - 10} more</li>
                    )}
                  </Box>
                </Alert>
              )}
              <PreviewTable transactions={preview} />
              <Stack direction="row" spacing={2} sx={{ mt: 2 }}>
                <Button onClick={() => { setActiveStep(0); setPreview(null); setSkipped([]); }}>Back</Button>
                <Button variant="contained" onClick={handleImport} disabled={importing}>
                  {importing ? 'Importing...' : 'Confirm Import'}
                </Button>
              </Stack>
            </Box>
          )}
        </>
      )}
    </Box>
  );
}
