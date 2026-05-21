'use client';

import { Alert, Stack } from '@mui/material';
import type { KeyInsight, ScenarioKey } from '@/lib/properties/btl-decision';

const SCENARIO_LABEL: Record<ScenarioKey, string> = {
  ride_out: 'Ride out tenancy',
  fast_forced: 'Fast forced sale',
  delay_dodge_erc: 'Delay past ERC',
  re_let: 'Re-let, hold long term',
};

export default function KeyInsights({ insights }: { insights: KeyInsight[] }) {
  if (insights.length === 0) return null;
  return (
    <Stack spacing={1} sx={{ mb: 2 }}>
      {insights.map((insight, i) => (
        <Alert key={insight.scenarioKey} severity={i === 0 ? 'success' : 'info'} variant="outlined">
          <strong>{SCENARIO_LABEL[insight.scenarioKey]}:</strong> {insight.message}
        </Alert>
      ))}
    </Stack>
  );
}
