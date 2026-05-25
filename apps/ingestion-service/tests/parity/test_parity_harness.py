"""
LOCAL parity harness — count-based + field spot-check.

@paradigm: sql (CF-C3-PARITY-COUNT-1)

Per the architecture plan §10 + CF-C3-PARITY-COUNT-1:
  - COUNT parity: Brain ingested count == legacy fixture count ± 1 (clock skew)
  - Field spot-check: key fields on last-N rows match between legacy fixture
    and Brain normalized output
  - NO numeric shadow-compare (Child-0 carve-out lines 655-669)
  - NOT a live parity check — all data is LOCAL fixture

The M-A5-Q3 per-connector windows (from Child-0 architecture):
  Shopify / WooCommerce: 4h rollback window
  Meta / Google: 8h window (+ 48h attribution re-validation)
  Klaviyo / Unicommerce: 12h window
  Shiprocket: 72h window + ≥2-week pre-shadow

These are the LIVE parity windows at Stage-8 cutover. This harness uses
LOCAL fixtures to prove the count + spot-check logic is correct before cutover.

Tests:
  COUNT parity:
  - brain count == legacy count → PASS
  - brain count == legacy count + 1 (clock skew tolerance) → PASS
  - brain count == legacy count - 1 → PASS (within tolerance)
  - brain count > legacy + 1 → FAIL (unexpected divergence)
  - brain count < legacy - 1 → FAIL

  Field spot-check:
  - last-N rows: key fields match → PASS
  - last-N rows: key field mismatch → FAIL with field name + values
  - field not present in brain row → FAIL

  Parameterized by vendor:
  - Shopify: last 10 rows, check order_id + financial_status
  - Meta: last 5 rows, check date + campaign_id (no PII)
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

import pytest


# ---------------------------------------------------------------------------
# Parity check primitives (LOCAL harness — no live DB read)
# ---------------------------------------------------------------------------

_COUNT_TOLERANCE = 1  # allow ±1 for clock skew at cutover


@dataclass
class ParityResult:
    passed: bool
    vendor: str
    legacy_count: int
    brain_count: int
    count_delta: int
    field_mismatches: list[str]


def check_count_parity(
    vendor: str,
    legacy_count: int,
    brain_count: int,
    tolerance: int = _COUNT_TOLERANCE,
) -> ParityResult:
    """
    Assert that brain_count is within ±tolerance of legacy_count.

    CF-C3-PARITY-COUNT-1: count-based parity, NOT numeric shadow-compare.
    """
    delta = abs(brain_count - legacy_count)
    passed = delta <= tolerance
    return ParityResult(
        passed=passed,
        vendor=vendor,
        legacy_count=legacy_count,
        brain_count=brain_count,
        count_delta=delta,
        field_mismatches=[],
    )


def check_field_spot(
    vendor: str,
    last_n_legacy: list[dict[str, Any]],
    last_n_brain: list[dict[str, Any]],
    check_fields: list[str],
) -> ParityResult:
    """
    Spot-check key fields on last-N rows between legacy fixture and Brain output.

    CF-C3-PARITY-COUNT-1: field spot-check (NOT numeric shadow-compare of money).
    The check_fields list must NOT include money fields (per scope carve-out).
    """
    mismatches: list[str] = []
    for i, (leg, brain) in enumerate(zip(last_n_legacy, last_n_brain)):
        for field in check_fields:
            legacy_val = leg.get(field)
            brain_val = brain.get(field)
            if brain_val is None:
                mismatches.append(
                    f"row[{i}] field={field!r} missing in brain output"
                )
            elif legacy_val != brain_val:
                mismatches.append(
                    f"row[{i}] field={field!r} legacy={legacy_val!r} brain={brain_val!r}"
                )

    return ParityResult(
        passed=len(mismatches) == 0,
        vendor=vendor,
        legacy_count=len(last_n_legacy),
        brain_count=len(last_n_brain),
        count_delta=abs(len(last_n_legacy) - len(last_n_brain)),
        field_mismatches=mismatches,
    )


# ---------------------------------------------------------------------------
# Count parity tests
# ---------------------------------------------------------------------------


class TestCountParity:
    def test_exact_match_passes(self):
        result = check_count_parity("shopify", legacy_count=100, brain_count=100)
        assert result.passed is True
        assert result.count_delta == 0

    def test_clock_skew_plus1_passes(self):
        result = check_count_parity("shopify", legacy_count=100, brain_count=101)
        assert result.passed is True
        assert result.count_delta == 1

    def test_clock_skew_minus1_passes(self):
        result = check_count_parity("shopify", legacy_count=100, brain_count=99)
        assert result.passed is True
        assert result.count_delta == 1

    def test_delta_2_fails(self):
        result = check_count_parity("shopify", legacy_count=100, brain_count=102)
        assert result.passed is False
        assert result.count_delta == 2

    def test_delta_negative_2_fails(self):
        result = check_count_parity("shopify", legacy_count=100, brain_count=98)
        assert result.passed is False

    def test_zero_vs_zero_passes(self):
        result = check_count_parity("shiprocket", legacy_count=0, brain_count=0)
        assert result.passed is True

    def test_vendor_name_preserved(self):
        result = check_count_parity("meta", legacy_count=50, brain_count=50)
        assert result.vendor == "meta"


# ---------------------------------------------------------------------------
# Field spot-check tests (per M-A5-Q3 per-connector windows)
# ---------------------------------------------------------------------------


class TestFieldSpotCheck:
    """Spot-check last-N rows for key fields. No money fields per scope carve-out."""

    # Shopify fixtures (last 3 rows)
    _SHOPIFY_LEGACY = [
        {"shopify_order_id": "ord-001", "financial_status": "paid", "fulfillment_status": "fulfilled"},
        {"shopify_order_id": "ord-002", "financial_status": "pending", "fulfillment_status": None},
        {"shopify_order_id": "ord-003", "financial_status": "paid", "fulfillment_status": "partial"},
    ]
    _SHOPIFY_BRAIN = [
        {"shopify_order_id": "ord-001", "financial_status": "paid", "fulfillment_status": "fulfilled"},
        {"shopify_order_id": "ord-002", "financial_status": "pending", "fulfillment_status": None},
        {"shopify_order_id": "ord-003", "financial_status": "paid", "fulfillment_status": "partial"},
    ]

    def test_shopify_exact_match_passes(self):
        result = check_field_spot(
            "shopify",
            self._SHOPIFY_LEGACY,
            self._SHOPIFY_BRAIN,
            check_fields=["shopify_order_id", "financial_status"],
        )
        assert result.passed is True
        assert result.field_mismatches == []

    def test_shopify_mismatch_detected(self):
        brain_with_drift = [
            {"shopify_order_id": "ord-001", "financial_status": "refunded", "fulfillment_status": "fulfilled"},
            {"shopify_order_id": "ord-002", "financial_status": "pending", "fulfillment_status": None},
            {"shopify_order_id": "ord-003", "financial_status": "paid", "fulfillment_status": "partial"},
        ]
        result = check_field_spot(
            "shopify",
            self._SHOPIFY_LEGACY,
            brain_with_drift,
            check_fields=["financial_status"],
        )
        assert result.passed is False
        assert any("financial_status" in m for m in result.field_mismatches)

    def test_missing_brain_field_fails(self):
        brain_missing_field = [
            {"shopify_order_id": "ord-001"},  # missing financial_status
        ]
        legacy = [{"shopify_order_id": "ord-001", "financial_status": "paid"}]
        result = check_field_spot(
            "shopify", legacy, brain_missing_field,
            check_fields=["financial_status"],
        )
        assert result.passed is False
        assert any("missing" in m for m in result.field_mismatches)

    def test_meta_aggregates_no_pii_fields(self):
        """Meta/Google parity is aggregate-only (no individual PII per §5)."""
        legacy_meta = [
            {"date": "2024-03-01", "campaign_id": "c-123", "impressions": 10000},
            {"date": "2024-03-02", "campaign_id": "c-123", "impressions": 12000},
        ]
        brain_meta = [
            {"date": "2024-03-01", "campaign_id": "c-123", "impressions": 10000},
            {"date": "2024-03-02", "campaign_id": "c-123", "impressions": 12000},
        ]
        result = check_field_spot(
            "meta", legacy_meta, brain_meta,
            check_fields=["date", "campaign_id"],  # no PII, no money
        )
        assert result.passed is True

    def test_shiprocket_no_pii_fields_in_check(self):
        """Shiprocket: check shipment_id + status only (no delivery PII in spot-check)."""
        legacy = [{"shipment_id": "sh-1", "status": "delivered"}]
        brain = [{"shipment_id": "sh-1", "status": "delivered"}]
        result = check_field_spot(
            "shiprocket", legacy, brain,
            check_fields=["shipment_id", "status"],
        )
        assert result.passed is True


# ---------------------------------------------------------------------------
# Parameterized vendor window tests
# ---------------------------------------------------------------------------


_VENDOR_WINDOWS = [
    ("shopify", 4, 10),       # 4h window, check last 10 rows
    ("woocommerce", 4, 10),
    ("meta", 8, 5),
    ("google", 8, 5),
    ("klaviyo", 12, 5),
    ("unicommerce", 12, 5),
    ("shiprocket", 72, 10),   # 72h + ≥2-week pre-shadow
]


@pytest.mark.parametrize("vendor,window_hours,last_n", _VENDOR_WINDOWS)
def test_count_parity_exact_match_all_vendors(vendor, window_hours, last_n):
    """All vendors: exact count match passes. Window hours noted for Stage-8 reference."""
    result = check_count_parity(vendor, legacy_count=last_n, brain_count=last_n)
    assert result.passed is True, (
        f"Count parity failed for vendor={vendor} window={window_hours}h last_n={last_n}"
    )


@pytest.mark.parametrize("vendor,window_hours,last_n", _VENDOR_WINDOWS)
def test_count_parity_clock_skew_all_vendors(vendor, window_hours, last_n):
    """All vendors: ±1 clock skew is tolerated."""
    result = check_count_parity(vendor, legacy_count=last_n, brain_count=last_n + 1)
    assert result.passed is True
