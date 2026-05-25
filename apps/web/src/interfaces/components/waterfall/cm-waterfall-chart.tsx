'use client';

// @paradigm: sql
// CmWaterfallChart — P&L / CM Waterfall using Visx.
// CF-C6-RENDER-ONLY-1: data comes from metrics.pnlWaterfall BFF procedure.
//   The chart renders pre-computed step values. Zero arithmetic in this component.
// CF-C6-BIGINT-JSON-1: value_mu + cumulative_mu arrive as bigint; formatMoney handles them.
// CF-C6-REGISTRY-ONLY-BFF-1: each step has a definition_id from the registry.
// CF-C6-DRILL-TO-SOURCE-1: clicking a bar opens the drill drawer.
// CF-C6-PERF-A11Y-1: SVG accessible with role="img", title, desc; bar aria-labels.

import { useMemo, useCallback, type ComponentProps } from 'react';
import { Group } from '@visx/group';
import { Bar } from '@visx/shape';
import { scaleLinear, scaleBand } from '@visx/scale';
import { AxisBottom, AxisLeft } from '@visx/axis';
import { useTooltip, Tooltip as VisxTooltip, defaultStyles } from '@visx/tooltip';
import { formatMoney } from '@brain/lib-metrics';

// Visx Tooltip is typed against @types/react@18; we cast to a React-19-compatible
// function component to avoid TS2786 (ForwardRefExoticComponent not assignable to
// the stricter React 19 ReactNode). The runtime behaviour is identical.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const Tooltip = VisxTooltip as unknown as React.FC<ComponentProps<typeof VisxTooltip>>;
import React from 'react';
import { useAppDispatch } from '@/domain/store/hooks.js';
import { openDrillDrawer } from '@/domain/store/ui-slice.js';
// PnlWaterfallRow is defined in the api-gateway domain types.
// Inline a local alias here that mirrors the proto-types shape.
// CF-C6-REGISTRY-ONLY-BFF-1: definition_id traces to registry.
interface PnlWaterfallRow {
  definition_id: string;
  label: string;
  value_mu: bigint;
  cumulative_mu: bigint;
  currency_code: string;
  data_epoch: Date;
}

const MARGIN = { top: 20, right: 20, bottom: 60, left: 80 };
const BAR_COLORS = {
  positive: '#0e9f6e',  // green — revenue / CM lines
  negative: '#dc2626',  // red — cost deductions
  neutral:  '#2563eb',  // blue — summary lines
} as const;

const SUMMARY_IDS = new Set(['cm1_mu', 'cm2_mu', 'cm3_mu', 'net_revenue_mu']);

interface CmWaterfallChartProps {
  steps: PnlWaterfallRow[];
  dataEpoch: Date | string;
  date_start: string;
  date_end: string;
  width?: number;
  height?: number;
}

interface TooltipData {
  label: string;
  valueMu: bigint;
  currencyCode: string;
  definitionId: string;
}

