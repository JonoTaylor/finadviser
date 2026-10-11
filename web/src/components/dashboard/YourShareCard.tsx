'use client';

import { useState } from 'react';
import Link from 'next/link';
import useSWR from 'swr';
import { Card, CardContent, Typography, Box, Stack, Skeleton, Tooltip, Button, Collapse, Select, MenuItem } from '@mui/material';
import ExpandMoreRoundedIcon from '@mui/icons-material/ExpandMoreRounded';
import DashboardCardHeader, { metricValueSx } from './DashboardCardHeader';
import { formatCurrency } from '@/lib/utils/formatting';

interface OwnerLite { id: number; name: string }
interface PerProperty { propertyId: number; propertyName: string; equityPct: number; equityAmount: string }
interface PerInvestment { accountId: number; name: string; investmentKind: string | null; balance: string }
interface YourShare {
  ownerId: number;
  ownerName: string;
  balanceAsOf: string;
  propertyEquity: string;
  investments: string;
  personalCash: string;
  personalLiabilities: string;
  sharedLiabilitiesUnattributed: string;
  perLiability: Array<{ accountId: number; name: string; balance: string }>;
  total: string;
  sharedCashUnattributed: string;
  perProperty: PerProperty[];
  perInvestment: PerInvestment[];
}
interface Response { owners: OwnerLite[]; yourShare: YourShare | null; requiresOwnerSelection?: boolean }

const fetcher = async (url: string): Promise<Response> => {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to fetch ${url} (HTTP ${res.status})`);
  return res.json();
};

export default function YourShareCard() {
  const [ownerId, setOwnerId] = useState<number | null>(null);
  const [expanded, setExpanded] = useState(false);
  const url = ownerId === null ? '/api/dashboard/your-share' : `/api/dashboard/your-share?ownerId=${ownerId}`;
  const { data, error, isLoading, mutate } = useSWR<Response>(url, fetcher);

  if (isLoading) return <Card sx={{ height: '100%' }}><CardContent>
    <DashboardCardHeader title="Personal net worth" />
    <Skeleton width="75%" height={48} /><Skeleton width="100%" height={70} />
  </CardContent></Card>;

  if (error || !data?.yourShare) return <Card sx={{ height: '100%' }}><CardContent>
    <DashboardCardHeader title="Personal net worth" subtitle="Your attributed share of household assets" />
    <Typography sx={metricValueSx}>—</Typography>
    <Typography variant="body2" color="text.secondary" sx={{ mt: 1.5 }}>
      {error ? 'Personal net worth could not be loaded. Please retry when your account records are available.' : 'Choose your ledger owner in My context to see your personal net worth.'}
    </Typography>
    {error ? <Button onClick={() => void mutate()} sx={{ mt: 2, px: 0 }} size="small">Retry</Button> : <Button component={Link} href="/profile" sx={{ mt: 2, px: 0 }} size="small">Choose my owner</Button>}
  </CardContent></Card>;

  const { yourShare, owners } = data;
  const hasSharedCash = parseFloat(yourShare.sharedCashUnattributed) !== 0;
  const hasSharedDebt = parseFloat(yourShare.sharedLiabilitiesUnattributed) !== 0;

  return <Card sx={{ height: '100%' }}><CardContent>
    <DashboardCardHeader title="Personal net worth" subtitle={`Viewing as ${yourShare.ownerName}`} />
    <Typography sx={{ ...metricValueSx, color: parseFloat(yourShare.total) < 0 ? 'error.main' : 'text.primary' }}>{formatCurrency(yourShare.total)}</Typography>
    <Typography variant="caption" sx={{ display: 'block', mt: 0.75, mb: 2 }}>Attributed assets less personal debts</Typography>
    {owners.length > 1 && <Select size="small" value={yourShare.ownerId} onChange={e => setOwnerId(Number(e.target.value))}
      inputProps={{ 'aria-label': 'View personal net worth as' }} sx={{ width: '100%', fontSize: '0.8rem', mb: 1, '& .MuiSelect-select': { py: 0.8 } }}>
      {owners.map(owner => <MenuItem key={owner.id} value={owner.id}>{owner.name}</MenuItem>)}
    </Select>}
    <Button size="small" onClick={() => setExpanded(!expanded)} aria-expanded={expanded} aria-controls="personal-net-worth-breakdown"
      endIcon={<ExpandMoreRoundedIcon sx={{ transform: expanded ? 'rotate(180deg)' : 'none', transition: 'transform 160ms ease' }} />} sx={{ px: 0, width: '100%', justifyContent: 'space-between' }}>
      {expanded ? 'Hide breakdown' : 'View breakdown'}
    </Button>
    <Collapse in={expanded}>
      <Stack id="personal-net-worth-breakdown" spacing={1.25} sx={{ borderTop: 1, borderColor: 'divider', pt: 1.5, mt: 0.5 }}>
        <Row label="Property equity" value={yourShare.propertyEquity} detail={yourShare.perProperty.length > 0 ? yourShare.perProperty.map(p => `${p.propertyName} · ${p.equityPct.toFixed(1)}%`).join(' · ') : null} />
        <Row label="Investments" value={yourShare.investments} detail={yourShare.perInvestment.length > 0 ? `${yourShare.perInvestment.length} investment accounts` : 'None tracked yet'} />
        <Row label="Personal cash" value={yourShare.personalCash} detail={hasSharedCash ? `${formatCurrency(yourShare.sharedCashUnattributed)} shared cash excluded` : null} />
        <Row label="Personal debts" value={yourShare.personalLiabilities} detail={yourShare.perLiability.length > 0 ? 'Excludes mortgages already in equity' : 'No owner-attributed debts recorded'} />
      </Stack>
    </Collapse>
    {(hasSharedCash || hasSharedDebt) && <Typography variant="caption" sx={{ display: 'block', mt: 1.25, lineHeight: 1.5 }}>
      {hasSharedCash && <Box component="span" sx={{ display: 'block' }}>{formatCurrency(yourShare.sharedCashUnattributed)} shared cash excluded.</Box>}
      {hasSharedDebt && <Box component="span" sx={{ display: 'block' }}>{formatCurrency(yourShare.sharedLiabilitiesUnattributed)} shared debt unattributed.</Box>}
    </Typography>}
    <Typography variant="caption" sx={{ display: 'block', mt: 1.5 }}>Ledger balances as of {yourShare.balanceAsOf}</Typography>
  </CardContent></Card>;
}

function Row({ label, value, detail }: { label: string; value: string; detail: string | null }) {
  return <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 1.5 }}>
    <Box sx={{ minWidth: 0 }}>
      <Typography variant="body2" color="text.secondary">{label}</Typography>
      {detail && <Tooltip title={detail}><Typography variant="caption" noWrap sx={{ display: 'block' }}>{detail}</Typography></Tooltip>}
    </Box>
    <Typography variant="body2" fontWeight={600} sx={{ flexShrink: 0, fontVariantNumeric: 'tabular-nums' }}>{formatCurrency(value)}</Typography>
  </Box>;
}
