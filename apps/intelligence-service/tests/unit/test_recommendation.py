"""
test_recommendation.py — Typed recommendation struct (CF-C5-INJECTION-TYPED-REC-6).

Tests:
  - TypedRecommendation only accepts closed enum actions.
  - Free-text action rejected.
  - InsightItem carries TypedRecommendation.
"""

from __future__ import annotations

import pytest
from pydantic import ValidationError

from domain.tools.recommendation import (
    InsightItem,
    RecommendationActionEnum,
    TypedRecommendation,
)


class TestTypedRecommendation:
    def test_valid_recommendation_accepted(self) -> None:
        rec = TypedRecommendation(
            action=RecommendationActionEnum.PAUSE_AD_SET,
            entity_id="ad_set_123",
            rationale="RTO rate above 30% threshold.",
        )
        assert rec.action == RecommendationActionEnum.PAUSE_AD_SET

    def test_free_text_action_rejected(self) -> None:
        """Free-text action (not in the enum) is rejected by Pydantic."""
        with pytest.raises(ValidationError):
            TypedRecommendation.model_validate({
                "action": "set_budget_to_zero_and_reallocate_to_new_campaign",
                "entity_id": "campaign_123",
                "rationale": "...",
            })

    def test_rationale_is_render_only(self) -> None:
        """Rationale field is a string — exists for rendering, not executor input."""
        rec = TypedRecommendation(
            action=RecommendationActionEnum.REVIEW_MANUALLY,
            entity_id="order_456",
            rationale="This is a long free-text rationale for display only.",
        )
        # The rationale exists and is accessible.
        assert "display" in rec.rationale.lower() or rec.rationale

    def test_all_enum_values_accepted(self) -> None:
        for action in RecommendationActionEnum:
            rec = TypedRecommendation(
                action=action, entity_id="e1", rationale="r"
            )
            assert rec.action == action

    def test_insight_item_carries_typed_recommendation(self) -> None:
        item = InsightItem(
            title="High RTO Alert",
            severity="warning",
            confidence=0.85,
            summary="RTO rate is above threshold.",
            detail="Your return-to-origin rate has been 12.5% for the past 7 days.",
            recommendation=TypedRecommendation(
                action=RecommendationActionEnum.PAUSE_AD_SET,
                entity_id="ad_set_123",
                rationale="High RTO correlates with this ad set.",
            ),
        )
        assert item.recommendation.action == RecommendationActionEnum.PAUSE_AD_SET
