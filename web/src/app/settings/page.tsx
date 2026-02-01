'use client';

import { Box, Typography, Card, CardContent, Button, Stack, Chip, Divider } from '@mui/material';
import DownloadIcon from '@mui/icons-material/Download';

export default function SettingsPage() {
  const handleExportCSV = () => {
    window.open('/api/export/csv', '_blank');
  };

  const handleExportJSON = () => {
    window.open('/api/export/json', '_blank');
  };

  return (
    <Box>
      <Typography variant="h4" sx={{ mb: 3 }}>Settings</Typography>

      <Stack spacing={3}>
        <Card>
          <CardContent>
            <Typography variant="h6" gutterBottom>API Configuration</Typography>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
              <Typography variant="body2">Anthropic API Key:</Typography>
              <Chip
                label="Configured server-side"
                size="small"
                color="info"
                variant="outlined"
              />
            </Box>
            <Typography variant="caption" color="text.secondary" sx={{ mt: 1, display: 'block' }}>
              Set ANTHROPIC_API_KEY in your Vercel environment variables.
            </Typography>
          </CardContent>
        </Card>

        <Card>
          <CardContent>
            <Typography variant="h6" gutterBottom>Currency</Typography>
            <Typography variant="body2" color="text.secondary">
              Default currency symbol: £ (GBP)
            </Typography>
          </CardContent>
        </Card>

        <Card>
          <CardContent>
            <Typography variant="h6" gutterBottom>Database</Typography>
            <Typography variant="body2" color="text.secondary">
              PostgreSQL via Vercel Postgres (Neon)
            </Typography>
            <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.5 }}>
              DATABASE_URL configured via Vercel integration.
            </Typography>
          </CardContent>
        </Card>

        <Card>
          <CardContent>
            <Typography variant="h6" gutterBottom>Export Data</Typography>
            <Stack direction="row" spacing={2} sx={{ mt: 1 }}>
              <Button variant="outlined" startIcon={<DownloadIcon />} onClick={handleExportCSV}>
                Export CSV
              </Button>
              <Button variant="outlined" startIcon={<DownloadIcon />} onClick={handleExportJSON}>
                Export JSON
              </Button>
            </Stack>
          </CardContent>
        </Card>

        <Card>
          <CardContent>
            <Typography variant="h6" gutterBottom>About</Typography>
            <Typography variant="body2">FinAdviser v0.1.0</Typography>
            <Typography variant="body2" color="text.secondary">
              Personal financial adviser with AI-powered insights.
            </Typography>
            <Divider sx={{ my: 1 }} />
            <Typography variant="caption" color="text.secondary">
              Built with Next.js, Material UI, Drizzle ORM, and Anthropic Claude.
            </Typography>
          </CardContent>
        </Card>
      </Stack>
    </Box>
  );
}
