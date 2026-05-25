// @paradigm: sql
// CF-C6-RENDER-ONLY-1: ZERO metric arithmetic in this slice.
// All values come from the server. Slice stores, not computes.
//
// CF-C6-MB-OFFLINE-SLO-1: stale-but-labeled posture — last known brief
// is persisted so the offline path shows content, never a blank screen.
//
// CF-C6-MB-IDEMPOTENCY-1: settled insight map persisted (within session)
// so that a retry reuses the same idempotency_key.

import { createSlice, type PayloadAction } from '@reduxjs/toolkit';
import type { MorningBrief, InsightResponseState, GraduationStatus } from '../../domain/types.js';

/** State shape for the Morning Brief Redux slice. */
export interface MorningBriefState {
  /**
   * The live Morning Brief — null until first successful fetch.
   * CF-THREE-SIGNAL: items.length <= 3. Never more. Server-enforced.
   */
  brief: MorningBrief | null;

  /**
   * ISO timestamp when brief was last successfully fetched.
   * Used for the "as of" staleness label. CF-C6-AS-OF-STAMP-1.
   */
  fetchedAt: string | null;

  /** Whether the device is offline. CF-C6-MB-OFFLINE-SLO-1. */
  isOffline: boolean;

  /** Whether a fetch is in flight. */
  isFetching: boolean;

  /** Fetch error message (surfaced with request_id, no PII). CF-C6-PII-CLIENT-1. */
  fetchError: string | null;

  /**
   * Per-insight response states.
   * Maps insight_id → InsightResponseState.
   * CF-C6-MB-IDEMPOTENCY-1: idempotency_key persisted here within session.
   */
  responses: Record<string, InsightResponseState>;
}

const initialState: MorningBriefState = {
  brief: null,
  fetchedAt: null,
  isOffline: false,
  isFetching: false,
  fetchError: null,
  responses: {},
};

export const morningBriefSlice = createSlice({
  name: 'morningBrief',
  initialState,
  reducers: {
    /** Set the brief after a successful fetch. Clears the error. */
    setBrief(state, action: PayloadAction<{ brief: MorningBrief; fetchedAt: string }>) {
      state.brief = action.payload.brief;
      state.fetchedAt = action.payload.fetchedAt;
      state.fetchError = null;
      state.isOffline = false;
    },

    /** Mark the device as offline. The stale brief (if any) is retained. */
    setOffline(state) {
      state.isOffline = true;
    },

    /** Mark the device as back online. */
    setOnline(state) {
      state.isOffline = false;
    },

    /** Set fetching state. */
    setFetching(state, action: PayloadAction<boolean>) {
      state.isFetching = action.payload;
    },

    /** Set fetch error (surfaces request_id; no PII). CF-C6-PII-CLIENT-1. */
    setFetchError(state, action: PayloadAction<string>) {
      state.fetchError = action.payload;
    },

    /**
     * Initiate a response for an insight.
     * CF-C6-MB-IDEMPOTENCY-1: idempotency_key set here at action-initiation.
     * If an unsettled action exists for this insight, keep its key (retry path).
     */
    initiateResponse(
      state,
      action: PayloadAction<{
        insight_id: string;
        idempotency_key: string;
        response_kind: 'APPROVE' | 'REJECT' | 'EDIT';
        edit_payload?: string;
      }>,
    ) {
      const { insight_id, idempotency_key, response_kind, edit_payload } = action.payload;
      const existing = state.responses[insight_id];

      if (existing && !existing.settled) {
        // Unsettled action exists: UPDATE kind/payload but KEEP the idempotency_key.
        // CF-C6-MB-IDEMPOTENCY-1: never swap the key on a retry.
        state.responses[insight_id] = {
          ...existing,
          response_kind,
          edit_payload,
        };
      } else {
        // New action or re-action after settle.
        state.responses[insight_id] = {
          insight_id,
          idempotency_key,
          response_kind,
          edit_payload,
          settled: false,
        };
      }
    },

    /**
     * Settle a response after a non-error server reply.
     * CF-C6-MB-GRADUATED-LABEL-1: status from server, never inferred.
     * CF-C6-MB-IDEMPOTENCY-1: settled=true means future retries get a new key.
     */
    settleResponse(
      state,
      action: PayloadAction<{
        insight_id: string;
        status: GraduationStatus;
        decision_log_row_id: string;
      }>,
    ) {
      const { insight_id, status, decision_log_row_id } = action.payload;
      const existing = state.responses[insight_id];
      if (existing) {
        state.responses[insight_id] = {
          ...existing,
          settled: true,
          status,
          decision_log_row_id,
        };
      }
    },

    /** Clear all response state (e.g., on new day / new brief). */
    clearResponses(state) {
      state.responses = {};
    },
  },
});

export const {
  setBrief,
  setOffline,
  setOnline,
  setFetching,
  setFetchError,
  initiateResponse,
  settleResponse,
  clearResponses,
} = morningBriefSlice.actions;

export default morningBriefSlice.reducer;
