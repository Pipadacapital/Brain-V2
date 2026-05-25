// @paradigm: sql
// CF-C6-MB-OFFLINE-SLO-1: device-side OTel SLO metric hook.
//
// Emits `morning_brief.render_success_latency_ms{workspace_id}` so the
// 07:20 IST SLO is measured from the device's perspective, not just push-delivery.
//
// The 07:20 IST SLO window: delivery by 07:20 IST on >99.5% of days.
// This module measures render latency from app open to brief rendered on screen.
// In Phase 0-1: metrics are emitted to the console (OTel OTLP exporter = Phase 2).
//
// CF-C6-MB-OFFLINE-SLO-1: record metrics even when offline (stale brief render).

import type { MorningBriefSloMetric } from './types.js';

/**
 * Pending render start time — set when the Morning Brief screen mounts.
 * Cleared when the render is complete (items shown) or on error.
 */
let _renderStartMs: number | null = null;

/** Mark the start of a Morning Brief render attempt. */
export function markMorningBriefRenderStart(): void {
  _renderStartMs = Date.now();
}

/**
 * Emit the render-success SLO metric.
 * CF-C6-MB-OFFLINE-SLO-1: emitted on both online (fresh) and offline (stale) render.
 *
 * In Phase 0-1: logs to console + stored in module-level array for testing.
 * In Phase 2: OTLP exporter sends to the OTel collector.
 *
 * @param workspaceId - for the metric label
 * @param online - false if serving a stale (offline) brief
 */
export function emitMorningBriefRenderSuccess(
  workspaceId: string,
  online: boolean,
): MorningBriefSloMetric | null {
  if (_renderStartMs === null) {
    // No start was marked — this is a programmatic error; do not emit.
    return null;
  }

  const latency = Date.now() - _renderStartMs;
  _renderStartMs = null;

  const today = new Date().toISOString().split('T')[0] ?? '';
  const metric: MorningBriefSloMetric = {
    workspace_id: workspaceId,
    render_success_latency_ms: latency,
    date: today,
    online,
  };

  // Phase 0-1: emit to console + accumulated list.
  _emittedMetrics.push(metric);

  // In production: send via OTLP here.
  // For now: structured log (no PII — CF-C6-PII-CLIENT-1).
  console.info(
    '[morning_brief.render_success_latency_ms]',
    JSON.stringify({
      workspace_id: metric.workspace_id,
      latency_ms: metric.render_success_latency_ms,
      date: metric.date,
      online: metric.online,
    }),
  );

  return metric;
}

// Test accumulator (not exported to consumers; tests read via getEmittedMetrics).
const _emittedMetrics: MorningBriefSloMetric[] = [];

/** For testing: returns all emitted metrics since last clear. */
export function getEmittedMetrics(): readonly MorningBriefSloMetric[] {
  return _emittedMetrics;
}

/** For testing: clear the accumulated metrics. */
export function clearEmittedMetrics(): void {
  _emittedMetrics.length = 0;
  _renderStartMs = null;
}
