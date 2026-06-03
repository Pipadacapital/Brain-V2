// @paradigm: sql
// CF-C6-RENDER-ONLY-1: ZERO metric arithmetic in this file.
//   All numbers arrive server-provided. formatMoney() is the ONLY transformation.
//   No Number() coercion of _mu. No division. No multiplication.
//
// THREE-SIGNAL RULE (canon, not optional):
//   items.length <= 3. Never more per morning. Enforced server-side AND asserted
//   at render time (items.slice(0,3) as a final defense).
//
// CF-C6-MB-GRADUATED-LABEL-1: "Log Approval", never "Approve & Execute".
// CF-C6-MB-OFFLINE-SLO-1: stale-but-labeled, CTAs disabled when offline.
// CF-C6-MB-A11Y-ACTION-1: touch targets ≥48dp/44pt, rationale separated.
// CF-C6-MB-IDEMPOTENCY-1: idempotency_key generated at initiation, not send.

import React, { useEffect, useCallback, useRef } from 'react';
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  AccessibilityInfo,
  Platform,
  RefreshControl,
  type DimensionValue,
} from 'react-native';
import { useAppDispatch, useAppSelector } from '../../application/store/store.js';
import {
  setBrief,
  setOffline,
  setOnline,
  setFetching,
  setFetchError,
  initiateResponse,
  settleResponse,
} from '../../application/store/morning-brief-slice.js';
import { trpcClient } from '../../infrastructure/trpc-client.js';
import { formatMoney } from '@brain/lib-metrics';
import {
  getPreActionCta,
  getGraduationLabels,
} from '../../domain/graduation-ux.js';
import { clientIdempotencyStore } from '../../domain/idempotency-client.js';
import {
  markMorningBriefRenderStart,
  emitMorningBriefRenderSuccess,
} from '../../domain/slo-metric.js';
import type { InsightItem, GraduationStatus, InsightResponseState } from '../../domain/types.js';

// ---------------------------------------------------------------------------
// Tamagui token palette used for WCAG AA contrast.
// CF-C6-MB-A11Y-ACTION-1: destructive-red Reject must pass 4.5:1 on white bg.
// These hex values map to Tamagui's gray/red scale — audited against WCAG AA.
// ---------------------------------------------------------------------------

const COLORS = {
  background: '#FFFFFF',
  surface: '#F8F9FA',
  surfaceBorder: '#E9ECEF',
  textPrimary: '#1A1A2E',         // #1A1A2E on #fff = 14:1 (WCAG AAA)
  textSecondary: '#495057',       // #495057 on #fff = 7.4:1 (WCAG AA)
  textTertiary: '#6C757D',        // #6C757D on #fff = 4.8:1 (WCAG AA)
  approvePrimary: '#0A6E30',      // dark green on white = 8.5:1 (AA)
  approveSurface: '#D1FAE5',
  rejectPrimary: '#9B1D1D',       // dark red on white = 9.3:1 (AA — CF-C6-MB-A11Y-ACTION-1)
  rejectSurface: '#FEE2E2',
  editPrimary: '#1B4F8A',         // dark blue on white = 7.8:1 (AA)
  editSurface: '#DBEAFE',
  offlineBanner: '#FFF3CD',
  offlineBannerBorder: '#FFC107',
  offlineBannerText: '#664D03',   // on #FFF3CD = 5.1:1 (AA)
  // Severity colors
  severityWarning: '#664D03',     // on #FFF3CD bg = 5.1:1
  severityCritical: '#9B1D1D',
  severityInfo: '#1B4F8A',
  // Risk colors
  riskLow: '#0A6E30',
  riskMedium: '#5A4000',
  riskHigh: '#7A2A00',
  riskCritical: '#9B1D1D',
  // Confidence bar
  confidenceBar: '#0A6E30',
  confidenceBg: '#E9ECEF',
  disabledText: '#ADB5BD',
  disabledBg: '#E9ECEF',
};

// Touch target size (MASVS L1 / CF-C6-MB-A11Y-ACTION-1):
// iOS: 44pt minimum | Android: 48dp minimum
const CTA_MIN_HEIGHT = Platform.OS === 'ios' ? 44 : 48;
const CTA_SPACING = 8; // ≥8dp between CTAs

