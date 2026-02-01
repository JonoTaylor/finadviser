'use client';

import {
  Card, CardContent, Typography, Box, IconButton, Stack, Chip,
} from '@mui/material';
import { alpha } from '@mui/material/styles';
import CloseRoundedIcon from '@mui/icons-material/CloseRounded';
import LightbulbRoundedIcon from '@mui/icons-material/LightbulbRounded';
import WarningAmberRoundedIcon from '@mui/icons-material/WarningAmberRounded';
import InsightsRoundedIcon from '@mui/icons-material/InsightsRounded';
import useSWR from 'swr';

const fetcher = (url: string) => fetch(url).then(r => r.json());

interface Tip {
  id: number;
  content: string;
  tipType: string;
  createdAt: string;
}

const TYPE_CONFIG: Record<string, { icon: React.ReactNode; color: string }> = {
  tip:     { icon: <LightbulbRoundedIcon sx={{ fontSize: 18 }} />,     color: '#FBBF24' },
  warning: { icon: <WarningAmberRoundedIcon sx={{ fontSize: 18 }} />,  color: '#FB7185' },
  insight: { icon: <InsightsRoundedIcon sx={{ fontSize: 18 }} />,      color: '#60A5FA' },
};

export default function AiInsightsCard() {
  const { data: tips, mutate } = useSWR<Tip[]>('/api/tips', fetcher);

  const handleDismiss = async (id: number) => {
    await fetch(`/api/tips?id=${id}`, { method: 'PATCH' });
    mutate();
  };

  if (!tips || tips.length === 0) return null;

  return (
    <Card sx={{ position: 'relative', overflow: 'hidden' }}>
      <Box
        sx={{
          position: 'absolute', top: 0, left: 0, right: 0, height: 3,
          background: 'linear-gradient(90deg, #FBBF24, #F97316, #FB7185)',
        }}
      />
      <CardContent>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1.5 }}>
          <Box
            sx={{
              width: 36, height: 36, borderRadius: 2.5,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              bgcolor: alpha('#FBBF24', 0.12),
            }}
          >
            <LightbulbRoundedIcon sx={{ fontSize: 20, color: '#FBBF24' }} />
          </Box>
          <Typography variant="h6">AI Insights</Typography>
          <Chip label={tips.length} size="small" sx={{ ml: 'auto', fontWeight: 600 }} />
        </Box>
        <Stack spacing={0.75}>
          {tips.slice(0, 5).map((tip) => {
            const config = TYPE_CONFIG[tip.tipType] ?? TYPE_CONFIG.tip;
            return (
              <Box
                key={tip.id}
                sx={{
                  display: 'flex',
                  alignItems: 'flex-start',
                  gap: 1.25,
                  p: 1.25,
                  borderRadius: 2.5,
                  bgcolor: alpha(config.color, 0.06),
                  border: `1px solid ${alpha(config.color, 0.1)}`,
                }}
              >
                <Box sx={{ color: config.color, mt: 0.25, flexShrink: 0 }}>
                  {config.icon}
                </Box>
                <Typography variant="body2" sx={{ flex: 1, lineHeight: 1.5, color: 'text.primary' }}>
                  {tip.content}
                </Typography>
                <IconButton
                  size="small"
                  onClick={() => handleDismiss(tip.id)}
                  sx={{ flexShrink: 0, opacity: 0.4, '&:hover': { opacity: 1 } }}
                >
                  <CloseRoundedIcon sx={{ fontSize: 16 }} />
                </IconButton>
              </Box>
            );
          })}
        </Stack>
      </CardContent>
    </Card>
  );
}
