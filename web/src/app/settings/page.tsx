'use client';

import { Box, Typography, Card, CardContent, Button, Stack, Chip, Divider } from '@mui/material';
import { alpha } from '@mui/material/styles';
import DownloadRoundedIcon from '@mui/icons-material/DownloadRounded';
import KeyRoundedIcon from '@mui/icons-material/KeyRounded';
import CurrencyPoundRoundedIcon from '@mui/icons-material/CurrencyPoundRounded';
import StorageRoundedIcon from '@mui/icons-material/StorageRounded';
import InfoRoundedIcon from '@mui/icons-material/InfoRounded';
import RulesManager from '@/components/settings/RulesManager';

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
        <SettingsCard
          icon={<KeyRoundedIcon />}
          iconColor="#60A5FA"
          title="API Configuration"
        >
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <Typography variant="body2" color="text.secondary">Anthropic API Key:</Typography>
            <Chip label="Configured server-side" size="small" color="info" variant="outlined" />
          </Box>
          <Typography variant="caption" color="text.secondary" sx={{ mt: 1, display: 'block' }}>
            Set ANTHROPIC_API_KEY in your Vercel environment variables.
          </Typography>
        </SettingsCard>

        <SettingsCard
          icon={<CurrencyPoundRoundedIcon />}
          iconColor="#FB923C"
          title="Currency"
        >
          <Typography variant="body2" color="text.secondary">
            Default currency symbol: £ (GBP)
          </Typography>
        </SettingsCard>

        <RulesManager />

        <SettingsCard
          icon={<StorageRoundedIcon />}
          iconColor="#4ADE80"
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
          iconColor="#818CF8"
          title="About"
        >
          <Typography variant="body2" fontWeight={600}>FinAdviser v0.1.0</Typography>
          <Typography variant="body2" color="text.secondary">
            Personal financial adviser with AI-powered insights.
          </Typography>
          <Divider sx={{ my: 1 }} />
          <Typography variant="caption" color="text.secondary">
            Built with Next.js, Material UI, Drizzle ORM, and Anthropic Claude.
          </Typography>
        </SettingsCard>
      </Stack>
    </Box>
  );
}

function SettingsCard({
  icon,
  iconColor,
  title,
  children,
}: {
  icon: React.ReactNode;
  iconColor: string;
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
              bgcolor: alpha(iconColor, 0.12),
              color: iconColor,
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
