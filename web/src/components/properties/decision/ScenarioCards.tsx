'use client';

import { useState } from 'react';
import {
  Box,
  Card,
  CardContent,
  Chip,
  Collapse,
  Divider,
  Grid,
  Stack,
  Typography,
} from '@mui/material';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import ExpandLessIcon from '@mui/icons-material/ExpandLess';
import { formatCurrency } from '@/lib/utils/formatting';
import type { ComparisonCell, ScenarioKey } from '@/lib/properties/btl-decision';

const SCENARIO_ORDER: ScenarioKey[] = [
  'ride_out',
  'fast_forced',
  'delay_dodge_erc',
  're_let',
];

const SCENARIO_DESCRIPTIONS: Record<ScenarioKey, string> = {
  ride_out:
    'Let the existing tenancy run to its natural end, then sell vacant. Lowest void cost, highest sale flexibility.',
  fast_forced:
    'Serve Ground 1A notice as soon as legally allowed. Earlier sale completion, accept a void while marketing.',
  delay_dodge_erc:
    'Push the sale past the ERC tie-in to avoid the charge. Extra carry months traded against ERC saved.',
  re_let:
    'Abandon the sale plan. Re-let after the current tenancy ends, hold long term. No sale proceeds.',
};

export interface ScenarioCardsProps {
  cells: ComparisonCell[];
}

export default function ScenarioCards({ cells }: ScenarioCardsProps) {
  // Group cells by scenario, rank products within each scenario by total
  // carry cost (lower = better). The leading product per scenario is
  // surfaced as the card headline.
  const byScenario = SCENARIO_ORDER.map(key => {
    const filtered = cells
      .filter(c => c.scenarioKey === key)
      .sort((a, b) =>
        a.result.totalCarryCost.minus(b.result.totalCarryCost).toNumber(),
      );
    return { key, cells: filtered };
  });

  if (cells.length === 0) {
    return (
      <Card>
        <CardContent>
          <Typography variant="body2" color="text.secondary">
            Add at least one mortgage product above to see scenario costs.
          </Typography>
        </CardContent>
      </Card>
    );
  }

  return (
    <Grid container spacing={2}>
      {byScenario.map(({ key, cells: scenarioCells }) => {
        if (scenarioCells.length === 0) return null;
        const leader = scenarioCells[0];
        return (
          <Grid key={key} size={{ xs: 12, md: 6 }}>
            <ScenarioCard
              scenarioKey={key}
              label={leader.scenarioLabel}
              description={SCENARIO_DESCRIPTIONS[key]}
              cells={scenarioCells}
            />
          </Grid>
        );
      })}
    </Grid>
  );
}

function ScenarioCard({
  scenarioKey,
  label,
  description,
  cells,
}: {
  scenarioKey: ScenarioKey;
  label: string;
  description: string;
  cells: ComparisonCell[];
}) {
  const [expandedProduct, setExpandedProduct] = useState<string | null>(null);
  const leader = cells[0];

  return (
    <Card variant="outlined" sx={{ height: '100%' }}>
      <CardContent>
        <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 0.5 }}>
          <Typography variant="h6">{label}</Typography>
          {scenarioKey === 'ride_out' && (
            <Chip size="small" label="Current leading plan" color="primary" variant="outlined" />
          )}
        </Stack>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          {description}
        </Typography>

        <Box sx={{ mb: 1.5, p: 1.5, bgcolor: 'action.hover', borderRadius: 1 }}>
          <Typography variant="caption" color="text.secondary">
            Best product: {leader.productName}
          </Typography>
          <Typography variant="h5" fontWeight={700} sx={{ fontVariantNumeric: 'tabular-nums' }}>
            {formatCurrency(leader.result.totalCarryCost.toFixed(2))}
          </Typography>
          <Typography variant="caption" color="text.secondary">
            total carry cost (mortgage + voids + EPC, less net rental)
          </Typography>
        </Box>

        <Divider sx={{ mb: 1 }} />

        <Stack spacing={1}>
          {cells.map(cell => {
            const isExpanded = expandedProduct === cell.productId;
            return (
              <Box key={cell.productId}>
                <Stack
                  direction="row"
                  alignItems="center"
                  justifyContent="space-between"
                  sx={{ cursor: 'pointer' }}
                  onClick={() =>
                    setExpandedProduct(isExpanded ? null : cell.productId)
                  }
                >
                  <Box>
                    <Typography variant="body2" fontWeight={500}>
                      {cell.productName}
                    </Typography>
                    <Typography variant="caption" color="text.secondary">
                      Mortgage cost {formatCurrency(cell.result.mortgageCost.toFixed(2))}
                      {cell.result.ercCost.gt(0)
                        ? `, incl. ERC ${formatCurrency(cell.result.ercCost.toFixed(2))}`
                        : ''}
                    </Typography>
                  </Box>
                  <Stack direction="row" alignItems="center" spacing={0.5}>
                    <Typography
                      variant="body2"
                      fontWeight={600}
                      sx={{ fontVariantNumeric: 'tabular-nums' }}
                    >
                      {formatCurrency(cell.result.totalCarryCost.toFixed(2))}
                    </Typography>
                    {isExpanded ? (
                      <ExpandLessIcon fontSize="small" />
                    ) : (
                      <ExpandMoreIcon fontSize="small" />
                    )}
                  </Stack>
                </Stack>
                <Collapse in={isExpanded}>
                  <Box sx={{ pl: 1, pt: 1, fontVariantNumeric: 'tabular-nums' }}>
                    <LineItem label="Mortgage payments + fees" value={cell.result.mortgageCost.toFixed(2)} />
                    <LineItem label="ERC" value={cell.result.ercCost.toFixed(2)} />
                    <LineItem label="Void cost" value={cell.result.voidCost.toFixed(2)} />
                    <LineItem label="EPC remediation" value={cell.result.epcCost.toFixed(2)} />
                    <LineItem label="Less: net rental after tax" value={`-${cell.result.netRentalAfterTax.toFixed(2)}`} />
                    {cell.result.netProceeds !== null && (
                      <LineItem label="Sale net proceeds (after CGT)" value={cell.result.netProceeds.toFixed(2)} />
                    )}
                  </Box>
                </Collapse>
              </Box>
            );
          })}
        </Stack>
      </CardContent>
    </Card>
  );
}

function LineItem({ label, value }: { label: string; value: string }) {
  return (
    <Stack direction="row" justifyContent="space-between" sx={{ py: 0.25 }}>
      <Typography variant="caption" color="text.secondary">
        {label}
      </Typography>
      <Typography variant="caption" fontWeight={500}>
        {formatCurrency(value)}
      </Typography>
    </Stack>
  );
}
