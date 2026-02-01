'use client';

import { Card, CardContent, Typography, Box, Button, Stack } from '@mui/material';
import { alpha } from '@mui/material/styles';
import SavingsRoundedIcon from '@mui/icons-material/SavingsRounded';
import ChatRoundedIcon from '@mui/icons-material/ChatRounded';
import useSWR from 'swr';
import Link from 'next/link';
import { lightCard } from '@/theme/theme';

const fetcher = (url: string) => fetch(url).then(r => r.json());

interface SavingsGoal {
  id: number;
  name: string;
  targetAmount: string;
  currentAmount: string;
  targetDate: string | null;
  status: string;
}

function getColor(pct: number): string {
  if (pct >= 75) return '#4ADE80';
  if (pct >= 40) return '#FBBF24';
  return '#8E7DC0';
}

export default function SavingsGoalsCard() {
  const { data: goals } = useSWR<SavingsGoal[]>('/api/savings-goals', fetcher);

  const activeGoals = (goals ?? []).filter(g => g.status === 'active');

  if (activeGoals.length === 0) {
    return (
      <Card sx={{ height: '100%', ...lightCard }}>
        <CardContent>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 2 }}>
            <Box
              sx={{
                width: 36, height: 36, borderRadius: 2.5,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                bgcolor: alpha('#8E7DC0', 0.15),
              }}
            >
              <SavingsRoundedIcon sx={{ fontSize: 20, color: '#8E7DC0' }} />
            </Box>
            <Typography variant="subtitle2" sx={{ color: '#1A1730' }}>Savings Goals</Typography>
          </Box>
          <Typography variant="body2" sx={{ color: alpha('#1A1730', 0.7), mb: 2 }}>
            No savings goals yet. Use the AI chat to set targets and track your progress.
          </Typography>
          <Button
            component={Link}
            href="/chat"
            size="small"
            variant="outlined"
            startIcon={<ChatRoundedIcon />}
          >
            Add a goal
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card sx={{ height: '100%', position: 'relative', overflow: 'hidden', ...lightCard }}>
      <Box
        sx={{
          position: 'absolute', top: 0, left: 0, right: 0, height: 3,
          background: 'linear-gradient(90deg, #E8C547, #F472B6)',
        }}
      />
      <CardContent>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 2 }}>
          <Box
            sx={{
              width: 36, height: 36, borderRadius: 2.5,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              bgcolor: alpha('#8E7DC0', 0.15),
            }}
          >
            <SavingsRoundedIcon sx={{ fontSize: 20, color: '#8E7DC0' }} />
          </Box>
          <Typography variant="subtitle2" sx={{ color: '#1A1730' }}>Savings Goals</Typography>
        </Box>

        <Stack spacing={2}>
          {activeGoals.slice(0, 4).map((goal) => {
            const target = parseFloat(goal.targetAmount);
            const current = parseFloat(goal.currentAmount);
            const pct = target > 0 ? Math.min(100, Math.round((current / target) * 100)) : 0;
            const remaining = Math.max(0, target - current);
            const color = getColor(pct);

            // Ring params
            const size = 52;
            const stroke = 5;
            const radius = (size - stroke) / 2;
            const circumference = 2 * Math.PI * radius;
            const offset = circumference - (pct / 100) * circumference;

            return (
              <Box key={goal.id} sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
                <Box sx={{ position: 'relative', width: size, height: size, flexShrink: 0 }}>
                  <svg width={size} height={size} style={{ transform: 'rotate(-90deg)' }}>
                    <circle
                      cx={size / 2} cy={size / 2} r={radius}
                      fill="none" stroke={alpha(color, 0.2)} strokeWidth={stroke}
                    />
                    <circle
                      cx={size / 2} cy={size / 2} r={radius}
                      fill="none" stroke={color} strokeWidth={stroke}
                      strokeLinecap="round"
                      strokeDasharray={circumference}
                      strokeDashoffset={offset}
                      style={{ transition: 'stroke-dashoffset 0.5s ease' }}
                    />
                  </svg>
                  <Box
                    sx={{
                      position: 'absolute', inset: 0,
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                    }}
                  >
                    <Typography variant="caption" sx={{ fontWeight: 700, fontSize: '0.7rem', color }}>
                      {pct}%
                    </Typography>
                  </Box>
                </Box>
                <Box sx={{ flex: 1, minWidth: 0 }}>
                  <Typography variant="body2" sx={{ fontWeight: 500, color: '#1A1730' }} noWrap>
                    {goal.name}
                  </Typography>
                  <Typography variant="caption" sx={{ color: alpha('#1A1730', 0.6) }}>
                    £{remaining.toFixed(0)} remaining
                    {goal.targetDate ? ` · by ${goal.targetDate}` : ''}
                  </Typography>
                </Box>
              </Box>
            );
          })}
        </Stack>
      </CardContent>
    </Card>
  );
}
