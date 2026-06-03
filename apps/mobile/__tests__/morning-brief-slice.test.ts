/**
 * Morning Brief Redux slice — unit tests.
 *
 * Tests:
 *   POSITIVE: setBrief stores brief + fetchedAt, clears error.
 *   POSITIVE: setOffline marks isOffline=true; cached brief retained.
 *   POSITIVE: initiateResponse generates idempotency_key at initiation.
 *   POSITIVE: initiateResponse with unsettled action: KEEPS same idempotency_key.
 *   POSITIVE: settleResponse marks settled=true with server-provided status.
 *   NEGATIVE (offline): offline state does not clear the brief (stale-but-labeled).
 *   NEGATIVE: initiateResponse on unsettled: never swaps the idempotency_key.
 */

import morningBriefReducer, {
  setBrief,
  setOffline,
  setOnline,
  setFetching,
  setFetchError,
  initiateResponse,
  settleResponse,
  clearResponses,
  type MorningBriefState,
} from '../src/application/store/morning-brief-slice.js';
import type { MorningBrief } from '../src/domain/types.js';

const SEED_BRIEF: MorningBrief = {
  items: [
    {
      insight_id: '11111111-1111-1111-1111-111111111111',
      title: 'RTO rate above 18%',
      severity: 'WARNING',
      confidence_display_pct: 91,
      summary: 'Return-to-origin rate crossed 18%.',
      detail: 'SKUs #SL-042 and #SL-108 account for 62% of RTO volume.',
      recommendation: {
        action: 'REVIEW_MANUALLY',
        entity_id: 'SL-042',
        rationale: 'Catalogue quality issues.',
      },
      expected_impact: {
        revenue_mu: 3_700_000n,
        cm2_mu: 1_200_000n,
        currency_code: 'INR',
        impact_label: '+₹37K net revenue',
      },
      risk: 'LOW',
      // mobile-5: data_epoch is an ISO string, not a Date (redux-persist rehydrates JSON as string)
      data_epoch: '2026-05-25T00:00:00.000Z',
    },
  ],
  // mobile-5: data_epoch is an ISO string, not a Date
  data_epoch: '2026-05-25T00:00:00.000Z',
  freshness_label: 'Live',
};

