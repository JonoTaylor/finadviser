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

const steps = ['Upload CSV', 'Configure', 'Preview & Import'];

export default function ImportPage() {
  const [activeStep, setActiveStep] = useState(0);
  const [file, setFile] = useState<File | null>(null);
  const [csvContent, setCsvContent] = useState('');
  const [bankConfig, setBankConfig] = useState('generic-csv');
  const [accountName, setAccountName] = useState('Bank');
  const [preview, setPreview] = useState<Array<Record<string, unknown>> | null>(null);
  const [importing, setImporting] = useState(false);
  const [result, setResult] = useState<{ importedCount: number; duplicateCount: number; totalCount: number } | null>(null);
  const [error, setError] = useState('');

  const { data: bankConfigs } = useSWR('/api/import/bank-configs', fetcher);
  const { data: accounts } = useSWR('/api/accounts', fetcher);

  const handleFileSelect = useCallback(async (f: File) => {
    setFile(f);
    const content = await f.text();
    setCsvContent(content);
    setActiveStep(1);
  }, []);

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
      setPreview(data);
      setActiveStep(2);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Preview failed');
    }
  }, [file, bankConfig, accountName]);

  const handleImport = useCallback(async () => {
    setImporting(true);
    setError('');
    try {
      const res = await fetch('/api/import/confirm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ csvContent, bankConfig, accountName }),
      });
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
  }, [csvContent, bankConfig, accountName]);

  const handleReset = () => {
    setActiveStep(0);
    setFile(null);
    setCsvContent('');
    setPreview(null);
    setResult(null);
    setError('');
  };

  return (
    <Box>
      <Box sx={{ mb: 4 }}>
        <Typography variant="h4">Import Transactions</Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
          Upload CSV files from your bank to import transactions
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
            <Typography>Total rows: {result.totalCount}</Typography>
            <Button variant="contained" sx={{ mt: 2 }} onClick={handleReset}>
              Import Another
            </Button>
          </CardContent>
        </Card>
      ) : (
        <>
          {activeStep === 0 && <FileUploadStep onFileSelect={handleFileSelect} />}

          {activeStep === 1 && (
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

          {activeStep === 2 && preview && (
            <Box>
              <PreviewTable transactions={preview} />
              <Stack direction="row" spacing={2} sx={{ mt: 2 }}>
                <Button onClick={() => setActiveStep(1)}>Back</Button>
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
