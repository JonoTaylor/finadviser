'use client';

import { useState, type ReactNode } from 'react';
import { Alert, Box, Typography, Card, CardContent, Button, Stack, Divider } from '@mui/material';
import DownloadRoundedIcon from '@mui/icons-material/DownloadRounded';
import AutoAwesomeRoundedIcon from '@mui/icons-material/AutoAwesomeRounded';
import CurrencyPoundRoundedIcon from '@mui/icons-material/CurrencyPoundRounded';
import MemoryRoundedIcon from '@mui/icons-material/MemoryRounded';
import AccountBalanceRoundedIcon from '@mui/icons-material/AccountBalanceRounded';
import LinkRoundedIcon from '@mui/icons-material/LinkRounded';
import Link from 'next/link';
import RulesManager from '@/components/settings/RulesManager';
import AiModelSelector from '@/components/settings/AiModelSelector';
import AiMemoryManager from '@/components/settings/AiMemoryManager';
import BankCoverageCard from '@/components/banking/BankCoverageCard';
import PageHeader from '@/components/ui/PageHeader';
import { designTokens } from '@/theme/theme';

export default function SettingsPage() {
  const [exporting, setExporting] = useState<string | null>(null);
  const [exportError, setExportError] = useState('');

  const handleExport = async (path: string, filename: string) => {
    if (exporting) return;
    setExporting(path);
    setExportError('');
    try {
      const response = await fetch(path);
      if (!response.ok) {
        const body = await response.json().catch(() => null);
        throw new Error(typeof body?.error === 'string' ? body.error : 'The export could not be prepared. Please retry.');
      }
      const downloadUrl = URL.createObjectURL(await response.blob());
      const anchor = document.createElement('a');
      anchor.href = downloadUrl;
      anchor.download = filename;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      window.setTimeout(() => URL.revokeObjectURL(downloadUrl), 1_000);
    } catch (error) {
      setExportError(error instanceof Error ? error.message : 'The export could not be prepared. Please retry.');
    } finally {
      setExporting(null);
    }
  };

  return (
    <Box>
      <PageHeader eyebrow="Your workspace" title="Settings" description="Manage your connections, personalise your adviser and export your data." />
      <Stack spacing={3}>
        <SettingsCard icon={<AccountBalanceRoundedIcon />} title="Bank connections">
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            Connect your banks and credit cards, match them to your accounts, and update transactions when you need to.
            Your provider will let you know when consent needs renewing.
          </Typography>
          <Button component={Link} href="/settings/connections" variant="outlined" startIcon={<LinkRoundedIcon />}>
            Manage connections
          </Button>
        </SettingsCard>

        <BankCoverageCard />

        <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', lg: '1fr 1fr' }, gap: 3, alignItems: 'start' }}>
          <SettingsCard icon={<AutoAwesomeRoundedIcon />} title="Adviser model"><AiModelSelector /></SettingsCard>
          <SettingsCard icon={<MemoryRoundedIcon />} title="Adviser memory"><AiMemoryManager /></SettingsCard>
        </Box>

        <RulesManager />

        <SettingsCard icon={<DownloadRoundedIcon />} title="Export your data">
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            Download transaction records or your saved financial planning workspaces.
          </Typography>
          {exportError && <Alert severity="error" sx={{ mb: 2 }}>Export unavailable. {exportError}</Alert>}
          <Stack direction="row" gap={1} flexWrap="wrap">
            <Button variant="outlined" startIcon={<DownloadRoundedIcon />} disabled={!!exporting} onClick={() => handleExport('/api/export/csv', 'finadviser-transactions.csv')}>
              {exporting === '/api/export/csv' ? 'Preparing…' : 'Transaction CSV'}
            </Button>
            <Button variant="outlined" startIcon={<DownloadRoundedIcon />} disabled={!!exporting} onClick={() => handleExport('/api/export/json', 'finadviser-export.json')}>
              {exporting === '/api/export/json' ? 'Preparing…' : 'Accounts & transactions'}
            </Button>
            <Button variant="outlined" startIcon={<DownloadRoundedIcon />} disabled={!!exporting} onClick={() => handleExport('/api/finance/export', 'finadviser-planning.json')}>
              {exporting === '/api/finance/export' ? 'Preparing…' : 'Planning workspace'}
            </Button>
          </Stack>
          <Typography variant="caption" color="text.secondary" sx={{ mt: 2, display: 'block' }}>
            Transaction exports include up to 10,000 journal records. Planning exports are separate.
            Documents and bank credentials are excluded; these files are not a complete backup.
          </Typography>
        </SettingsCard>

        <Card><CardContent>
          <Stack direction={{ xs: 'column', sm: 'row' }} gap={2} justifyContent="space-between">
            <Box>
              <Stack direction="row" gap={1} alignItems="center" sx={{ mb: 0.75 }}><CurrencyPoundRoundedIcon sx={{ fontSize: 18, color: designTokens.muted }} /><Typography variant="subtitle2">Reporting currency</Typography></Stack>
              <Typography variant="body2" color="text.secondary">British pounds (£ GBP)</Typography>
            </Box>
            <Box sx={{ maxWidth: 480 }}>
              <Typography variant="subtitle2" sx={{ mb: 0.75 }}>FinAdviser</Typography>
              <Typography variant="body2" color="text.secondary">Your personal financial workspace for spending, wealth and the decisions ahead.</Typography>
            </Box>
          </Stack>
          <Divider sx={{ my: 2 }} />
          <Box component="details" sx={{ color: designTokens.muted, fontSize: '0.75rem', '& summary': { cursor: 'pointer', width: 'fit-content' } }}>
            <Box component="summary">Workspace configuration</Box>
            <Typography variant="caption" sx={{ display: 'block', mt: 1 }}>This workspace uses PostgreSQL via Neon. Hosting administrators manage its database connection and default AI configuration.</Typography>
          </Box>
        </CardContent></Card>
      </Stack>
    </Box>
  );
}

function SettingsCard({ icon, title, children }: { icon: ReactNode; title: string; children: ReactNode }) {
  return <Card><CardContent>
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.25, mb: 2 }}>
      <Box sx={{ width: 32, height: 32, borderRadius: '7px', display: 'grid', placeItems: 'center', backgroundColor: '#F1F5F9', color: designTokens.secondary, '& svg': { fontSize: 18 } }}>{icon}</Box>
      <Typography variant="h6">{title}</Typography>
    </Box>
    {children}
  </CardContent></Card>;
}
