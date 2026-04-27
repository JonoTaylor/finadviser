'use client';

import { Box, Typography, Card, CardContent, Button, Stack, Divider } from '@mui/material';
import DownloadRoundedIcon from '@mui/icons-material/DownloadRounded';
import KeyRoundedIcon from '@mui/icons-material/KeyRounded';
import CurrencyPoundRoundedIcon from '@mui/icons-material/CurrencyPoundRounded';
import StorageRoundedIcon from '@mui/icons-material/StorageRounded';
import InfoRoundedIcon from '@mui/icons-material/InfoRounded';
import MemoryRoundedIcon from '@mui/icons-material/MemoryRounded';
import AccountBalanceRoundedIcon from '@mui/icons-material/AccountBalanceRounded';
import LinkRoundedIcon from '@mui/icons-material/LinkRounded';
import Link from 'next/link';
import RulesManager from '@/components/settings/RulesManager';
import AiModelSelector from '@/components/settings/AiModelSelector';
import AiMemoryManager from '@/components/settings/AiMemoryManager';
import BankCoverageCard from '@/components/banking/BankCoverageCard';
import { softTokens } from '@/theme/theme';

export default function SettingsPage() {
  const handleExportCSV = () => { window.open('/api/export/csv', '_blank'); };
  const handleExportJSON = () => { window.open('/api/export/json', '_blank'); };

  return (
    <Box>
      <Box sx={{ mb: 4 }}>
        <Typography variant="h4">Settings</Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
          Configure your FinAdviser instance
        </Typography>
      </Box>

      <Stack spacing={2.5}>
        <BankCoverageCard />

        <SettingsCard
          icon={<AccountBalanceRoundedIcon />}
          tile={softTokens.lavender.main}
          ink={softTokens.lavender.ink}
          title="Bank connections"
        >
          <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
            Manage live data feeds from your banks and credit cards. Connect a provider, map its
            accounts to existing ones, sync transactions on demand. Reconsent every 90 days per PSD2.
          </Typography>
          <Button
            component={Link}
            href="/settings/connections"
            size="small"
            variant="outlined"
            startIcon={<LinkRoundedIcon />}
          >
            Manage connections
          </Button>
        </SettingsCard>

        <SettingsCard
          icon={<KeyRoundedIcon />}
          tile={softTokens.lavender.main}
          ink={softTokens.lavender.ink}
          title="AI Model"
        >
          <AiModelSelector />
          <Box sx={{ mt: 2 }}>
            <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
              Auth: <code>AI_GATEWAY_API_KEY</code> in Vercel env. The selection above persists to
              the database; <code>MODEL_ID</code> env is the fallback if no row exists.
            </Typography>
          </Box>
        </SettingsCard>

        <SettingsCard
          icon={<MemoryRoundedIcon />}
          tile={softTokens.lavender.main}
          ink={softTokens.lavender.ink}
          title="AI Memory"
        >
          <AiMemoryManager />
        </SettingsCard>

        <SettingsCard
          icon={<CurrencyPoundRoundedIcon />}
          tile={softTokens.lemon.main}
          ink={softTokens.lemon.ink}
          title="Currency"
        >
          <Typography variant="body2" color="text.secondary">
            Default currency symbol: £ (GBP)
          </Typography>
        </SettingsCard>

        <RulesManager />

        <SettingsCard
          icon={<StorageRoundedIcon />}
          tile={softTokens.mint.main}
          ink={softTokens.mint.ink}
          title="Database"
        >
          <Typography variant="body2" color="text.secondary">
            PostgreSQL via Vercel Postgres (Neon)
          </Typography>
          <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.5 }}>
            DATABASE_URL configured via Vercel integration.
          </Typography>
        </SettingsCard>

        <Card>
          <CardContent>
            <Typography variant="h6" gutterBottom>Export Data</Typography>
            <Stack direction="row" spacing={1.5} sx={{ mt: 1 }}>
              <Button variant="outlined" startIcon={<DownloadRoundedIcon />} onClick={handleExportCSV}>
                Export CSV
              </Button>
              <Button variant="outlined" startIcon={<DownloadRoundedIcon />} onClick={handleExportJSON}>
                Export JSON
              </Button>
            </Stack>
          </CardContent>
        </Card>

        <SettingsCard
          icon={<InfoRoundedIcon />}
          tile={softTokens.fog}
          ink={softTokens.lavender.ink}
          title="About"
        >
          <Typography variant="body2" fontWeight={600}>FinAdviser v0.1.0</Typography>
          <Typography variant="body2" color="text.secondary">
            Personal financial adviser with AI-powered insights.
          </Typography>
          <Divider sx={{ my: 1 }} />
          <Typography variant="caption" color="text.secondary">
            Built with Next.js, Material UI, Drizzle ORM, and the Vercel AI Gateway.
          </Typography>
        </SettingsCard>
      </Stack>
    </Box>
  );
}

function SettingsCard({
  icon,
  tile,
  ink,
  title,
  children,
}: {
  icon: React.ReactNode;
  tile: string;
  ink: string;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <Card>
      <CardContent>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, mb: 1.5 }}>
          <Box
            sx={{
              width: 36, height: 36, borderRadius: 2.5,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              bgcolor: tile,
              color: ink,
              '& svg': { fontSize: 20 },
            }}
          >
            {icon}
          </Box>
          <Typography variant="h6">{title}</Typography>
        </Box>
        {children}
      </CardContent>
    </Card>
  );
}
