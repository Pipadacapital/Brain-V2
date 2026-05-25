"""
test_memory_query.py — Brand Fingerprint pgvector query primitive tests.

CF-C5-MEMORY-1: Memory-Layer queries are READ-ONLY, workspace-scoped, k≥5.
C5-SEC-001: cross-brand queries return ANONYMOUS cohort aggregates (no workspace_id,
    no per-brand row) from ai.cross_brand_pattern — NOT from memory.brand_fingerprint.

Tests:
  POSITIVE: query_cross_brand_cohort with mock connection returns CrossBrandAggregate.
  POSITIVE: build_brand_fingerprint produces 16-dim vector.
  POSITIVE: falsy workspace_id → None (not an error, graceful degradation).
  POSITIVE: k < MIN_K_CROSS_BRAND in DB row → None returned (k-anonymity enforced).
  POSITIVE: no connection → None (graceful degradation).
  POSITIVE: cohort label not found → None.
  POSITIVE: DB error → None (graceful degradation).
  NEGATIVE: CrossBrandAggregate contains NO workspace_id field (anonymity contract).
"""

from __future__ import annotations

import sys
import os

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', '..'))
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', '..', '..', '..', 'pylibs', 'brain_cost_router'))

import pytest
from unittest.mock import MagicMock

from src.domain.memory.query import (
    MIN_K_CROSS_BRAND,
    CrossBrandAggregate,
    build_brand_fingerprint,
    query_cross_brand_cohort,
)


class TestQueryCrossBrandCohort:
    """query_cross_brand_cohort() tests — C5-SEC-001 anonymized-aggregate API."""

    def _make_conn(self, rows: list[dict]) -> MagicMock:
        conn = MagicMock()
        conn.fetch.return_value = rows
        return conn

    def _mock_row(self, brand_count: int = 7) -> dict:
        return {
            "brand_count": brand_count,
            "cohort_label": "fashion_india_mid",
            "cm2_pct_bp_p50": 2500,
            "cm3_pct_bp_p50": 1800,
            "rto_rate_bp_p50": 1200,
        }

    def test_k5_query_returns_cohort_aggregate(self) -> None:
        """Connection present + brand_count >= MIN_K → CrossBrandAggregate returned."""
        conn = self._make_conn([self._mock_row(brand_count=7)])
        result = query_cross_brand_cohort(
            workspace_id="ws_test",
            cohort_label="fashion_india_mid",
            _conn=conn,
        )
        assert result is not None
        assert isinstance(result, CrossBrandAggregate)
        assert result.brand_count == 7
        assert result.cohort_label == "fashion_india_mid"
        assert result.cm2_pct_bp_p50 == 2500

    def test_no_connection_returns_none(self) -> None:
        """No connection → None (graceful degradation; narration proceeds without context)."""
        result = query_cross_brand_cohort(
            workspace_id="ws_test",
            cohort_label="fashion_india_mid",
            _conn=None,
        )
        assert result is None

    def test_falsy_workspace_returns_none(self) -> None:
        """Falsy workspace_id → None (refuse, not crash)."""
        conn = self._make_conn([self._mock_row()])
        result = query_cross_brand_cohort(
            workspace_id="",
            cohort_label="fashion_india_mid",
            _conn=conn,
        )
        assert result is None

    def test_k_below_minimum_returns_none(self) -> None:
        """brand_count < MIN_K_CROSS_BRAND in DB row → None (k-anonymity not met).

        Even if the CHECK constraint on ai.cross_brand_pattern should prevent this,
        the Python layer double-enforces it (defense in depth, C5-SEC-001).
        """
        conn = self._make_conn([self._mock_row(brand_count=MIN_K_CROSS_BRAND - 1)])
        result = query_cross_brand_cohort(
            workspace_id="ws_test",
            cohort_label="fashion_india_mid",
            _conn=conn,
        )
        assert result is None

    def test_db_error_returns_none(self) -> None:
        """DB error → None (graceful degradation; logs warning)."""
        conn = MagicMock()
        conn.fetch.side_effect = RuntimeError("DB connection lost")
        result = query_cross_brand_cohort(
            workspace_id="ws_test",
            cohort_label="fashion_india_mid",
            _conn=conn,
        )
        assert result is None

    def test_cohort_not_found_returns_none(self) -> None:
        """No rows for the cohort label → None."""
        conn = self._make_conn([])  # empty result
        result = query_cross_brand_cohort(
            workspace_id="ws_test",
            cohort_label="nonexistent_cohort",
            _conn=conn,
        )
        assert result is None

    def test_result_has_no_workspace_id_field(self) -> None:
        """CrossBrandAggregate MUST NOT contain workspace_id (C5-SEC-001 anonymity).

        This test fails if workspace_id is ever added back to CrossBrandAggregate.
        That addition would be a C5-SEC-001 regression (cross-tenant identifiable
        disclosure) — this is the killed-mutant for C5-SEC-001.
        """
        conn = self._make_conn([self._mock_row(brand_count=10)])
        result = query_cross_brand_cohort(
            workspace_id="ws_test",
            cohort_label="fashion_india_mid",
            _conn=conn,
        )
        assert result is not None
        # The aggregate must NOT expose any workspace identity.
        assert not hasattr(result, "workspace_id"), (
            "C5-SEC-001 REGRESSION: CrossBrandAggregate must not contain workspace_id. "
            "Returning a workspace_id from a cross-brand query is a cross-tenant leak."
        )


class TestBuildBrandFingerprint:
    def test_produces_16_dim_vector(self) -> None:
        vec = build_brand_fingerprint(
            cm2_pct_bp=2000,
            cm3_pct_bp=1500,
            rto_rate_bp=1200,
            prepaid_rate_bp=6000,
            aov_mu=50_000_00,
            ad_spend_pct_bp=800,
            nc_pct_bp=4000,
            cogs_pct_bp=3500,
            total_orders=5000,
            net_sales_mu=100_000_00,
            cm1_pct_bp=2800,
            net_profit_pct_bp=800,
            mer_x100=350,
            refund_rate_bp=200,
            conversion_rate_bp=150,
            sku_count=80,
            workspace_id="ws_test",
        )
        assert len(vec) == 16

    def test_none_values_produce_zeros(self) -> None:
        """None optional fields fall back to 0.0 in the vector."""
        vec = build_brand_fingerprint(
            cm2_pct_bp=2000,
            cm3_pct_bp=1500,
            rto_rate_bp=None,
            prepaid_rate_bp=None,
            aov_mu=None,
            ad_spend_pct_bp=800,
            nc_pct_bp=None,
            cogs_pct_bp=3500,
            total_orders=5000,
            net_sales_mu=100_000_00,
            cm1_pct_bp=2800,
            net_profit_pct_bp=800,
            mer_x100=None,
            refund_rate_bp=None,
            conversion_rate_bp=None,
            sku_count=None,
            workspace_id="ws_test",
        )
        assert len(vec) == 16
        # rto_rate_bp (index 2) is None → 0.0
        assert vec[2] == 0.0
