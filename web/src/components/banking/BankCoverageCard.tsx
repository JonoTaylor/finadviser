'use client';

import useSWR from 'swr';
import {
  Card, CardContent, Typography, Box, Stack, Chip, Button, Alert,
} from '@mui/material';
import AccountBalanceRoundedIcon from '@mui/icons-material/AccountBalanceRounded';
import CheckCircleRoundedIcon from '@mui/icons-material/CheckCircleRounded';
import ErrorOutlineRoundedIcon from '@mui/icons-material/ErrorOutlineRounded';
import RefreshRoundedIcon from '@mui/icons-material/RefreshRounded';
import { softTokens } from '@/theme/theme';

interface CoverageEntry {
  status: 'available' | 'missing';
  institutionId?: string;
  name?: string;
  consentMaxDays?: number;
  transactionsMaxHistoricalDays?: number;
}

type ProviderSlug = 'monzo' | 'barclays' | 'amex_uk' | 'yonder';

interface CoverageResponse {
  coverage: Record<ProviderSlug, CoverageEntry>;
  institutions: Array<{ id: string; name: string }>;
}

const PROVIDER_LABEL: Record<ProviderSlug, string> = {
  monzo: 'Monzo',
  barclays: 'Barclays',
  amex_uk: 'American Express UK',
  yonder: 'Yonder',
};

const fetcher = async (url: string) => {
  const res = await fetch(url);
  const body = await res.json();
  if (!res.ok) throw new Error(body?.error ?? `Request failed: ${res.status}`);
  return body as CoverageResponse;
};

/**
 * Smoke-test panel for PR A of the banking integration. Calls
 * /api/banking/institutions and shows whether each of the four
 * target banks is reachable through the configured aggregator
 * (GoCardless BAD). The user reads this to decide whether to
 * proceed with the connect flow in PR B.
 */
export default function BankCoverageCard() {
  const { data, error, isLoading, mutate } = useSWR<CoverageResponse>(
    '/api/banking/institutions?country=gb',
    fetcher,
    { revalidateOnFocus: false },
  );

  const slugs: ProviderSlug[] = ['monzo', 'barclays', 'amex_uk', 'yonder'];

  return (
    <Card>
      <CardContent>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, mb: 1.5 }}>
          <Box
            sx={{
              width: 36, height: 36, borderRadius: 2.5,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              bgcolor: softTokens.lavender.main,
              color: softTokens.lavender.ink,
            }}
          >
            <AccountBalanceRoundedIcon sx={{ fontSize: 20 }} />
          </Box>
          <Box sx={{ flex: 1 }}>
            <Typography variant="h6">Bank coverage</Typography>
            <Typography variant="caption" color="text.secondary">
              Aggregator: GoCardless Bank Account Data
            </Typography>
          </Box>
          <Button
            size="small"
            variant="outlined"
            startIcon={<RefreshRoundedIcon />}
            onClick={() => mutate()}
            disabled={isLoading}
          >
            Refresh
          </Button>
        </Box>

        {error && (
          <Alert severity="error" sx={{ mb: 2 }}>
            {error.message}
          </Alert>
        )}

        {isLoading && !data && (
          <Typography variant="body2" color="text.secondary">
            Checking aggregator coverage&hellip;
          </Typography>
        )}

        {data && (
          <Stack spacing={1.25}>
            {slugs.map((slug) => {
              const entry = data.coverage[slug];
              const ok = entry.status === 'available';
              return (
                <Box
                  key={slug}
                  sx={{
                    display: 'flex', alignItems: 'center', gap: 1.5,
                    p: 1.5, borderRadius: 2,
                    bgcolor: ok ? softTokens.mint.main : softTokens.peach.main,
                    color: ok ? softTokens.mint.ink : softTokens.peach.ink,
                  }}
                >
                  {ok
                    ? <CheckCircleRoundedIcon sx={{ fontSize: 22 }} />
                    : <ErrorOutlineRoundedIcon sx={{ fontSize: 22 }} />}
                  <Box sx={{ flex: 1 }}>
                    <Typography variant="body2" sx={{ fontWeight: 600 }}>
                      {PROVIDER_LABEL[slug]}
                    </Typography>
                    {ok ? (
                      <Typography variant="caption">
                        {entry.name} &middot; up to {entry.transactionsMaxHistoricalDays}d history,
                        consent valid {entry.consentMaxDays}d
                      </Typography>
                    ) : (
                      <Typography variant="caption">
                        Not in GoCardless catalogue. Fallback to TrueLayer required.
                      </Typography>
                    )}
                  </Box>
                  <Chip
                    label={ok ? 'Available' : 'Missing'}
                    size="small"
                    sx={{
                      bgcolor: ok ? softTokens.mint.deep : softTokens.peach.deep,
                      color: '#FFFFFF',
                    }}
                  />
                </Box>
              );
            })}

            <Typography variant="caption" color="text.secondary" sx={{ mt: 1 }}>
              Catalogue total: {data.institutions.length} UK institutions
            </Typography>
          </Stack>
        )}
      </CardContent>
    </Card>
  );
}
