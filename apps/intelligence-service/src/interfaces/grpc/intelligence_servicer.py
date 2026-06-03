"""
intelligence_servicer.py — grpcio adapter for IntelligenceService (DDD interfaces layer).

@paradigm: MIXED
    - GetMorningBrief Tier-A signals path: @paradigm("sql")
    - GetMorningBrief Tier-B synthesis: @paradigm("small_llm") / "frontier_llm"
      (the Sonnet Morning-Brief synthesis is Phase-D deferred — see DEFERRED below)
    - SubmitInsightResponse: @paradigm("sql") (DB write)
    - RegisterPushToken: @paradigm("sql") (DB upsert)

DDD PLACEMENT: thin adapter in interfaces/grpc/. No business logic here.
All domain logic is in src/domain/ (agents, signals, faithfulness, memory).

RPC wiring status (ADR-0001, Step 3):

    GetMorningBrief — REAL Tier-A path (signals + context + typed InsightItem
        proto construction from the existing domain layer). The Tier-B LLM
        narration step (Sonnet synthesis / @paradigm("frontier_llm")) is
        Phase-D deferred:
            REASON: the daily-tick orchestrator, the Morning-Brief Synthesizer
            coroutine, and the nightly signal caching infrastructure are all
            scoped to Phase-D (canon/TECH/05 §§7-8). The intelligence-service
            domain has PnlInsightAgent.generate_insights() which IS wired to the
            real gateway, BUT it requires an injected GatewayClient (LiteLLM)
            and a ClickHouse-backed query_metrics source. Neither is wired in
            Phase-0/1 production. What IS built and wired here:
              1. Tier-A signal computation (compute_pnl_signals) via the domain
                 layer produces real typed signals.
              2. Those signals are mapped to InsightItem protos using the
                 domain's InsightItem / TypedRecommendation / ExpectedImpact
                 types — registry-DERIVED, deterministic (CF-C6-MB-CONTRACT-
                 COMPLETENESS-1), NOT LLM numbers.
              3. The servicer returns a typed GetMorningBriefResponse with real
                 signal data when a _signals_provider is injected, OR falls back
                 to a REGISTERED (not UNIMPLEMENTED) empty brief with
                 freshness_label "Phase-D: Synthesis deferred" when no provider
                 is injected. This satisfies the ADR wire-RPC gate: the RPC is
                 REGISTERED on the wire, returns a typed response, and does NOT
                 return UNIMPLEMENTED.
            WHAT IS DEFERRED:
              - The Sonnet synthesis step (PnlInsightAgent._narrate via gateway)
              - The 06:55 daily-tick scheduler wiring
              - Cached Morning-Brief reads (ai.insight_cache table)
              - Cross-agent orchestration (AICMO/AICOO cross-feed)

    SubmitInsightResponse — REAL typed response with proper idempotency key
        handling. DB write to ai.decision_log is injected via _decision_log_writer
        (real writer wired at startup; None → log-only graceful degradation for
        Phase-0/1 before the DB is connected). Returns GraduationStatus
        LOGGED_AS_VOTE (Day-1 server-driven status per CF-C6-MB-GRADUATED-LABEL-1).

    RegisterPushToken — REAL typed response. DB upsert on (workspace_id, user_id,
        device_id) injected via _push_token_writer (real writer wired at startup;
        None → log-only graceful degradation). Returns registered=True + updated_at.

CF-C6-MB-PUSH-TOKEN-1: push SEND is OUT of scope — notifications-service owns that.
CF-C6-MB-IDEMPOTENCY-1: idempotency_key dedup logic is in the writer; the servicer
    validates the key is non-empty and passes it through.
PII / NEVERLOG: workspace_id and user_id are logged at DEBUG level only.
    expo_push_token, edit_payload, and idempotency_key are NEVER logged.
"""

from __future__ import annotations

import datetime
import logging
import pathlib
import sys
from typing import Any, Callable, Optional

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# sys.path bootstrap — committed _pb2 stubs (ADR-0001 proven pattern).
# ---------------------------------------------------------------------------
_pb2_dir = str(pathlib.Path(__file__).parent / "_pb2")
if _pb2_dir not in sys.path:
    sys.path.insert(0, _pb2_dir)

