/**
 * CF-C6-MB-OFFLINE-SLO-1: Offline stale-but-labeled posture.
 *
 * Tests:
 *   POSITIVE: stale brief retained on offline state.
 *   POSITIVE: offline → stale brief labeled (as-of timestamp present).
 *   POSITIVE: CTAs should be disabled when offline (state gate).
 *   NEGATIVE: blank screen never when brief was fetched — brief not cleared on offline.
 *   POSITIVE: SLO metric emitted even for offline (stale) render.
 */

import { markMorningBriefRenderStart, emitMorningBriefRenderSuccess, clearEmittedMetrics, getEmittedMetrics } from '../src/domain/slo-metric.js';
import morningBriefReducer, {
  setBrief,
  setOffline,
  type MorningBriefState,
} from '../src/application/store/morning-brief-slice.js';
import type { MorningBrief } from '../src/domain/types.js';

const SEED_BRIEF: MorningBrief = {
  items: [
    {
      insight_id: 'offline-test-insight-1',
      title: 'Test insight',
      severity: 'INFO',
      confidence_display_pct: 80,
      summary: 'Test summary.',
      detail: 'Test detail.',
      recommendation: {
        action: 'REVIEW_MANUALLY',
        entity_id: 'test',
        rationale: 'Test rationale.',
      },
      expected_impact: {
        revenue_mu: 1_000_000n,
        cm2_mu: 500_000n,
        currency_code: 'INR',
        impact_label: '+₹10K',
      },
      risk: 'LOW',
      data_epoch: new Date('2026-05-25T00:00:00Z'),
    },
  ],
  data_epoch: new Date('2026-05-25T00:00:00Z'),
  freshness_label: 'Live',
};

// ---------------------------------------------------------------------------
// Stale-but-labeled posture — Redux slice
// ---------------------------------------------------------------------------
describe('Offline stale-but-labeled posture', () => {
  const baseState: MorningBriefState = {
    brief: null,
    fetchedAt: null,
    isOffline: false,
    isFetching: false,
    fetchError: null,
    responses: {},
  };

  // -------------------------------------------------------------------------
  // POSITIVE: brief retained when going offline.
  // CF-C6-MB-OFFLINE-SLO-1: stale-but-labeled; never blank in 07:00-09:00 IST.
  // -------------------------------------------------------------------------
  it('going offline retains the last-fetched brief (stale-but-labeled)', () => {
    const withBrief = morningBriefReducer(
      baseState,
      setBrief({ brief: SEED_BRIEF, fetchedAt: '2026-05-25T07:05:00.000Z' }),
    );
    const offline = morningBriefReducer(withBrief, setOffline());

    expect(offline.isOffline).toBe(true);
    expect(offline.brief).not.toBeNull();
    expect(offline.brief!.items).toHaveLength(1);
    // The fetchedAt is the staleness label timestamp.
    expect(offline.fetchedAt).toBe('2026-05-25T07:05:00.000Z');
  });

  // -------------------------------------------------------------------------
  // NEGATIVE: brief is null before any fetch — offline shows no brief.
  // (This is unavoidable: app never fetched, so no brief to show.)
  // -------------------------------------------------------------------------
  it('if never fetched: offline results in no brief (blank → empty-state UI)', () => {
    const offline = morningBriefReducer(baseState, setOffline());
    expect(offline.brief).toBeNull();
    // fetchedAt null → the screen shows empty-state, not a blank (empty-state is not blank).
    expect(offline.fetchedAt).toBeNull();
  });

  // -------------------------------------------------------------------------
  // POSITIVE: CTAs must be disabled when isOffline=true (state gate).
  // The screen component gates CTAs on isOffline from Redux state.
  // -------------------------------------------------------------------------
  it('isOffline=true is the gate for CTA disabled state in the screen', () => {
    const withBrief = morningBriefReducer(
      baseState,
      setBrief({ brief: SEED_BRIEF, fetchedAt: '2026-05-25T07:05:00.000Z' }),
    );
    const offline = morningBriefReducer(withBrief, setOffline());

    // The screen reads: const ctasDisabled = isOffline || isSettled;
    // This test verifies the state that drives CTA disabled.
    expect(offline.isOffline).toBe(true);
    // CTAs are disabled when isOffline = true (enforced in the screen component).
  });
});

// ---------------------------------------------------------------------------
// OTel SLO metric — CF-C6-MB-OFFLINE-SLO-1
// ---------------------------------------------------------------------------
describe('OTel SLO metric: emitted for both online and offline render', () => {
  beforeEach(() => clearEmittedMetrics());

  it('emits metric with online=true on successful fetch', () => {
    markMorningBriefRenderStart();
    const metric = emitMorningBriefRenderSuccess('workspace-1', true);
    expect(metric).not.toBeNull();
    expect(metric!.online).toBe(true);
    expect(metric!.workspace_id).toBe('workspace-1');
    expect(metric!.render_success_latency_ms).toBeGreaterThanOrEqual(0);
  });

  it('emits metric with online=false for stale (offline) render', () => {
    markMorningBriefRenderStart();
    const metric = emitMorningBriefRenderSuccess('workspace-1', false);
    expect(metric).not.toBeNull();
    expect(metric!.online).toBe(false);
  });

  it('accumulates metrics in the emitted metrics list', () => {
    markMorningBriefRenderStart();
    emitMorningBriefRenderSuccess('ws-a', true);
    markMorningBriefRenderStart();
    emitMorningBriefRenderSuccess('ws-a', false);
    expect(getEmittedMetrics()).toHaveLength(2);
  });

  it('returns null if no markMorningBriefRenderStart() called', () => {
    clearEmittedMetrics();
    const metric = emitMorningBriefRenderSuccess('workspace-1', true);
    expect(metric).toBeNull();
  });

  it('latency_ms is non-negative', () => {
    markMorningBriefRenderStart();
    const metric = emitMorningBriefRenderSuccess('workspace-1', true);
    expect(metric!.render_success_latency_ms).toBeGreaterThanOrEqual(0);
  });
});
