'use client';

import { Box, Link, Stack, Typography } from '@mui/material';
import type { ReviewItem } from '@/lib/categorization/review';

// Source records are validated on the server. Keep links inert if a malformed
// response ever reaches the browser, too; evidence text is always plain text.
function publicSourceUrl(value: string): URL | null {
  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase();
    if (url.protocol !== 'https:' || url.username || url.password || url.port ||
      !host.includes('.') || host.endsWith('.local') || host.endsWith('.localhost') ||
      host.endsWith('.internal') || host.endsWith('.test') || host.startsWith('[') ||
      /^[\d.]+$/.test(host)) return null;
    return url;
  } catch { return null; }
}

export default function MerchantResearchEvidence({ evidence }: { evidence: ReviewItem['evidence'] }) {
  if (!evidence || evidence.status !== 'matched' || evidence.scope !== 'merchant_identity_only') return null;
  const sources = evidence.sources.slice(0, 3).flatMap(source => {
    const url = publicSourceUrl(source.url);
    return url ? [{ ...source, url: url.href, host: url.hostname }] : [];
  });
  if (!sources.length) return null;
  const researchedAt = new Date(evidence.researchedAt);
  const date = Number.isNaN(researchedAt.getTime()) ? null : researchedAt.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
  return <Box sx={{ mt: 1.5, pl: 1.5, borderLeft: 2, borderColor: 'divider' }}>
    <Typography variant="caption" component="p" sx={{ fontWeight: 600 }}>Merchant research{date ? ` · ${date}` : ''}</Typography>
    <Stack spacing={1} sx={{ mt: 0.75 }}>{sources.map(source => <Box key={source.url} sx={{ minWidth: 0 }}>
      <Link href={source.url} target="_blank" rel="noopener noreferrer" variant="body2" sx={{ overflowWrap: 'anywhere' }}>{source.title || source.host}</Link>
      <Typography variant="caption" component="p" sx={{ overflowWrap: 'anywhere' }}>{source.host}</Typography>
      {source.snippet && <Typography variant="body2" color="text.secondary" sx={{ mt: 0.25, overflowWrap: 'anywhere' }}>{source.snippet}</Typography>}
    </Box>)}</Stack>
    <Typography variant="caption" component="p" sx={{ mt: 0.75 }}>Sources help identify the business. They do not verify what you bought or whether a cost is tax deductible.</Typography>
  </Box>;
}