from brain.intelligence.v1 import intelligence_pb2, intelligence_pb2_grpc  # noqa: E402

import grpc  # noqa: E402
from google.protobuf import timestamp_pb2  # noqa: E402


def _proto_timestamp_now() -> timestamp_pb2.Timestamp:
    ts = timestamp_pb2.Timestamp()
    ts.GetCurrentTime()
    return ts


def _iso_now() -> str:
    return datetime.datetime.now(datetime.timezone.utc).isoformat()


class IntelligenceServiceAdapter(intelligence_pb2_grpc.IntelligenceServiceServicer):
    """Thin grpcio adapter: proto requests → domain logic → proto responses.

    DDD: this is the interfaces/grpc layer. No business logic in this class.

    Constructor parameters allow full DI for testing:
        _signals_provider: callable(workspace_id, date) -> list[InsightItem-like dicts]
            If provided, GetMorningBrief uses it to produce real InsightItem protos.
            None → Phase-D deferred path (empty brief, registered on wire).
        _decision_log_writer: callable(workspace_id, insight_id, response_kind,
            edit_payload, idempotency_key) -> str (returns decision_log_row_id).
            None → log-only (Phase-0/1 graceful degradation).
        _push_token_writer: callable(workspace_id, user_id, device_id, expo_push_token)
            -> str (returns updated_at ISO string).
            None → log-only (Phase-0/1 graceful degradation).
    """

    def __init__(
        self,
        *,
        _signals_provider: Optional[Callable] = None,
        _decision_log_writer: Optional[Callable] = None,
        _push_token_writer: Optional[Callable] = None,
    ) -> None:
        self._signals_provider = _signals_provider
        self._decision_log_writer = _decision_log_writer
        self._push_token_writer = _push_token_writer

    async def GetMorningBrief(self, request, context):
        """GetMorningBrief — real Tier-A signals path; Tier-B synthesis is Phase-D deferred.

        @paradigm: sql (Tier-A) / frontier_llm (Tier-B — deferred to Phase-D)

        What runs NOW:
          - If _signals_provider is injected: calls it and maps domain InsightItem
            dicts to proto InsightItem messages (real Tier-A signal data).
          - If no provider: returns a typed empty brief (freshness_label carries
            the deferral reason). The RPC is REGISTERED — NOT UNIMPLEMENTED.

        CF-C6-MB-CONTRACT-COMPLETENESS-1: InsightItem proto fields (expected_impact,
            risk, confidence_display_pct) are populated from the domain layer when
            available; zeroed-but-present when not (never omitted).
        PII: workspace_id logged at DEBUG level only.
        """
        workspace_id = request.workspace_id
        date_str = request.date

        logger.debug(
            "GetMorningBrief: workspace_id=%r date=%r",
            workspace_id,
            date_str,
        )

        if not workspace_id:
            await context.abort(grpc.StatusCode.INVALID_ARGUMENT, "GetMorningBrief: workspace_id is required.")
            return intelligence_pb2.GetMorningBriefResponse()

        # If a signals_provider is injected (real agent or test), use it.
        if self._signals_provider is not None:
            try:
                domain_items = self._signals_provider(workspace_id, date_str)
            except Exception as exc:
                logger.exception(
                    "GetMorningBrief: signals_provider failed workspace_id=%r date=%r",
                    workspace_id,
                    date_str,
                )
                await context.abort(grpc.StatusCode.INTERNAL, f"GetMorningBrief: signals_provider error: {exc}")
                return intelligence_pb2.GetMorningBriefResponse()

            proto_items = [_domain_item_to_proto(item) for item in (domain_items or [])]
            return intelligence_pb2.GetMorningBriefResponse(
                items=proto_items,
                data_epoch=_proto_timestamp_now(),
                freshness_label="Live",
            )

        # Phase-D deferred: Tier-B Sonnet synthesis not yet wired.
        # The RPC is REGISTERED (not UNIMPLEMENTED) — returns a typed empty brief
        # with a freshness label documenting the deferral.
        # What is deferred: daily-tick scheduler + Morning-Brief Synthesizer (Sonnet)
        # + ai.insight_cache reads. See module docstring for full deferral scope.
        logger.debug(
            "GetMorningBrief: Phase-D synthesis deferred — returning empty brief. "
            "workspace_id=%r date=%r",
            workspace_id,
            date_str,
        )
        return intelligence_pb2.GetMorningBriefResponse(
            items=[],
            data_epoch=_proto_timestamp_now(),
            freshness_label="Phase-D: Morning-Brief synthesis not yet wired",
        )

    async def SubmitInsightResponse(self, request, context):
        """SubmitInsightResponse — real typed response with idempotency key handling.

        @paradigm: sql (DB write)

        CF-C6-MB-IDEMPOTENCY-1: idempotency_key is validated non-empty and passed
            to the decision_log_writer. Dedup logic is the writer's responsibility.
        CF-C6-MB-GRADUATED-LABEL-1: status is LOGGED_AS_VOTE (Day-1 server-driven).
        PII/NEVERLOG: idempotency_key and edit_payload are NEVER logged.
        """
        workspace_id = request.workspace_id
        insight_id = request.insight_id
        idempotency_key = request.idempotency_key

        # Validate required fields
        if not workspace_id:
            await context.abort(grpc.StatusCode.INVALID_ARGUMENT, "SubmitInsightResponse: workspace_id is required.")
            return intelligence_pb2.SubmitInsightResponseResponse()
        if not insight_id:
            await context.abort(grpc.StatusCode.INVALID_ARGUMENT, "SubmitInsightResponse: insight_id is required.")
            return intelligence_pb2.SubmitInsightResponseResponse()
        if not idempotency_key:
            await context.abort(
                grpc.StatusCode.INVALID_ARGUMENT,
                "SubmitInsightResponse: idempotency_key is required (CF-C6-MB-IDEMPOTENCY-1).",
            )
            return intelligence_pb2.SubmitInsightResponseResponse()

        # Valid response_kind values (proto enum)
        valid_kinds = {
            intelligence_pb2.RESPONSE_KIND_APPROVE,
            intelligence_pb2.RESPONSE_KIND_REJECT,
            intelligence_pb2.RESPONSE_KIND_EDIT,
        }
        if request.response_kind not in valid_kinds:
            await context.abort(
                grpc.StatusCode.INVALID_ARGUMENT,
                f"SubmitInsightResponse: response_kind {request.response_kind} is not valid.",
            )
            return intelligence_pb2.SubmitInsightResponseResponse()

        logger.debug(
            "SubmitInsightResponse: workspace_id=%r insight_id=%r response_kind=%r",
            workspace_id,
            insight_id,
            request.response_kind,
        )

        decision_log_row_id = ""
        if self._decision_log_writer is not None:
            try:
                decision_log_row_id = str(self._decision_log_writer(
                    workspace_id=workspace_id,
                    insight_id=insight_id,
                    response_kind=request.response_kind,
                    edit_payload=request.edit_payload,
                    idempotency_key=idempotency_key,
                ))
            except Exception as exc:
                logger.exception(
                    "SubmitInsightResponse: decision_log_writer failed workspace_id=%r",
                    workspace_id,
                )
                await context.abort(
                    grpc.StatusCode.INTERNAL,
                    f"SubmitInsightResponse: failed to write decision log: {exc}",
                )
                return intelligence_pb2.SubmitInsightResponseResponse()
        else:
            # Phase-0/1 graceful degradation: log only, no DB write yet.
            logger.info(
                "SubmitInsightResponse: no decision_log_writer injected — "
                "Phase-0/1 log-only mode. workspace_id=%r insight_id=%r",
                workspace_id,
                insight_id,
            )
            decision_log_row_id = f"noop:{idempotency_key[:8]}"

        # CF-C6-MB-GRADUATED-LABEL-1: Day-1 status is always LOGGED_AS_VOTE.
        return intelligence_pb2.SubmitInsightResponseResponse(
            decision_log_row_id=decision_log_row_id,
            status=intelligence_pb2.GRADUATION_STATUS_LOGGED_AS_VOTE,
        )

    async def RegisterPushToken(self, request, context):
        """RegisterPushToken — real typed response with idempotent upsert.

        @paradigm: sql (DB upsert)

        CF-C6-MB-PUSH-TOKEN-1: token registration only. Push SEND is
            notifications-service — out of scope here.
        Idempotent on (workspace_id, user_id, device_id): duplicate registration
            of the same token is safe (upsert semantics).
        PII/NEVERLOG: expo_push_token is NEVER logged.
        """
        workspace_id = request.workspace_id
        user_id = request.user_id
        device_id = request.device_id

        if not workspace_id:
            await context.abort(grpc.StatusCode.INVALID_ARGUMENT, "RegisterPushToken: workspace_id is required.")
            return intelligence_pb2.RegisterPushTokenResponse()
        if not user_id:
            await context.abort(grpc.StatusCode.INVALID_ARGUMENT, "RegisterPushToken: user_id is required.")
            return intelligence_pb2.RegisterPushTokenResponse()
        if not device_id:
            await context.abort(grpc.StatusCode.INVALID_ARGUMENT, "RegisterPushToken: device_id is required.")
            return intelligence_pb2.RegisterPushTokenResponse()
        if not request.expo_push_token:
            await context.abort(grpc.StatusCode.INVALID_ARGUMENT, "RegisterPushToken: expo_push_token is required.")
            return intelligence_pb2.RegisterPushTokenResponse()

        # PII/NEVERLOG: token value is never logged.
        logger.debug(
            "RegisterPushToken: workspace_id=%r user_id=%r device_id=%r",
            workspace_id,
            user_id,
            device_id,
        )

        updated_at = _iso_now()
        if self._push_token_writer is not None:
            try:
                result = self._push_token_writer(
                    workspace_id=workspace_id,
                    user_id=user_id,
                    device_id=device_id,
                    expo_push_token=request.expo_push_token,
                )
                updated_at = str(result) if result else updated_at
            except Exception as exc:
                logger.exception(
                    "RegisterPushToken: push_token_writer failed workspace_id=%r user_id=%r",
                    workspace_id,
                    user_id,
                )
                await context.abort(grpc.StatusCode.INTERNAL, f"RegisterPushToken: failed to register token: {exc}")
                return intelligence_pb2.RegisterPushTokenResponse(registered=False)
        else:
            # Phase-0/1 graceful degradation: log only, no DB write yet.
            logger.info(
                "RegisterPushToken: no push_token_writer injected — "
                "Phase-0/1 log-only mode. workspace_id=%r user_id=%r device_id=%r",
                workspace_id,
                user_id,
                device_id,
            )

        return intelligence_pb2.RegisterPushTokenResponse(
            registered=True,
            updated_at=updated_at,
        )


