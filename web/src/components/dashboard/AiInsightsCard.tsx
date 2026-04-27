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
import { softTokens } from '@/theme/theme';

const fetcher = (url: string) => fetch(url).then(r => r.json());

interface Tip {
  id: number;
  content: string;
  tipType: string;
  createdAt: string;
}

interface TypeStyle {
  icon: React.ReactNode;
  fill: string;
  ink: string;
}

const TYPE_CONFIG: Record<string, TypeStyle> = {
  tip:     { icon: <LightbulbRoundedIcon sx={{ fontSize: 18 }} />,    fill: softTokens.lemon.main,    ink: softTokens.lemon.ink },
  warning: { icon: <WarningAmberRoundedIcon sx={{ fontSize: 18 }} />, fill: softTokens.peach.main,    ink: softTokens.peach.ink },
  insight: { icon: <InsightsRoundedIcon sx={{ fontSize: 18 }} />,     fill: softTokens.lavender.main, ink: softTokens.lavender.ink },
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
      <CardContent>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1.5 }}>
          <Box
            sx={{
              width: 36, height: 36, borderRadius: 2.5,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              bgcolor: softTokens.lemon.main, color: softTokens.lemon.ink,
            }}
          >
            <LightbulbRoundedIcon sx={{ fontSize: 20 }} />
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
                  p: 1.5,
                  borderRadius: 2.5,
                  bgcolor: alpha(config.fill, 0.4),
                  transition: 'background-color 0.15s',
                  '&:hover': { bgcolor: alpha(config.fill, 0.6) },
                }}
              >
                <Box sx={{ color: config.ink, mt: 0.25, flexShrink: 0 }}>
                  {config.icon}
                </Box>
                <Typography variant="body2" sx={{ flex: 1, lineHeight: 1.5, color: 'text.primary' }}>
                  {tip.content}
                </Typography>
                <IconButton
                  size="small"
                  onClick={() => handleDismiss(tip.id)}
                  sx={{ flexShrink: 0, opacity: 0.5, '&:hover': { opacity: 1 } }}
                  aria-label="Dismiss"
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
