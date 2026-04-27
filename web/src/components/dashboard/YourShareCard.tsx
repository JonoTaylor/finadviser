'use client';

import { useState } from 'react';
import useSWR from 'swr';
import {
  Card,
  CardContent,
  Typography,
  Box,
  Stack,
  ToggleButton,
  ToggleButtonGroup,
  Skeleton,
  Tooltip,
} from '@mui/material';
import AccountBalanceWalletRoundedIcon from '@mui/icons-material/AccountBalanceWalletRounded';
import HomeWorkRoundedIcon from '@mui/icons-material/HomeWorkRounded';
import TrendingUpRoundedIcon from '@mui/icons-material/TrendingUpRounded';
import SavingsRoundedIcon from '@mui/icons-material/SavingsRounded';
import InfoOutlinedIcon from '@mui/icons-material/InfoOutlined';
import { formatCurrency } from '@/lib/utils/formatting';
import { softTokens, serifFamily } from '@/theme/theme';

interface OwnerLite { id: number; name: string }
interface PerProperty { propertyId: number; propertyName: string; equityPct: number; equityAmount: string }
interface PerInvestment { accountId: number; name: string; investmentKind: string | null; balance: string }
interface YourShare {
  ownerId: number;
  ownerName: string;
  propertyEquity: string;
  investments: string;
  personalCash: string;
  total: string;
  sharedCashUnattributed: string;
  perProperty: PerProperty[];
  perInvestment: PerInvestment[];
}
interface Response {
  owners: OwnerLite[];
  yourShare: YourShare | null;
}

