'use client';

import { Alert, Card, CardContent, Typography, Box, IconButton, Stack, Chip, Button } from '@mui/material';
import CloseRoundedIcon from '@mui/icons-material/CloseRounded';
import LightbulbOutlinedIcon from '@mui/icons-material/LightbulbOutlined';
import WarningAmberRoundedIcon from '@mui/icons-material/WarningAmberRounded';
import InsightsRoundedIcon from '@mui/icons-material/InsightsRounded';
import useSWR from 'swr';
import Link from 'next/link';
import { useState } from 'react';
import { fetchJson } from '@/lib/http/client';
import DashboardCardHeader from './DashboardCardHeader';

interface Tip { id: number; content: string; tipType: string; createdAt: string }
const TYPE_CONFIG: Record<string, { icon: React.ReactNode; color: string }> = {
  tip: { icon: <LightbulbOutlinedIcon sx={{ fontSize: 18 }} />, color: 'text.secondary' },
  warning: { icon: <WarningAmberRoundedIcon sx={{ fontSize: 18 }} />, color: 'warning.dark' },
  insight: { icon: <InsightsRoundedIcon sx={{ fontSize: 18 }} />, color: 'success.dark' },
};

export default function AiInsightsCard() {
  const { data: tips, mutate } = useSWR<Tip[]>('/api/tips', fetchJson);
  const [dismissError, setDismissError] = useState(false);
  const [dismissing, setDismissing] = useState<number | null>(null);

  const handleDismiss = async (id: number) => {
    setDismissError(false);
    setDismissing(id);
    try {
      await fetchJson(`/api/tips?id=${id}`, { method: 'PATCH' });
      await mutate();
    } catch { setDismissError(true); }
    finally { setDismissing(null); }
  };

  if (!tips || tips.length === 0) return null;

  return <Card><CardContent>
    <DashboardCardHeader title="Adviser insights" subtitle="Suggestions from your saved financial activity"
      action={<Stack direction="row" alignItems="center" gap={1}><Chip label={tips.length} size="small" variant="outlined" /><Button component={Link} href="/chat" size="small">Ask adviser</Button></Stack>} />
    {dismissError && <Alert severity="error" sx={{ mb: 2 }}>This insight could not be dismissed. Please try again.</Alert>}
    <Stack divider={<Box sx={{ borderTop: 1, borderColor: 'divider' }} />}>
      {tips.slice(0, 5).map(tip => {
        const config = TYPE_CONFIG[tip.tipType] ?? TYPE_CONFIG.tip;
        return <Stack key={tip.id} direction="row" alignItems="flex-start" gap={1.5} sx={{ py: 1.5 }}>
          <Box sx={{ color: config.color, mt: 0.1, flexShrink: 0 }}>{config.icon}</Box>
          <Typography variant="body2" sx={{ flex: 1, lineHeight: 1.65 }}>{tip.content}</Typography>
          <IconButton size="small" onClick={() => handleDismiss(tip.id)} disabled={dismissing !== null} aria-label="Dismiss insight" sx={{ flexShrink: 0 }}>
            <CloseRoundedIcon sx={{ fontSize: 16 }} />
          </IconButton>
        </Stack>;
      })}
    </Stack>
  </CardContent></Card>;
}