export function CmWaterfallChart({
  steps,
  dataEpoch: _dataEpoch,
  date_start,
  date_end,
  width = 720,
  height = 380,
}: CmWaterfallChartProps) {
  const dispatch = useAppDispatch();
  const { tooltipData, tooltipLeft, tooltipTop, showTooltip, hideTooltip } = useTooltip<TooltipData>();

  const innerWidth = width - MARGIN.left - MARGIN.right;
  const innerHeight = height - MARGIN.top - MARGIN.bottom;

  // Build chart data — PIXEL MATH ONLY.
  // G-REGISTRY-ONLY: the ONLY Number() coercions in this component are for SVG pixel
  // positioning (Visx scale math). These values are stored as *Px fields and NEVER
  // rendered as text.
  // CF-C6-RENDER-ONLY-1: ALL displayed monetary values use formatMoney(bigint, currencyCode)
  // — see Bar tooltip + AxisLeft formatter below. No _mu bigint is ever displayed
  // as Number() output.
  const chartData = useMemo(() => {
    return steps.map((step) => ({
      id: step.definition_id,
      label: step.label,
      // *Px = pixel position only — NOT for display. Never pass to formatMoney.
      // CF-C6-BIGINT-PIXEL-INVARIANT: Number() coercion of _mu bigints is safe ONLY
      // when values stay below Number.MAX_SAFE_INTEGER (2^53 - 1 = 9_007_199_254_740_991).
      // This equals ~₹90,071 crore in paise.  Sugandh-Lok Phase-0 pipeline values are
      // well within this bound (seed data: ~₹18.5L–₹3.2L range).
      // IF a future tenant's total P&L pipeline exceeds ₹90,071 Cr, pixel coordinates
      // will drift slightly (imprecise SVG positioning, NOT a display/financial error —
      // formatMoney still uses the original bigint).  At that scale, replace with a
      // BigInt-aware scale transform.  Revisit when onboarding brands > ₹10,000 Cr ARR.
      cumulativePx: Number(step.cumulative_mu),  // pixel math only — see invariant above
      valuePx: Number(step.value_mu),            // pixel math only — see invariant above
      // Bigint fields for display — ONLY these go to formatMoney():
      value_mu: step.value_mu,       // used in tooltip: formatMoney(value_mu, currency_code)
      cumulative_mu: step.cumulative_mu,
      currencyCode: step.currency_code,
    }));
  }, [steps]);

  // Pixel scale: the extent covers max cumulative + max of absolute values.
  const maxValue = useMemo(() => {
    const vals = chartData.flatMap((d) => [Math.abs(d.valuePx), Math.abs(d.cumulativePx)]);
    return Math.max(...vals, 1);
  }, [chartData]);

  const xScale = useMemo(
    () =>
      scaleBand({
        domain: chartData.map((d) => d.id),
        range: [0, innerWidth],
        padding: 0.3,
      }),
    [chartData, innerWidth],
  );

  const yScale = useMemo(
    () =>
      scaleLinear({
        domain: [0, maxValue * 1.1],
        range: [innerHeight, 0],
        nice: true,
      }),
    [maxValue, innerHeight],
  );

  const handleDrill = useCallback(
    (definitionId: string) => {
      dispatch(openDrillDrawer({ definitionId, date_start, date_end }));
    },
    [dispatch, date_start, date_end],
  );

  const titleId = 'waterfall-chart-title';
  const descId = 'waterfall-chart-desc';

  return (
    <div className="relative">
      <svg
        width={width}
        height={height}
        role="img"
        aria-labelledby={titleId}
        aria-describedby={descId}
        className="overflow-visible"
      >
        <title id={titleId}>P&amp;L Contribution Margin Waterfall</title>
        <desc id={descId}>
          Waterfall chart showing P&amp;L steps from Net Revenue through CM3.
        </desc>

        <Group left={MARGIN.left} top={MARGIN.top}>
          {chartData.map((d) => {
            const x = xScale(d.id) ?? 0;
            const barWidth = xScale.bandwidth();
            const isPositive = d.valuePx >= 0;
            const isSummary = SUMMARY_IDS.has(d.id);

            // Bar pixel dimensions.
            const barHeight = Math.abs(yScale(0) - yScale(Math.abs(d.valuePx)));
            // For deductions (negative): bar sits at top of cumulative.
            // For additions/summary: bar starts at base of cumulative.
            const barY = isPositive ? yScale(d.cumulativePx) : yScale(d.cumulativePx) - barHeight;

            const fillColor = isSummary
              ? BAR_COLORS.neutral
              : isPositive
                ? BAR_COLORS.positive
                : BAR_COLORS.negative;

            // formatMoney for tooltip — bigint, no inline ÷.
            const formattedValue = formatMoney(d.value_mu, d.currencyCode);

            return (
              <Bar
                key={d.id}
                x={x}
                y={barY}
                width={barWidth}
                height={Math.max(barHeight, 2)}
                fill={fillColor}
                rx={2}
                role="graphics-symbol"
                aria-label={`${d.label}: ${formattedValue}`}
                tabIndex={0}
                style={{ cursor: 'pointer', outline: 'none' }}
                onClick={() => handleDrill(d.id)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    handleDrill(d.id);
                  }
                }}
                onMouseEnter={() => {
                  showTooltip({
                    tooltipData: {
                      label: d.label,
                      valueMu: d.value_mu,
                      currencyCode: d.currencyCode,
                      definitionId: d.id,
                    },
                    tooltipLeft: x + MARGIN.left + barWidth / 2,
                    tooltipTop: barY + MARGIN.top - 8,
                  });
                }}
                onMouseLeave={hideTooltip}
              />
            );
          })}

          <AxisLeft
            scale={yScale}
            tickFormat={(v) =>
              formatMoney(BigInt(Math.round(Number(v))), steps[0]?.currency_code ?? 'INR')
            }
            stroke="#9ca3af"
            tickStroke="#9ca3af"
            tickLabelProps={{ fill: '#6b7280', fontSize: 10, textAnchor: 'end' }}
            numTicks={5}
          />

          <AxisBottom
            top={innerHeight}
            scale={xScale}
            tickFormat={(id) => chartData.find((d) => d.id === id)?.label?.split(' ')[0] ?? id}
            stroke="#9ca3af"
            tickStroke="#9ca3af"
            tickLabelProps={{ fill: '#6b7280', fontSize: 10, textAnchor: 'middle' }}
          />
        </Group>
      </svg>

      {tooltipData && (
        <Tooltip
          top={tooltipTop}
          left={tooltipLeft}
          style={{
            ...defaultStyles,
            background: '#1f2937',
            color: '#fff',
            fontSize: 12,
            padding: '6px 10px',
            borderRadius: 4,
          }}
        >
          <strong>{tooltipData.label}</strong>
          <br />
          {/* CF-C6-RENDER-ONLY-1: formatMoney — ONE formatter, bigint */}
          {formatMoney(tooltipData.valueMu, tooltipData.currencyCode)}
          <br />
          <span className="text-gray-300 text-xs">Click to drill into source rows</span>
        </Tooltip>
      )}
    </div>
  );
}
