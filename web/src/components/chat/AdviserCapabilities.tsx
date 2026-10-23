'use client';

import useSWR from 'swr';
import { Alert, Box, Button, Stack, Typography } from '@mui/material';
import { z } from 'zod';
import type { AdviserCapabilities } from '@/lib/ai/capabilities';

const readSave = z.object({ read: z.boolean(), save: z.boolean() });
const responseSchema = z.object({
  version: z.literal(1),
  capabilities: z.object({
    memory: readSave.extend({ update: z.boolean() }),
    taxProfile: readSave,
    identity: readSave,
  }),
  release: z.object({
    commit: z.string().nullable(),
    productionUrl: z.string().nullable(),
    environment: z.enum(['production', 'preview', 'development', 'unknown']),
  }),
});

export async function fetchAdviserCapabilities(url: string): Promise<AdviserCapabilities> {
  const response = await fetch(url, { cache: 'no-store' });
  const parsed = responseSchema.safeParse(await response.json().catch(() => null));
  if (!response.ok || !parsed.success) throw new Error('Adviser saving features could not be verified.');
  return parsed.data;
}

/** Only a server-provided HTTPS production host can offer another app link. */
export function productionChatHref(productionUrl: string | null, currentHostname?: string): string | null {
  if (!productionUrl || !currentHostname) return null;
  try {
    const url = new URL(productionUrl);
    if (url.protocol !== 'https:' || url.username || url.password || url.hostname === currentHostname) return null;
    return new URL('/chat', url.origin).href;
  } catch {
    return null;
  }
}

export default function AdviserCapabilitiesStatus() {
  const { data, error, mutate } = useSWR('/api/ai/capabilities', fetchAdviserCapabilities, { shouldRetryOnError: false });
  if (!data && !error) return <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 2 }}>
    Checking adviser saving features…
  </Typography>;
  if (error) return <Alert severity="warning" sx={{ mb: 2 }} action={<Button color="inherit" size="small" onClick={() => void mutate()}>Retry</Button>}>
    Adviser saving features could not be verified. Your chat is still available.
  </Alert>;
  if (!data) return null;

  const ready = data.capabilities.memory.read && data.capabilities.memory.save && data.capabilities.memory.update
    && data.capabilities.taxProfile.read && data.capabilities.taxProfile.save;
  const currentApp = productionChatHref(data.release.productionUrl, typeof window === 'undefined' ? undefined : window.location.hostname);
  return <Alert severity={ready ? 'info' : 'warning'} sx={{ mb: 2 }}>
    <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} alignItems={{ sm: 'center' }}>
      <Box sx={{ flex: 1 }}>
        <Typography variant="body2" fontWeight={600}>
          {ready ? 'Memory and tax profile saving available' : 'Some adviser saving features are unavailable in this app version'}
        </Typography>
        <Typography variant="caption" color="text.secondary">
          {ready ? 'Ask the adviser to save confirmed details. A tax profile also needs the owner and tax year.' : 'Your chat is still available. Use the current app to check the latest saving features.'}
        </Typography>
      </Box>
      {currentApp && <Button component="a" href={currentApp} target="_blank" rel="noopener noreferrer" variant="outlined" size="small" sx={{ flexShrink: 0, alignSelf: { xs: 'flex-start', sm: 'center' } }}>
        Open current app
      </Button>}
    </Stack>
  </Alert>;
}