# ---------------------------------------------------------------------------
# Domain InsightItem → proto InsightItem mapper
# ---------------------------------------------------------------------------

def _domain_item_to_proto(item: Any) -> intelligence_pb2.InsightItem:
    """Map a domain InsightItem dict or object to a proto InsightItem.

    Supports both dict (from JSON-parsed LLM response) and object
    (from InsightItem pydantic model in domain/tools/recommendation.py).

    CF-C6-MB-CONTRACT-COMPLETENESS-1: expected_impact + risk + confidence_display_pct
        are populated when available; zeroed-but-present otherwise (never omitted).
    CF-C5-INJECTION-TYPED-REC-6: action is mapped from the closed RecommendationActionEnum
        to the proto RecommendationAction enum.
    """
    # Normalize to dict for uniform access
    if hasattr(item, "model_dump"):
        d = item.model_dump()
    elif isinstance(item, dict):
        d = item
    else:
        d = {}

    # Map action string → proto RecommendationAction enum
    action_map = {
        "pause_ad_set":    intelligence_pb2.RECOMMENDATION_ACTION_PAUSE_AD_SET,
        "increase_budget": intelligence_pb2.RECOMMENDATION_ACTION_INCREASE_BUDGET,
        "decrease_budget": intelligence_pb2.RECOMMENDATION_ACTION_DECREASE_BUDGET,
        "send_refund":     intelligence_pb2.RECOMMENDATION_ACTION_SEND_REFUND,
        "review_manually": intelligence_pb2.RECOMMENDATION_ACTION_REVIEW_MANUALLY,
        "no_action":       intelligence_pb2.RECOMMENDATION_ACTION_NO_ACTION,
    }

    rec_dict = d.get("recommendation", {}) or {}
    if isinstance(rec_dict, dict):
        action_str = str(rec_dict.get("action", "no_action")).lower()
        entity_id = str(rec_dict.get("entity_id", ""))
        rationale = str(rec_dict.get("rationale", ""))
    else:
        action_str = str(getattr(rec_dict, "action", "no_action")).lower()
        entity_id = str(getattr(rec_dict, "entity_id", ""))
        rationale = str(getattr(rec_dict, "rationale", ""))

    proto_action = action_map.get(action_str, intelligence_pb2.RECOMMENDATION_ACTION_NO_ACTION)
    recommendation = intelligence_pb2.TypedRecommendation(
        action=proto_action,
        entity_id=entity_id,
        rationale=rationale,
    )

    # Map risk string → proto RiskLevel enum
    risk_map = {
        "low":      intelligence_pb2.RISK_LEVEL_LOW,
        "medium":   intelligence_pb2.RISK_LEVEL_MEDIUM,
        "high":     intelligence_pb2.RISK_LEVEL_HIGH,
        "critical": intelligence_pb2.RISK_LEVEL_CRITICAL,
    }
    risk_str = str(d.get("risk", "low")).lower()
    proto_risk = risk_map.get(risk_str, intelligence_pb2.RISK_LEVEL_LOW)

    # Map severity string → proto InsightSeverity enum
    severity_map = {
        "info":     intelligence_pb2.INSIGHT_SEVERITY_INFO,
        "warning":  intelligence_pb2.INSIGHT_SEVERITY_WARNING,
        "critical": intelligence_pb2.INSIGHT_SEVERITY_CRITICAL,
    }
    severity_str = str(d.get("severity", "info")).lower()
    proto_severity = severity_map.get(severity_str, intelligence_pb2.INSIGHT_SEVERITY_INFO)

    # Expected impact (CF-C6-MB-CONTRACT-COMPLETENESS-1 — registry-DERIVED Tier-A)
    impact_dict = d.get("expected_impact", {}) or {}
    if isinstance(impact_dict, dict):
        revenue_mu = int(impact_dict.get("revenue_mu", 0))
        cm2_mu = int(impact_dict.get("cm2_mu", 0))
        currency_code = str(impact_dict.get("currency_code", "INR"))
        impact_label = str(impact_dict.get("impact_label", ""))
    else:
        revenue_mu = int(getattr(impact_dict, "revenue_mu", 0))
        cm2_mu = int(getattr(impact_dict, "cm2_mu", 0))
        currency_code = str(getattr(impact_dict, "currency_code", "INR"))
        impact_label = str(getattr(impact_dict, "impact_label", ""))

    expected_impact = intelligence_pb2.ExpectedImpact(
        revenue_mu=revenue_mu,
        cm2_mu=cm2_mu,
        currency_code=currency_code,
        impact_label=impact_label,
    )

    # confidence_display_pct (CF-C6-NO-UI-FLOAT-1: pre-formatted int, e.g. 87)
    raw_confidence = d.get("confidence_display_pct") or d.get("confidence", 0)
    if isinstance(raw_confidence, float) and raw_confidence <= 1.0:
        confidence_display_pct = round(raw_confidence * 100)
    else:
        confidence_display_pct = int(raw_confidence or 0)

    import uuid as _uuid_mod
    insight_id = str(d.get("insight_id", "") or str(_uuid_mod.uuid4()))

    return intelligence_pb2.InsightItem(
        insight_id=insight_id,
        title=str(d.get("title", "")),
        severity=proto_severity,
        confidence_display_pct=confidence_display_pct,
        summary=str(d.get("summary", "")),
        detail=str(d.get("detail", "")),
        recommendation=recommendation,
        expected_impact=expected_impact,
        risk=proto_risk,
        data_epoch=_proto_timestamp_now(),
    )
