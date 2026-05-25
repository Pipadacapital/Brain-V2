"""
recommendation.py — Typed recommendation struct (CF-C5-INJECTION-TYPED-REC-6).

The recommendation field that drives a graduation decision is a TYPED STRUCT
with a closed action enum. Free-text `rationale` is render-only and NEVER
passed back to the executor as instructions — closes injection persona CONCERN 5.

CF-C5-INJECTION-TYPED-REC-6: a recommendation carrying free-text `action`
or passing the `rationale` back into any prompt or executor is a Stage-6 BOUNCE.

CF-C6-MB-CONTRACT-COMPLETENESS-1 (Child 6 amendment — additive):
InsightItem gains expected_impact + risk + confidence_display_pct.
These are registry-DERIVED deterministic (Tier-A) fields — NOT LLM numbers.
expected_impact.revenue_mu / cm2_mu come from the Tier-A signal layer.
confidence_display_pct is pre-formatted int (CF-C6-NO-UI-FLOAT-1).
Maya consult confirmed: deterministic source = the same signal layer the
faithfulness validator already trusts (not the narration LLM).
"""

from __future__ import annotations

from enum import Enum
from typing import Literal, Optional

from pydantic import BaseModel, ConfigDict


class RecommendationActionEnum(str, Enum):
    """Closed action enum for AI recommendations.

    These are the only valid actions an AI agent may recommend.
    Adding a new action requires a plan amendment (Aryan) — not
    an in-agent string change.

    CF-C5-INJECTION-TYPED-REC-6: this enum is closed. Free-text action
    strings from the LLM are NOT accepted.
    """

    PAUSE_AD_SET = "pause_ad_set"
    INCREASE_BUDGET = "increase_budget"
    DECREASE_BUDGET = "decrease_budget"
    SEND_REFUND = "send_refund"
    REVIEW_MANUALLY = "review_manually"  # always-safe recommendation
    NO_ACTION = "no_action"


class TypedRecommendation(BaseModel):
    """The typed recommendation struct stored in ai.decision_log.

    action: closed enum (RecommendationActionEnum) — the AI's recommendation.
    entity_id: the entity to act on (ad set ID, order ID, etc.).
    rationale: free-text explanation — RENDER ONLY. MUST NOT be passed to
        any executor or fed back into any LLM prompt as instructions.
        CF-C5-INJECTION-TYPED-REC-6.
    """

    model_config = ConfigDict(frozen=True)

    action: RecommendationActionEnum
    entity_id: str
    rationale: str  # render-only; never executor input; never in system prompt


class RiskLevel(str, Enum):
    """Closed risk-level enum for AI insight items.

    CF-C6-MB-CONTRACT-COMPLETENESS-1: risk is a closed enum, not free-text.
    Adding a new level requires a plan amendment — not an in-agent string change.
    """

    LOW = "low"
    MEDIUM = "medium"
    HIGH = "high"
    CRITICAL = "critical"


class ExpectedImpact(BaseModel):
    """Registry-DERIVED deterministic impact estimate for an insight.

    CF-C6-MB-CONTRACT-COMPLETENESS-1: these are Tier-A signal-layer values,
    NOT numbers produced by the narration LLM. The faithfulness validator
    already trusts this same signal layer.

    revenue_mu: expected revenue impact in minor units (e.g. paise for INR).
    cm2_mu:     expected CM2 impact in minor units.
    currency_code: ISO 4217 code (e.g. "INR").
    impact_label: pre-formatted display string (e.g. "+₹1.2L CM2"). Render-only.
    """

    model_config = ConfigDict(frozen=True)

    revenue_mu: int  # BIGINT minor units — matches DB contract
    cm2_mu: int  # BIGINT minor units
    currency_code: str  # ISO 4217
    impact_label: str  # render-only; never executor input


class InsightItem(BaseModel):
    """A single AI-generated insight item (the 5a output type).

    CF-C5-INJECTION-TYPED-REC-6: recommendation is a TypedRecommendation,
    not a free-text string.

    CF-C6-MB-CONTRACT-COMPLETENESS-1 (Child 6 amendment — additive):
    confidence_display_pct: pre-formatted int percentage (e.g. 87 for 87%).
        CF-C6-NO-UI-FLOAT-1 — the UI layer MUST NOT do float-to-percent math.
        The legacy `confidence: float` field is DEPRECATED; kept for backward
        compat during migration but MUST NOT be read by new callers.
    expected_impact: registry-DERIVED Tier-A signal, not LLM output.
    risk: closed RiskLevel enum, not free-text.
    """

    model_config = ConfigDict(frozen=True)

    title: str
    severity: str  # "info" | "warning" | "critical"
    # DEPRECATED: use confidence_display_pct instead (CF-C6-NO-UI-FLOAT-1).
    # Kept for backward compat; will be removed post-migration.
    confidence: float  # 0.0-1.0; render-only; NOT used for routing
    summary: str
    detail: str
    recommendation: TypedRecommendation

    # --- CF-C6-MB-CONTRACT-COMPLETENESS-1 fields (additive, Child 6) ---
    # Pre-formatted integer percentage — UI renders directly, no float math.
    confidence_display_pct: int  # e.g. 87 for 87%; CF-C6-NO-UI-FLOAT-1
    # Registry-DERIVED Tier-A signal-layer values. NOT LLM numbers.
    expected_impact: ExpectedImpact  # CF-C6-MB-CONTRACT-COMPLETENESS-1
    # Closed risk-level classification.
    risk: RiskLevel  # CF-C6-MB-CONTRACT-COMPLETENESS-1
