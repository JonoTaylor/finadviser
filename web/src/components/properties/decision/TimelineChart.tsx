'use client';

import { Box, Card, CardContent, Stack, Typography } from '@mui/material';

export interface TimelineChartProps {
  /** Months from today until tenancy ends (or null if open-ended). */
  tenancyEndsMonth: number | null;
  /** User-selected sale completion month. */
  saleCompletionMonth: number;
  /** ERC step months across the visible window, from the leading product. */
  ercStepMonths: number[];
  /** Total horizon shown on the chart (months). */
  horizonMonths?: number;
}

/**
 * Lightweight custom SVG Gantt — `@mui/x-charts` doesn't ship a Gantt
 * widget, and we only need three or four horizontal bars + a sale-target
 * marker. Hand-rolling keeps the bundle lean and the layout easy to
 * tweak for the print view in PR-C.
 */
export default function TimelineChart({
  tenancyEndsMonth,
  saleCompletionMonth,
  ercStepMonths,
  horizonMonths = 36,
}: TimelineChartProps) {
  const width = 720;
  const padding = { left: 140, right: 20, top: 20, bottom: 40 };
  const chartWidth = width - padding.left - padding.right;
  const rowHeight = 28;
  const rows = ['Tenancy term', 'ERC tie-in (Y1 red, Y2 amber, Y3+ green)', 'Marketing window'];
  const height = padding.top + rows.length * rowHeight + padding.bottom;

  const xFor = (month: number) =>
    padding.left + (Math.min(Math.max(month, 0), horizonMonths) / horizonMonths) * chartWidth;

  // Tenancy bar: 0 → tenancyEndsMonth (or full window).
  const tenancyEnd = tenancyEndsMonth ?? horizonMonths;

  // ERC tiers: split the timeline into colour zones using ercStepMonths.
  // Convention: first tier is Y1 (red), second Y2 (amber), beyond → green.
  const ercSegments: Array<{ from: number; to: number; color: string }> = [];
  let lastEnd = 0;
  ercStepMonths.forEach((step, i) => {
    ercSegments.push({
      from: lastEnd,
      to: Math.min(step, horizonMonths),
      color: i === 0 ? '#c0392b' : i === 1 ? '#d68910' : '#1e8449',
    });
    lastEnd = step;
  });
  ercSegments.push({ from: lastEnd, to: horizonMonths, color: '#1e8449' });

  // Marketing window: 60 days before tenancy ends to 30 days after (illustrative
  // of clause 9.43-style last-60-days carve-out).
  const marketingStart = Math.max(0, tenancyEnd - 2);
  const marketingEnd = Math.min(horizonMonths, tenancyEnd + 1);

  return (
    <Card variant="outlined">
      <CardContent>
        <Typography variant="h6" gutterBottom>
          Timeline
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
          Horizontal bars are durations; the vertical marker is your target sale
          completion.
        </Typography>
        <Box sx={{ width: '100%', overflowX: 'auto' }}>
          <svg viewBox={`0 0 ${width} ${height}`} width="100%" height={height} role="img" aria-label="Timeline chart">
            {/* x-axis ticks every 6 months */}
            {Array.from({ length: Math.floor(horizonMonths / 6) + 1 }).map((_, i) => {
              const month = i * 6;
              const x = xFor(month);
              return (
                <g key={month}>
                  <line
                    x1={x}
                    y1={padding.top}
                    x2={x}
                    y2={height - padding.bottom}
                    stroke="#e0e0e0"
                    strokeDasharray="2 2"
                  />
                  <text x={x} y={height - padding.bottom + 16} fontSize="11" textAnchor="middle" fill="#666">
                    +{month}m
                  </text>
                </g>
              );
            })}

            {/* Row labels */}
            {rows.map((label, i) => (
              <text
                key={label}
                x={padding.left - 8}
                y={padding.top + i * rowHeight + rowHeight * 0.66}
                fontSize="12"
                textAnchor="end"
                fill="#444"
              >
                {label}
              </text>
            ))}

            {/* Tenancy bar */}
            <rect
              x={xFor(0)}
              y={padding.top + 4}
              width={xFor(tenancyEnd) - xFor(0)}
              height={rowHeight - 8}
              fill="#1f3a68"
              opacity={0.85}
            />

            {/* ERC tier bars */}
            {ercSegments.map((seg, i) => (
              <rect
                key={i}
                x={xFor(seg.from)}
                y={padding.top + rowHeight + 4}
                width={Math.max(0, xFor(seg.to) - xFor(seg.from))}
                height={rowHeight - 8}
                fill={seg.color}
                opacity={0.5}
              />
            ))}

            {/* Marketing window */}
            <rect
              x={xFor(marketingStart)}
              y={padding.top + 2 * rowHeight + 4}
              width={Math.max(0, xFor(marketingEnd) - xFor(marketingStart))}
              height={rowHeight - 8}
              fill="#7d3c98"
              opacity={0.7}
            />

            {/* Sale completion marker */}
            <line
              x1={xFor(saleCompletionMonth)}
              y1={padding.top - 4}
              x2={xFor(saleCompletionMonth)}
              y2={height - padding.bottom + 4}
              stroke="#000"
              strokeWidth={2}
              strokeDasharray="4 2"
            />
            <text
              x={xFor(saleCompletionMonth)}
              y={padding.top - 8}
              fontSize="11"
              textAnchor="middle"
              fill="#000"
            >
              Sale (+{saleCompletionMonth}m)
            </text>
          </svg>
        </Box>

        <Stack direction="row" spacing={2} sx={{ mt: 1 }} flexWrap="wrap" useFlexGap>
          <LegendChip color="#1f3a68" label="Tenancy" />
          <LegendChip color="#c0392b" label="ERC year 1" />
          <LegendChip color="#d68910" label="ERC year 2" />
          <LegendChip color="#1e8449" label="ERC expired" />
          <LegendChip color="#7d3c98" label="Marketing window" />
        </Stack>
      </CardContent>
    </Card>
  );
}

function LegendChip({ color, label }: { color: string; label: string }) {
  return (
    <Stack direction="row" alignItems="center" spacing={0.5}>
      <Box sx={{ width: 12, height: 12, bgcolor: color, borderRadius: 0.5 }} />
      <Typography variant="caption">{label}</Typography>
    </Stack>
  );
}
