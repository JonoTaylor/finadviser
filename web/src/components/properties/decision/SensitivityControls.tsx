'use client';

import {
  Box,
  Button,
  Card,
  CardContent,
  Grid,
  Slider,
  Stack,
  ToggleButton,
  ToggleButtonGroup,
  Typography,
} from '@mui/material';
import RestartAltIcon from '@mui/icons-material/RestartAlt';

export interface SensitivityState {
  saleCompletionMonths: number;
  salePrice: number;
  tenantedSaleDiscountPct: number;
  epcRemediation: number;
  voidMonths: number;
  marginalRatePct: '20' | '40' | '45';
}

export const DEFAULT_SENSITIVITY: SensitivityState = {
  saleCompletionMonths: 14,
  salePrice: 450000,
  tenantedSaleDiscountPct: 5,
  epcRemediation: 0,
  voidMonths: 1,
  marginalRatePct: '40',
};

/**
 * Slider bounds for the sale-price input. Bracketing ±15% around the
 * current valuation covers a realistic spread (slow market 12% below,
 * bidding war 12% above) without making the slider feel meaningless on
 * the tails. Step is sized to the property's scale so a £200k flat and
 * a £1.5m house both get usable granularity.
 */
export interface SalePriceRange {
  min: number;
  max: number;
  step: number;
  default: number;
}

export function salePriceRangeFromValuation(valuation: number): SalePriceRange {
  const v = Math.max(50_000, Math.round(valuation));
  // Snap min/max to the nearest £5k for a tidier slider.
  const snap = (x: number) => Math.max(5000, Math.round(x / 5000) * 5000);
  const min = snap(v * 0.85);
  const max = snap(v * 1.15);
  // Step roughly 1% of valuation, rounded to a nice multiple.
  const rawStep = v * 0.01;
  const step = rawStep >= 5000 ? 5000 : rawStep >= 1000 ? 1000 : 500;
  return { min, max, step, default: v };
}

export interface SensitivityControlsProps {
  value: SensitivityState;
  onChange: (next: SensitivityState) => void;
  salePriceRange: SalePriceRange;
}

export default function SensitivityControls({
  value,
  onChange,
  salePriceRange,
}: SensitivityControlsProps) {
  const update = <K extends keyof SensitivityState>(key: K, v: SensitivityState[K]) => {
    onChange({ ...value, [key]: v });
  };

  // Clamp the current slider value into the adaptive range so a user
  // landing on a £200k flat doesn't see the marker stuck at £400k.
  const clampedSalePrice = Math.min(
    Math.max(value.salePrice, salePriceRange.min),
    salePriceRange.max,
  );

  return (
    <Card sx={{ mb: 3 }}>
      <CardContent>
        <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ mb: 2 }}>
          <Box>
            <Typography variant="h6">Sensitivity</Typography>
            <Typography variant="body2" color="text.secondary">
              Drag the sliders to see how each scenario reacts. Cards and charts re-rank live.
            </Typography>
          </Box>
          <Button
            startIcon={<RestartAltIcon />}
            size="small"
            onClick={() =>
              onChange({ ...DEFAULT_SENSITIVITY, salePrice: salePriceRange.default })
            }
          >
            Reset
          </Button>
        </Stack>

        <Grid container spacing={3}>
          <Grid size={{ xs: 12, md: 6 }}>
            <SliderRow
              label="Sale completion (months from today)"
              value={value.saleCompletionMonths}
              min={1}
              max={36}
              step={1}
              valueLabel={`${value.saleCompletionMonths}m`}
              onChange={v => update('saleCompletionMonths', v)}
            />
            <SliderRow
              label="Sale price achieved"
              value={clampedSalePrice}
              min={salePriceRange.min}
              max={salePriceRange.max}
              step={salePriceRange.step}
              valueLabel={`£${clampedSalePrice.toLocaleString()}`}
              onChange={v => update('salePrice', v)}
            />
            <SliderRow
              label="Tenanted-sale discount"
              value={value.tenantedSaleDiscountPct}
              min={0}
              max={15}
              step={1}
              valueLabel={`${value.tenantedSaleDiscountPct}%`}
              onChange={v => update('tenantedSaleDiscountPct', v)}
            />
          </Grid>
          <Grid size={{ xs: 12, md: 6 }}>
            <SliderRow
              label="EPC remediation"
              value={value.epcRemediation}
              min={0}
              max={20000}
              step={500}
              valueLabel={`£${value.epcRemediation.toLocaleString()}`}
              onChange={v => update('epcRemediation', v)}
            />
            <SliderRow
              label="Void duration"
              value={value.voidMonths}
              min={0}
              max={12}
              step={1}
              valueLabel={`${value.voidMonths}m`}
              onChange={v => update('voidMonths', v)}
            />
            <Box sx={{ mt: 1 }}>
              <Typography variant="body2" gutterBottom>
                Marginal tax rate
              </Typography>
              <ToggleButtonGroup
                exclusive
                size="small"
                value={value.marginalRatePct}
                onChange={(_, v) => v && update('marginalRatePct', v)}
              >
                <ToggleButton value="20">Basic 20%</ToggleButton>
                <ToggleButton value="40">Higher 40%</ToggleButton>
                <ToggleButton value="45">Additional 45%</ToggleButton>
              </ToggleButtonGroup>
            </Box>
          </Grid>
        </Grid>
      </CardContent>
    </Card>
  );
}

function SliderRow({
  label,
  value,
  min,
  max,
  step,
  valueLabel,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  valueLabel: string;
  onChange: (next: number) => void;
}) {
  return (
    <Box sx={{ mb: 2 }}>
      <Stack direction="row" justifyContent="space-between">
        <Typography variant="body2">{label}</Typography>
        <Typography variant="body2" fontWeight={600} sx={{ fontVariantNumeric: 'tabular-nums' }}>
          {valueLabel}
        </Typography>
      </Stack>
      <Slider
        value={value}
        min={min}
        max={max}
        step={step}
        onChange={(_, v) => onChange(typeof v === 'number' ? v : v[0])}
        sx={{ mt: 0.5 }}
      />
    </Box>
  );
}