describe('MorningBriefSlice — state transitions', () => {
  const initialState: MorningBriefState = {
    brief: null,
    fetchedAt: null,
    isOffline: false,
    isFetching: false,
    fetchError: null,
    responses: {},
  };

  // -------------------------------------------------------------------------
  // POSITIVE: setBrief
  // -------------------------------------------------------------------------
  it('setBrief stores brief and fetchedAt, clears error', () => {
    const state = morningBriefReducer(
      { ...initialState, fetchError: 'prev error' },
      setBrief({ brief: SEED_BRIEF, fetchedAt: '2026-05-25T07:00:00.000Z' }),
    );
    expect(state.brief).toEqual(SEED_BRIEF);
    expect(state.fetchedAt).toBe('2026-05-25T07:00:00.000Z');
    expect(state.fetchError).toBeNull();
    expect(state.isOffline).toBe(false);
  });

  // -------------------------------------------------------------------------
  // POSITIVE: setOffline — brief retained (stale-but-labeled).
  // CF-C6-MB-OFFLINE-SLO-1: never clears brief on offline.
  // -------------------------------------------------------------------------
  it('setOffline: marks isOffline=true AND retains the stale brief', () => {
    const withBrief: MorningBriefState = {
      ...initialState,
      brief: SEED_BRIEF,
      fetchedAt: '2026-05-25T07:00:00.000Z',
    };
    const state = morningBriefReducer(withBrief, setOffline());
    expect(state.isOffline).toBe(true);
    // CRITICAL: brief is NOT cleared. Stale-but-labeled posture.
    expect(state.brief).toEqual(SEED_BRIEF);
    expect(state.fetchedAt).toBe('2026-05-25T07:00:00.000Z');
  });

  // -------------------------------------------------------------------------
  // NEGATIVE: setOffline on a state with no brief — still no brief.
  // (Can't show content if never fetched — this is expected.)
  // -------------------------------------------------------------------------
  it('setOffline with no prior brief: brief remains null', () => {
    const state = morningBriefReducer(initialState, setOffline());
    expect(state.isOffline).toBe(true);
    expect(state.brief).toBeNull();
  });

  // -------------------------------------------------------------------------
  // POSITIVE: setOnline
  // -------------------------------------------------------------------------
  it('setOnline: clears isOffline flag', () => {
    const offlineState = { ...initialState, isOffline: true };
    const state = morningBriefReducer(offlineState, setOnline());
    expect(state.isOffline).toBe(false);
  });

  // -------------------------------------------------------------------------
  // POSITIVE: setFetching
  // -------------------------------------------------------------------------
  it('setFetching(true) and setFetching(false)', () => {
    const s1 = morningBriefReducer(initialState, setFetching(true));
    expect(s1.isFetching).toBe(true);
    const s2 = morningBriefReducer(s1, setFetching(false));
    expect(s2.isFetching).toBe(false);
  });

  // -------------------------------------------------------------------------
  // POSITIVE: setFetchError
  // -------------------------------------------------------------------------
  it('setFetchError stores error message', () => {
    const state = morningBriefReducer(
      initialState,
      setFetchError('Fetch failed: timeout. request_id=abc-123'),
    );
    expect(state.fetchError).toBe('Fetch failed: timeout. request_id=abc-123');
  });

  // -------------------------------------------------------------------------
  // POSITIVE: initiateResponse — first tap.
  // CF-C6-MB-IDEMPOTENCY-1: key set at initiation.
  // -------------------------------------------------------------------------
  it('initiateResponse: stores idempotency_key and response_kind for new action', () => {
    const state = morningBriefReducer(
      initialState,
      initiateResponse({
        insight_id: '11111111-1111-1111-1111-111111111111',
        idempotency_key: 'aaaa-bbbb-cccc-dddd-eeee',
        response_kind: 'APPROVE',
      }),
    );
    const resp = state.responses['11111111-1111-1111-1111-111111111111'];
    expect(resp).toBeDefined();
    expect(resp!.idempotency_key).toBe('aaaa-bbbb-cccc-dddd-eeee');
    expect(resp!.response_kind).toBe('APPROVE');
    expect(resp!.settled).toBe(false);
  });

  // -------------------------------------------------------------------------
  // POSITIVE: initiateResponse on unsettled → KEEPS same key (offline-replay).
  // CF-C6-MB-IDEMPOTENCY-1: NEVER swap the key on retry.
  // -------------------------------------------------------------------------
  it('initiateResponse on unsettled action: keeps the SAME idempotency_key', () => {
    const withFirst = morningBriefReducer(
      initialState,
      initiateResponse({
        insight_id: 'insight-x',
        idempotency_key: 'first-key-uuid',
        response_kind: 'APPROVE',
      }),
    );
    const withRetry = morningBriefReducer(
      withFirst,
      initiateResponse({
        insight_id: 'insight-x',
        idempotency_key: 'second-key-uuid',  // would be a NEW key if generated naively
        response_kind: 'APPROVE',
      }),
    );
    // The reducer should KEEP the first key (unsettled path).
    expect(withRetry.responses['insight-x']!.idempotency_key).toBe('first-key-uuid');
    expect(withRetry.responses['insight-x']!.settled).toBe(false);
  });

  // -------------------------------------------------------------------------
  // POSITIVE: settleResponse — marks settled with server status.
  // CF-C6-MB-GRADUATED-LABEL-1: status from server, never inferred.
  // -------------------------------------------------------------------------
  it('settleResponse: marks settled=true with server-provided status', () => {
    const withInitiated = morningBriefReducer(
      initialState,
      initiateResponse({
        insight_id: 'insight-y',
        idempotency_key: 'key-y-uuid',
        response_kind: 'APPROVE',
      }),
    );
    const state = morningBriefReducer(
      withInitiated,
      settleResponse({
        insight_id: 'insight-y',
        status: 'LOGGED_AS_VOTE',
        decision_log_row_id: 'row_1',
      }),
    );
    const resp = state.responses['insight-y'];
    expect(resp!.settled).toBe(true);
    expect(resp!.status).toBe('LOGGED_AS_VOTE');
    expect(resp!.decision_log_row_id).toBe('row_1');
  });

  // -------------------------------------------------------------------------
  // POSITIVE: clearResponses — wipes all response state.
  // -------------------------------------------------------------------------
  it('clearResponses: wipes all per-insight responses', () => {
    const withResponses = morningBriefReducer(
      initialState,
      initiateResponse({
        insight_id: 'insight-z',
        idempotency_key: 'key-z',
        response_kind: 'REJECT',
      }),
    );
    const state = morningBriefReducer(withResponses, clearResponses());
    expect(Object.keys(state.responses)).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// THREE-SIGNAL RULE: slice does not enforce (server does), but we test the
// brief's items length assertion in the screen via slice tests.
// ---------------------------------------------------------------------------
describe('THREE-SIGNAL RULE: brief items', () => {
  it('a brief with exactly 3 items is valid', () => {
    const threeItemBrief: MorningBrief = {
      items: [
        { ...SEED_BRIEF.items[0]!, insight_id: 'a' },
        { ...SEED_BRIEF.items[0]!, insight_id: 'b' },
        { ...SEED_BRIEF.items[0]!, insight_id: 'c' },
      ],
      // mobile-5: ISO string, not Date
      data_epoch: new Date().toISOString(),
      freshness_label: 'Live',
    };
    const state = morningBriefReducer(
      { brief: null, fetchedAt: null, isOffline: false, isFetching: false, fetchError: null, responses: {} },
      setBrief({ brief: threeItemBrief, fetchedAt: '2026-05-25T07:00:00.000Z' }),
    );
    expect(state.brief!.items).toHaveLength(3);
  });
});
