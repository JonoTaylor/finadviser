'use client';

import {
  Card, CardContent, Typography, Box, IconButton, Stack, Chip,
} from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';
import LightbulbIcon from '@mui/icons-material/Lightbulb';
import WarningAmberIcon from '@mui/icons-material/WarningAmber';
import InsightsIcon from '@mui/icons-material/Insights';
import useSWR from 'swr';

const fetcher = (url: string) => fetch(url).then(r => r.json());

interface Tip {
  id: number;
  content: string;
  tipType: string;
  createdAt: string;
}

const TYPE_CONFIG: Record<string, { icon: React.ReactNode; color: string; chipColor: 'warning' | 'error' | 'info' }> = {
  tip: { icon: <LightbulbIcon sx={{ fontSize: 18 }} />, color: 'warning.main', chipColor: 'warning' },
  warning: { icon: <WarningAmberIcon sx={{ fontSize: 18 }} />, color: 'error.main', chipColor: 'error' },
  insight: { icon: <InsightsIcon sx={{ fontSize: 18 }} />, color: 'info.main', chipColor: 'info' },
};

export default function AiInsightsCard() {
  const { data: tips, mutate } = useSWR<Tip[]>('/api/tips', fetcher);

  const handleDismiss = async (id: number) => {
    await fetch(`/api/tips?id=${id}`, { method: 'PATCH' });
    mutate();
  };

  if (!tips || tips.length === 0) return null;

  return (
    <Card>
      <CardContent sx={{ pb: '12px !important' }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1.5 }}>
          <LightbulbIcon sx={{ color: 'warning.main', fontSize: 20 }} />
          <Typography variant="h6" sx={{ fontSize: '1rem' }}>AI Insights</Typography>
          <Chip label={tips.length} size="small" variant="outlined" sx={{ ml: 'auto' }} />
        </Box>
        <Stack spacing={1}>
          {tips.slice(0, 5).map((tip) => {
            const config = TYPE_CONFIG[tip.tipType] ?? TYPE_CONFIG.tip;
            return (
              <Box
                key={tip.id}
                sx={{
                  display: 'flex',
                  alignItems: 'flex-start',
                  gap: 1,
                  p: 1,
                  borderRadius: 1,
                  bgcolor: 'rgba(255,255,255,0.03)',
                }}
              >
                <Box sx={{ color: config.color, mt: 0.25, flexShrink: 0 }}>
                  {config.icon}
                </Box>
                <Box sx={{ flex: 1, minWidth: 0 }}>
                  <Typography variant="body2" sx={{ lineHeight: 1.4 }}>
                    {tip.content}
                  </Typography>
                </Box>
                <IconButton
                  size="small"
                  onClick={() => handleDismiss(tip.id)}
                  sx={{ ml: 0.5, flexShrink: 0, opacity: 0.5, '&:hover': { opacity: 1 } }}
                >
                  <CloseIcon sx={{ fontSize: 16 }} />
                </IconButton>
              </Box>
            );
          })}
        </Stack>
      </CardContent>
    </Card>
  );
}