const fetcher = async (url: string): Promise<Response> => {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to fetch ${url} (HTTP ${res.status})`);
  return res.json();
};

/**
 * Owner-scoped replacement for the household Net Worth card. Shows the
 * selected person's slice of:
 *  - Property equity (their ownership share of market value − mortgage)
 *  - Investments (pension / ISA / etc. tagged owner_id = them)
 *  - Personal cash (untagged accounts assumed shared and excluded)
 *
 * The toggle lets you flip between owners — a household with two
 * partners can sanity-check that both views add up to roughly the
 * same household total they used to see.
 */
export default function YourShareCard() {
  const [ownerId, setOwnerId] = useState<number | null>(null);
  const url = ownerId === null ? '/api/dashboard/your-share' : `/api/dashboard/your-share?ownerId=${ownerId}`;
  const { data, error, isLoading } = useSWR<Response>(url, fetcher);

  if (isLoading || !data) {
    return (
      <Card sx={{ height: '100%' }}>
        <CardContent>
          <Skeleton width={120} height={20} />
          <Skeleton width="60%" height={48} sx={{ my: 1 }} />
          <Skeleton width="100%" height={64} />
        </CardContent>
      </Card>
    );
  }

  if (error || !data.yourShare) {
    return (
      <Card sx={{ height: '100%' }}>
        <CardContent>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 2 }}>
            <IconTile color={softTokens.lavender.main} ink={softTokens.lavender.ink}>
              <AccountBalanceWalletRoundedIcon sx={{ fontSize: 20 }} />
            </IconTile>
            <Typography variant="subtitle2">Your share</Typography>
          </Box>
          <Typography variant="body2" color="text.secondary">
            Add an owner to see a personal net-worth view.
          </Typography>
        </CardContent>
      </Card>
    );
  }

  const { yourShare, owners } = data;
  const total = parseFloat(yourShare.total);
  const isPositive = total >= 0;
  const totalColour = isPositive ? softTokens.mint.ink : softTokens.peach.ink;

  return (
    <Card sx={{ height: '100%' }}>
      <CardContent>
        <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ mb: 1.5 }} flexWrap="wrap" useFlexGap>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <IconTile color={softTokens.lavender.main} ink={softTokens.lavender.ink}>
              <AccountBalanceWalletRoundedIcon sx={{ fontSize: 20 }} />
            </IconTile>
            <Box>
              <Typography variant="subtitle2">Your share</Typography>
              <Typography variant="caption" color="text.secondary" sx={{ display: 'block', lineHeight: 1.2 }}>
                Viewing as {yourShare.ownerName}
              </Typography>
            </Box>
          </Box>
          {owners.length > 1 && (
            <ToggleButtonGroup
              size="small"
              exclusive
              value={yourShare.ownerId}
              onChange={(_e, val) => { if (typeof val === 'number') setOwnerId(val); }}
              aria-label="Viewing as"
            >
              {owners.map(o => (
                <ToggleButton key={o.id} value={o.id} sx={{ textTransform: 'none', fontSize: '0.75rem', py: 0.25, px: 1 }}>
                  {o.name.split(' ')[0]}
                </ToggleButton>
              ))}
            </ToggleButtonGroup>
          )}
        </Stack>

        <Typography
          sx={{
            fontFamily: serifFamily,
            fontStyle: 'italic',
            fontWeight: 400,
            fontSize: '2.5rem',
            lineHeight: 1,
            letterSpacing: '-0.02em',
            color: totalColour,
            mb: 2.5,
          }}
        >
          {formatCurrency(yourShare.total)}
        </Typography>

        <Stack spacing={1}>
          <Row
            icon={<HomeWorkRoundedIcon sx={{ fontSize: 16, color: softTokens.lavender.deep }} />}
            label="Property equity"
            value={yourShare.propertyEquity}
            detail={yourShare.perProperty.length > 0
              ? yourShare.perProperty.map(p => `${p.propertyName} · ${p.equityPct.toFixed(1)}%`).join(' · ')
              : null}
          />
          <Row
            icon={<TrendingUpRoundedIcon sx={{ fontSize: 16, color: softTokens.mint.deep }} />}
            label="Investments"
            value={yourShare.investments}
            detail={yourShare.perInvestment.length > 0
              ? `${yourShare.perInvestment.length} account${yourShare.perInvestment.length === 1 ? '' : 's'}`
              : 'None tracked yet'}
          />
          <Row
            icon={<SavingsRoundedIcon sx={{ fontSize: 16, color: softTokens.peach.deep }} />}
            label="Personal cash"
            value={yourShare.personalCash}
            detail={parseFloat(yourShare.sharedCashUnattributed) !== 0
              ? `+ ${formatCurrency(yourShare.sharedCashUnattributed)} shared (not counted)`
              : null}
          />
        </Stack>

        {parseFloat(yourShare.sharedCashUnattributed) !== 0 && (
          <Tooltip
            arrow
            title="Shared cash accounts (no owner_id set) are excluded from the personal total. Tag accounts to a specific owner to count them here."
          >
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, mt: 1, cursor: 'help' }}>
              <InfoOutlinedIcon sx={{ fontSize: 14, color: 'text.disabled' }} />
              <Typography variant="caption" color="text.disabled">
                Some shared cash isn&rsquo;t attributed
              </Typography>
            </Box>
          </Tooltip>
        )}
      </CardContent>
    </Card>
  );
}

function IconTile({ children, color, ink }: { children: React.ReactNode; color: string; ink: string }) {
  return (
    <Box
      sx={{
        width: 36,
        height: 36,
        borderRadius: 2.5,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        bgcolor: color,
        color: ink,
      }}
    >
      {children}
    </Box>
  );
}

function Row({
  icon, label, value, detail,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  detail: string | null;
}) {
  return (
    <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 1 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, minWidth: 0 }}>
        {icon}
        <Box sx={{ minWidth: 0 }}>
          <Typography variant="caption" color="text.secondary" sx={{ display: 'block', lineHeight: 1.2 }}>{label}</Typography>
          {detail && (
            <Typography variant="caption" color="text.disabled" noWrap sx={{ display: 'block', lineHeight: 1.2 }}>
              {detail}
            </Typography>
          )}
        </Box>
      </Box>
      <Typography variant="body2" fontWeight={600} sx={{ flexShrink: 0 }}>
        {formatCurrency(value)}
      </Typography>
    </Box>
  );
}