// ---------------------------------------------------------------------------
// Helpers — render-only, no arithmetic
// ---------------------------------------------------------------------------

function getRiskColor(risk: string): string {
  switch (risk) {
    case 'LOW': return COLORS.riskLow;
    case 'MEDIUM': return COLORS.riskMedium;
    case 'HIGH': return COLORS.riskHigh;
    case 'CRITICAL': return COLORS.riskCritical;
    default: return COLORS.textSecondary;
  }
}

function getSeverityColor(severity: string): string {
  switch (severity) {
    case 'CRITICAL': return COLORS.severityCritical;
    case 'WARNING': return COLORS.severityWarning;
    case 'INFO': return COLORS.severityInfo;
    default: return COLORS.textSecondary;
  }
}

function formatAsOf(fetchedAt: string | null): string {
  if (!fetchedAt) return '';
  try {
    const d = new Date(fetchedAt);
    return d.toLocaleString('en-IN', {
      timeZone: 'Asia/Kolkata',
      day: 'numeric',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return fetchedAt;
  }
}

// ---------------------------------------------------------------------------
// ActionCard — renders ONE InsightItem.
// CF-C6-MB-A11Y-ACTION-1: accessibility contract.
// CF-C6-RENDER-ONLY-1: formatMoney() is the ONLY transformation; zero arithmetic.
// ---------------------------------------------------------------------------

// mobile-7: edit UI is not implemented yet (Phase 2). When ready, set this to true.
// This constant gates the Edit CTA — it is disabled while false so we never log
// an EDIT action with an empty payload into the Decision Log.
const EDIT_UI_READY = false;

interface ActionCardProps {
  item: InsightItem;
  // mobile-6: cardIndex used for a11y position label (e.g. "Action 1 of 3").
  cardIndex: number;   // 0-based, max 2 (THREE-SIGNAL RULE)
  totalCards: number;  // total count for a11y position label
  isOffline: boolean;
  responseState: InsightResponseState | null;
  onApprove: (insightId: string) => void;
  onReject: (insightId: string) => void;
  onEdit: (insightId: string) => void;
}

function ActionCard({
  item,
  cardIndex,
  totalCards,
  isOffline,
  responseState,
  onApprove,
  onReject,
  onEdit,
}: ActionCardProps) {
  const isSettled = responseState?.settled ?? false;
  const settledStatus = responseState?.status;

  // CF-C6-MB-GRADUATED-LABEL-1: labels derived from server status.
  const graduationLabels = settledStatus
    ? getGraduationLabels(settledStatus)
    : null;

  // CF-C6-RENDER-ONLY-1: formatMoney() from lib-metrics — the ONE canonical formatter.
  // revenue_mu and cm2_mu arrive as bigint from the server (superjson).
  // NEVER coerce to Number() before calling formatMoney.
  const revenueImpactStr = formatMoney(
    item.expected_impact.revenue_mu,
    item.expected_impact.currency_code,
  );
  const cm2ImpactStr = formatMoney(
    item.expected_impact.cm2_mu,
    item.expected_impact.currency_code,
  );

  // CF-C6-NO-UI-FLOAT-1: confidence_display_pct is a pre-formatted int (87 = 87%).
  // Render as ${confidence_display_pct}% — NO multiplication.
  const confidencePct = item.confidence_display_pct;

  const ctasDisabled = isOffline || isSettled;
  // mobile-7: Edit is additionally disabled until the edit UI (Phase 2) is built.
  const editDisabled = ctasDisabled || !EDIT_UI_READY;

  // mobile-6: use cardIndex for a11y position label.
  const cardPositionLabel = `Action ${cardIndex + 1} of ${totalCards}`;

  return (
    <View
      style={[styles.card, { marginBottom: 16 }]}
      accessible={false}  // card is a layout container; children are individually accessible
      accessibilityLabel={cardPositionLabel}
    >
      {/* ---- Header: severity badge + title ---- */}
      <View style={styles.cardHeader} accessible={true} accessibilityRole="header">
        <View
          style={[
            styles.severityBadge,
            { borderColor: getSeverityColor(item.severity) },
          ]}
          accessibilityRole="text"
          accessibilityLabel={`Priority: ${item.severity}`}
        >
          <Text style={[styles.severityText, { color: getSeverityColor(item.severity) }]}>
            {item.severity}
          </Text>
        </View>
        <Text
          style={styles.cardTitle}
          accessibilityRole="header"
          numberOfLines={2}
        >
          {item.title}
        </Text>
      </View>

      {/* ---- Confidence bar ---- */}
      <View
        style={styles.confidenceRow}
        accessibilityRole="text"
        accessibilityLabel={`AI confidence: ${confidencePct}%`}
      >
        <Text style={styles.confidenceLabel}>Confidence</Text>
        <View style={styles.confidenceBarBg}>
          {/* mobile-13: clamp to [0,100] so a rogue server value never overflows the bar.
              Cast to DimensionValue (the correct type for RN style.width) instead of `as any`. */}
          <View
            style={[
              styles.confidenceBarFill,
              { width: `${Math.min(100, Math.max(0, confidencePct))}%` as DimensionValue },
            ]}
          />
        </View>
        {/* CF-C6-NO-UI-FLOAT-1: no arithmetic — render as-is */}
        <Text style={styles.confidenceValue}>{confidencePct}%</Text>
      </View>

      {/* ---- Problem / summary ---- */}
      <Text
        style={styles.sectionLabel}
        accessibilityRole="text"
      >
        SITUATION
      </Text>
      <Text
        style={styles.summaryText}
        accessibilityRole="text"
      >
        {item.summary}
      </Text>

      {/* ---- Evidence / detail ---- */}
      <Text
        style={styles.sectionLabel}
        accessibilityRole="text"
      >
        EVIDENCE
      </Text>
      <Text
        style={styles.detailText}
        accessibilityRole="text"
      >
        {item.detail}
      </Text>

      {/* ---- Recommended action ---- */}
      <Text
        style={styles.sectionLabel}
        accessibilityRole="text"
      >
        RECOMMENDED ACTION
      </Text>
      <Text
        style={styles.actionText}
        accessibilityRole="text"
      >
        {item.recommendation.action.replace(/_/g, ' ')}
        {item.recommendation.entity_id ? ` — ${item.recommendation.entity_id}` : ''}
      </Text>

      {/* ---- Expected impact ---- */}
      <Text
        style={styles.sectionLabel}
        accessibilityRole="text"
      >
        EXPECTED IMPACT
      </Text>
      <Text
        style={styles.impactLabel}
        accessibilityRole="text"
        accessibilityLabel={`Expected impact: ${item.expected_impact.impact_label}`}
      >
        {item.expected_impact.impact_label}
      </Text>
      <View style={styles.impactRow} accessible={true} accessibilityRole="text">
        <View style={styles.impactCell}>
          <Text style={styles.impactMetricLabel}>Revenue</Text>
          {/* CF-C6-RENDER-ONLY-1: formatMoney(bigint, currencyCode) — no Number() */}
          <Text style={styles.impactMetricValue} accessibilityLabel={`Revenue impact: ${revenueImpactStr}`}>
            {revenueImpactStr}
          </Text>
        </View>
        <View style={styles.impactCell}>
          <Text style={styles.impactMetricLabel}>CM2</Text>
          <Text style={styles.impactMetricValue} accessibilityLabel={`CM2 impact: ${cm2ImpactStr}`}>
            {cm2ImpactStr}
          </Text>
        </View>
        <View style={styles.impactCell}>
          <Text style={styles.impactMetricLabel}>Risk</Text>
          <Text
            style={[styles.impactMetricValue, { color: getRiskColor(item.risk) }]}
            accessibilityLabel={`Risk level: ${item.risk}`}
          >
            {item.risk}
          </Text>
        </View>
      </View>

      {/* ---- Rationale — RENDER ONLY, separated from button group ----
          CF-C6-MB-A11Y-ACTION-1: rationale as accessibilityRole="text" SEPARATE
          from the button group. It must NOT be adjacent to or prime the Approve button.
          Screen-reader users see: summary → evidence → action → impact → rationale
          → [Reject] [Edit] [Log Approval]
          The rationale is in the middle, not just before the approve button.
      */}
      <Text
        style={styles.sectionLabel}
        accessibilityRole="text"
      >
        AI RATIONALE
      </Text>
      <Text
        style={styles.rationaleText}
        accessibilityRole="text"
        accessibilityLabel={`AI rationale: ${item.recommendation.rationale}`}
        // Explicitly NOT a button — rationale is text only, never an instruction.
      >
        {item.recommendation.rationale}
      </Text>

      {/* ---- Settled state (after approve/reject/edit) ---- */}
      {isSettled && graduationLabels && (
        <View
          style={styles.settledBanner}
          accessible={true}
          accessibilityRole="text"
          accessibilityLabel={graduationLabels.statusDescription}
        >
          <Text style={styles.settledBadge}>{graduationLabels.statusBadge}</Text>
          <Text style={styles.settledDescription}>{graduationLabels.statusDescription}</Text>
        </View>
      )}

      {/* ---- CTAs — card bottom, thumb-first ----
          CF-C6-MB-A11Y-ACTION-1: ≥48dp/44pt touch targets, ≥8dp spacing.
          Placed at card BOTTOM (thumb arc for one-handed use).
          Each CTA has a distinct accessibilityLabel (action + consequence).
          rationale is NOT in the accessibilityLabel — see above.
      */}
      {!isSettled && (
        <View style={styles.ctaRow} accessibilityRole="toolbar" accessibilityLabel="Action options">
          {/* REJECT — destructive action. WCAG AA: dark red #9B1D1D on white. */}
          <TouchableOpacity
            style={[
              styles.ctaButton,
              styles.ctaReject,
              ctasDisabled && styles.ctaDisabled,
            ]}
            onPress={() => !ctasDisabled && onReject(item.insight_id)}
            disabled={ctasDisabled}
            accessibilityRole="button"
            accessibilityLabel={`Reject: dismiss this recommendation for ${item.recommendation.action.replace(/_/g, ' ')}`}
            accessibilityState={{ disabled: ctasDisabled }}
            accessibilityHint={
              isOffline
                ? 'Unavailable while offline. Reconnect to log your response.'
                : 'Logs your rejection in the Decision Log. This action has been recommended by Brain.'
            }
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 4 }}
          >
            <Text style={[styles.ctaText, ctasDisabled && styles.ctaTextDisabled]}>
              {getPreActionCta('REJECT')}
            </Text>
          </TouchableOpacity>

          {/* EDIT — mobile-7: disabled until edit UI (Phase 2) is built. */}
          <TouchableOpacity
            style={[
              styles.ctaButton,
              styles.ctaEdit,
              editDisabled && styles.ctaDisabled,
            ]}
            onPress={() => !editDisabled && onEdit(item.insight_id)}
            disabled={editDisabled}
            accessibilityRole="button"
            accessibilityLabel={`Edit: modify this recommendation for ${item.recommendation.action.replace(/_/g, ' ')}`}
            accessibilityState={{ disabled: editDisabled }}
            accessibilityHint={
              !EDIT_UI_READY
                ? 'Edit is not available in this version. Coming in a future update.'
                : isOffline
                  ? 'Unavailable while offline.'
                  : 'Suggest an edit to this recommendation. Logs in the Decision Log.'
            }
            hitSlop={{ top: 8, bottom: 8, left: 4, right: 4 }}
          >
            <Text style={[styles.ctaText, editDisabled && styles.ctaTextDisabled]}>
              {getPreActionCta('EDIT')}
            </Text>
          </TouchableOpacity>

          {/* APPROVE — primary action.
              CF-C6-MB-GRADUATED-LABEL-1: "Log Approval" NOT "Approve & Execute".
              Day-1: server returns LOGGED_AS_VOTE. NEVER imply auto-execute.
          */}
          <TouchableOpacity
            style={[
              styles.ctaButton,
              styles.ctaApprove,
              ctasDisabled && styles.ctaDisabled,
            ]}
            onPress={() => !ctasDisabled && onApprove(item.insight_id)}
            disabled={ctasDisabled}
            accessibilityRole="button"
            // CF-C6-MB-GRADUATED-LABEL-1: label is "Log Approval" — no "Execute".
            accessibilityLabel={`Log Approval: record your vote to approve ${item.recommendation.action.replace(/_/g, ' ')}. This logs a vote, not an automatic action.`}
            accessibilityState={{ disabled: ctasDisabled }}
            accessibilityHint={
              isOffline
                ? 'Unavailable while offline. Brief is shown from cache.'
                : 'Records your approval as a vote in the Brain Decision Log. No automatic action will be taken without further confirmation.'
            }
            hitSlop={{ top: 8, bottom: 8, left: 4, right: 8 }}
          >
            {/* CF-C6-MB-GRADUATED-LABEL-1: "Log Approval", never "Approve & Execute" */}
            <Text style={[styles.ctaTextPrimary, ctasDisabled && styles.ctaTextDisabled]}>
              {getPreActionCta('APPROVE')}
            </Text>
          </TouchableOpacity>
        </View>
      )}
    </View>
  );
}

// ---------------------------------------------------------------------------
// MorningBriefScreen — the PRIMARY product surface.
// ---------------------------------------------------------------------------

interface MorningBriefScreenProps {
  workspaceId: string;
  date?: string;  // ISO date, defaults to today
}

export function MorningBriefScreen({ workspaceId, date }: MorningBriefScreenProps) {
  const dispatch = useAppDispatch();
  const { brief, fetchedAt, isOffline, isFetching, fetchError, responses } = useAppSelector(
    (state) => state.morningBrief,
  );

  const renderStartRef = useRef<boolean>(false);

  const today = date ?? new Date().toISOString().split('T')[0] ?? '';

  // ---------------------------------------------------------------------------
  // Fetch the Morning Brief.
  // ---------------------------------------------------------------------------

  const fetchBrief = useCallback(async () => {
    dispatch(setFetching(true));
    markMorningBriefRenderStart();
    renderStartRef.current = true;

    try {
      const result = await trpcClient.morningBrief.get.query({
        date: today,
      });

      // THREE-SIGNAL RULE: ≤3 items. Server enforces; we assert as final defense.
      // mobile-5: data_epoch comes from the server as a Date (superjson round-trip),
      // but our local InsightItem type uses string to survive redux-persist's
      // JSON serialization faithfully. Convert at the API boundary here.
      const items: InsightItem[] = result.items.slice(0, 3).map((item) => ({
        ...item,
        data_epoch:
          item.data_epoch instanceof Date
            ? item.data_epoch.toISOString()
            : String(item.data_epoch),
      }));

      dispatch(
        setBrief({
          brief: {
            items,
            data_epoch:
              result.data_epoch instanceof Date
                ? result.data_epoch.toISOString()
                : String(result.data_epoch),
            freshness_label: result.freshness_label,
          },
          fetchedAt: new Date().toISOString(),
        }),
      );
      dispatch(setOnline());

      // Emit SLO metric on success.
      emitMorningBriefRenderSuccess(workspaceId, /* online */ true);
    } catch (err) {
      const errMsg =
        err instanceof Error
          ? `Fetch failed: ${err.message}`
          : 'Fetch failed. Please check your connection.';

      dispatch(setFetchError(errMsg));
      dispatch(setOffline());

      // Emit SLO metric even for stale-brief render (offline path).
      if (brief) {
        emitMorningBriefRenderSuccess(workspaceId, /* online */ false);
      }
    } finally {
      dispatch(setFetching(false));
    }
  }, [dispatch, today, workspaceId, brief]);

  useEffect(() => {
    void fetchBrief();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [today]);

  // ---------------------------------------------------------------------------
  // Handlers — approve / reject / edit
  // CF-C6-MB-IDEMPOTENCY-1: idempotency_key generated at initiation, not send.
  // ---------------------------------------------------------------------------

  const handleApprove = useCallback(
    async (insightId: string) => {
      // Generate key at action-initiation (or reuse unsettled).
      const action = clientIdempotencyStore.initiate(insightId, 'APPROVE');

      // Persist to Redux (for offline-replay).
      dispatch(
        initiateResponse({
          insight_id: insightId,
          idempotency_key: action.idempotency_key,
          response_kind: 'APPROVE',
        }),
      );

      await submitResponse(insightId, action.idempotency_key, 'APPROVE');
    },
    [dispatch],
  );

  const handleReject = useCallback(
    async (insightId: string) => {
      const action = clientIdempotencyStore.initiate(insightId, 'REJECT');
      dispatch(
        initiateResponse({
          insight_id: insightId,
          idempotency_key: action.idempotency_key,
          response_kind: 'REJECT',
        }),
      );
      await submitResponse(insightId, action.idempotency_key, 'REJECT');
    },
    [dispatch],
  );

  const handleEdit = useCallback(
    // mobile-7 fix: edit UI does not exist yet (future sprint).
    // Pressing Edit before the UI is built would log an EDIT action with an empty
    // payload — a meaningless Decision Log row. The button is disabled at the
    // render level (editUiReady=false) so this handler should never fire in practice,
    // but we guard here as a belt-and-suspenders defence.
    async (_insightId: string) => {
      // No-op until the edit UI (Phase 2) is implemented.
      // When ready: remove the guard, generate an idempotency key, and call submitResponse.
      return;
    },
    [],
  );

  const submitResponse = useCallback(
    async (
      insightId: string,
      idempotencyKey: string,
      kind: 'APPROVE' | 'REJECT' | 'EDIT',
      editPayload?: string,
    ) => {
      try {
        const result = await trpcClient.morningBrief.submitResponse.mutate({
          insight_id: insightId,
          response_kind: kind,
          edit_payload: editPayload,
          idempotency_key: idempotencyKey,
        });

        // Settle in Redux — status is server-provided.
        // CF-C6-MB-GRADUATED-LABEL-1: status from server, never inferred.
        dispatch(
          settleResponse({
            insight_id: insightId,
            status: result.status as GraduationStatus,
            decision_log_row_id: result.decision_log_row_id,
          }),
        );

        // Mark settled in the client idempotency store.
        clientIdempotencyStore.settle(insightId);

        // Accessibility announcement (CF-C6-MB-A11Y-ACTION-1).
        const labels = getGraduationLabels(result.status as GraduationStatus);
        AccessibilityInfo.announceForAccessibility(
          `${kind === 'APPROVE' ? 'Approval' : kind === 'REJECT' ? 'Rejection' : 'Edit'} logged. ${labels.statusDescription}`,
        );
      } catch (err) {
        // On error: do NOT settle (preserves the idempotency_key for retry).
        // CF-C6-MB-IDEMPOTENCY-1: unsettled key will be reused on retry.
        console.info(
          '[morning-brief] submitResponse error (idempotency key preserved for retry):',
          err instanceof Error ? err.message : 'unknown',
        );
      }
    },
    [dispatch],
  );

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  const showOfflineBanner = isOffline && brief !== null;
  const showEmptyState = !isFetching && !brief && !fetchError;
  const showErrorState = !isFetching && !brief && fetchError;

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      refreshControl={
        <RefreshControl
          refreshing={isFetching}
          onRefresh={() => void fetchBrief()}
          accessibilityLabel="Pull to refresh Morning Brief"
        />
      }
      // mobile-8: removed accessibilityRole="scrollbar" — "scrollbar" is not a valid
      // RN a11y role for a scroll container; it refers to the scroll indicator widget.
      // ScrollView is implicitly a scroll region to screen readers; no role needed.
    >
      {/* ---- Header ---- */}
      <View style={styles.headerRow} accessible={true} accessibilityRole="header">
        <Text style={styles.headerTitle} accessibilityRole="header">
          Morning Brief
        </Text>
        {fetchedAt && !isOffline && (
          <Text
            style={styles.asOfLabel}
            accessibilityRole="text"
            accessibilityLabel={`Data as of ${formatAsOf(fetchedAt)}`}
          >
            as of {formatAsOf(fetchedAt)}
          </Text>
        )}
      </View>

      {/* ---- Offline banner ----
          CF-C6-MB-OFFLINE-SLO-1: shows stale brief with freshness label.
          Never a blank screen in the 07:00-09:00 IST window.
          CTAs disabled with tooltip (see AccessibilityHint on buttons).
      */}
      {showOfflineBanner && (
        <View
          style={styles.offlineBanner}
          accessible={true}
          accessibilityRole="alert"
          accessibilityLabel={`Showing Brief from ${formatAsOf(fetchedAt)}. You may be offline. Approvals unavailable until reconnected.`}
        >
          <Text style={styles.offlineBannerTitle}>Offline</Text>
          <Text style={styles.offlineBannerText}>
            Showing Brief from {formatAsOf(fetchedAt)}. Reconnect to log approvals.
          </Text>
        </View>
      )}

      {/* ---- Loading ---- */}
      {isFetching && !brief && (
        <View
          style={styles.centerState}
          accessible={true}
          // mobile-8: removed accessibilityRole="progressbar" — RN's "progressbar"
          // role requires aria-valuenow/min/max props or it misleads screen readers.
          // The text label already announces the loading state; no extra role needed.
        >
          <Text style={styles.loadingText} accessibilityLabel="Loading Morning Brief">
            Loading Morning Brief...
          </Text>
        </View>
      )}

      {/* ---- Error (no cached brief) ---- */}
      {showErrorState && (
        <View style={styles.centerState} accessible={true} accessibilityRole="alert">
          <Text style={styles.errorText} accessibilityLabel={fetchError ?? 'Error loading brief'}>
            {fetchError}
          </Text>
          <TouchableOpacity
            style={styles.retryButton}
            onPress={() => void fetchBrief()}
            accessibilityRole="button"
            accessibilityLabel="Retry loading Morning Brief"
          >
            <Text style={styles.retryButtonText}>Retry</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* ---- Empty state ---- */}
      {showEmptyState && (
        <View style={styles.centerState} accessible={true} accessibilityRole="text">
          <Text style={styles.emptyText} accessibilityLabel="No Morning Brief available for today">
            No Morning Brief for today. Check back after 07:15 IST.
          </Text>
        </View>
      )}

      {/* ---- THREE SIGNAL CARDS ----
          CF-THREE-SIGNAL RULE: ≤3 cards. .slice(0, 3) as final defense.
          Cards appear in priority order (server-ranked).
      */}
      {brief &&
        brief.items.slice(0, 3).map((item, idx) => (
          <ActionCard
            key={item.insight_id}
            item={item}
            // mobile-6: cardIndex used for a11y position label "Action N of M"
            cardIndex={idx}
            totalCards={Math.min(brief.items.length, 3)}
            isOffline={isOffline}
            responseState={responses[item.insight_id] ?? null}
            onApprove={handleApprove}
            onReject={handleReject}
            onEdit={handleEdit}
          />
        ))}
    </ScrollView>
  );
}

// ---------------------------------------------------------------------------
// Styles
// CF-C6-MB-A11Y-ACTION-1: CTA_MIN_HEIGHT ≥48dp/44pt enforced.
// ---------------------------------------------------------------------------

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.background,
  },
  content: {
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 32,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    marginBottom: 16,
  },
  headerTitle: {
    fontSize: 24,
    fontWeight: '700',
    color: COLORS.textPrimary,
    letterSpacing: -0.5,
  },
  asOfLabel: {
    fontSize: 12,
    color: COLORS.textTertiary,
  },
  offlineBanner: {
    backgroundColor: COLORS.offlineBanner,
    borderColor: COLORS.offlineBannerBorder,
    borderWidth: 1,
    borderRadius: 8,
    padding: 12,
    marginBottom: 16,
  },
  offlineBannerTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: COLORS.offlineBannerText,
    marginBottom: 4,
  },
  offlineBannerText: {
    fontSize: 13,
    color: COLORS.offlineBannerText,
    lineHeight: 18,
  },
  card: {
    backgroundColor: COLORS.surface,
    borderColor: COLORS.surfaceBorder,
    borderWidth: 1,
    borderRadius: 12,
    padding: 16,
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginBottom: 12,
    gap: 8,
  },
  severityBadge: {
    borderWidth: 1.5,
    borderRadius: 4,
    paddingHorizontal: 6,
    paddingVertical: 2,
    flexShrink: 0,
  },
  severityText: {
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 0.5,
  },
  cardTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: COLORS.textPrimary,
    flex: 1,
    lineHeight: 22,
  },
  confidenceRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 14,
    gap: 8,
  },
  confidenceLabel: {
    fontSize: 11,
    color: COLORS.textTertiary,
    width: 72,
  },
  confidenceBarBg: {
    flex: 1,
    height: 6,
    backgroundColor: COLORS.confidenceBg,
    borderRadius: 3,
    overflow: 'hidden',
  },
  confidenceBarFill: {
    height: 6,
    backgroundColor: COLORS.confidenceBar,
    borderRadius: 3,
  },
  confidenceValue: {
    fontSize: 12,
    fontWeight: '600',
    color: COLORS.textSecondary,
    width: 34,
    textAlign: 'right',
  },
  sectionLabel: {
    fontSize: 10,
    fontWeight: '700',
    color: COLORS.textTertiary,
    letterSpacing: 0.8,
    marginBottom: 4,
    marginTop: 10,
  },
  summaryText: {
    fontSize: 14,
    color: COLORS.textPrimary,
    lineHeight: 20,
  },
  detailText: {
    fontSize: 13,
    color: COLORS.textSecondary,
    lineHeight: 19,
  },
  actionText: {
    fontSize: 14,
    fontWeight: '600',
    color: COLORS.textPrimary,
    lineHeight: 20,
  },
  impactLabel: {
    fontSize: 13,
    color: COLORS.textSecondary,
    lineHeight: 19,
    marginBottom: 8,
  },
  impactRow: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 4,
  },
  impactCell: {
    flex: 1,
    backgroundColor: COLORS.background,
    borderRadius: 8,
    padding: 8,
    alignItems: 'center',
  },
  impactMetricLabel: {
    fontSize: 10,
    fontWeight: '700',
    color: COLORS.textTertiary,
    letterSpacing: 0.5,
    marginBottom: 4,
  },
  impactMetricValue: {
    fontSize: 14,
    fontWeight: '700',
    color: COLORS.textPrimary,
  },
  rationaleText: {
    fontSize: 12,
    color: COLORS.textTertiary,
    lineHeight: 17,
    fontStyle: 'italic',
    marginBottom: 16,
  },
  settledBanner: {
    backgroundColor: COLORS.approveSurface,
    borderRadius: 8,
    padding: 10,
    marginBottom: 8,
  },
  settledBadge: {
    fontSize: 11,
    fontWeight: '700',
    color: COLORS.approvePrimary,
    letterSpacing: 0.5,
    marginBottom: 4,
  },
  settledDescription: {
    fontSize: 12,
    color: COLORS.textSecondary,
    lineHeight: 17,
  },
  ctaRow: {
    flexDirection: 'row',
    gap: CTA_SPACING,
    marginTop: 4,
  },
  ctaButton: {
    flex: 1,
    minHeight: CTA_MIN_HEIGHT,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 8,
  },
  ctaApprove: {
    backgroundColor: COLORS.approvePrimary,
    flex: 2,  // Wider primary action (thumb-first)
  },
  ctaReject: {
    backgroundColor: COLORS.rejectPrimary,
    flex: 1,
  },
  ctaEdit: {
    backgroundColor: COLORS.editPrimary,
    flex: 1,
  },
  ctaDisabled: {
    backgroundColor: COLORS.disabledBg,
  },
  ctaText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#FFFFFF',
    textAlign: 'center',
  },
  ctaTextPrimary: {
    fontSize: 14,
    fontWeight: '700',
    color: '#FFFFFF',
    textAlign: 'center',
  },
  ctaTextDisabled: {
    color: COLORS.disabledText,
  },
  centerState: {
    paddingVertical: 48,
    alignItems: 'center',
  },
  loadingText: {
    fontSize: 15,
    color: COLORS.textSecondary,
  },
  errorText: {
    fontSize: 14,
    color: COLORS.rejectPrimary,
    textAlign: 'center',
    marginBottom: 16,
    lineHeight: 20,
  },
  retryButton: {
    backgroundColor: COLORS.editPrimary,
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 8,
    minHeight: CTA_MIN_HEIGHT,
    alignItems: 'center',
    justifyContent: 'center',
  },
  retryButtonText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#FFFFFF',
  },
  emptyText: {
    fontSize: 14,
    color: COLORS.textTertiary,
    textAlign: 'center',
    lineHeight: 20,
  },
});
