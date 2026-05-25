"""
test_india_gst.py — India GST 2.0 per-SKU line-tax adapter.

@paradigm: sql
Covers BOTH positive and negative scenarios (code-clarity + coverage standard):
  POSITIVE — per-SKU tax at each slab; per-SKU SUM over a mixed-slab basket;
             integer FLOOR; the blended-rate anti-pattern divergence is provable.
  NEGATIVE — invalid slab fails closed (never silently 0%); negative price rejected.
"""

from __future__ import annotations

import pytest

from src.domain.region.india_gst import (
    GST_2_0_SLAB_BP,
    InvalidGstSlabError,
    gst_line_tax_mu,
    total_tax_mu_per_sku,
)


# ---------------------------------------------------------------------------
# POSITIVE: per-SKU line tax at each canonical GST 2.0 slab.
# ---------------------------------------------------------------------------

class TestPerSkuLineTax:
    def test_zero_slab_is_zero_tax(self) -> None:
        # essentials at 0% — ₹1,000 line, 0 tax
        assert gst_line_tax_mu(100_000, 0) == 0

    def test_five_percent_slab(self) -> None:
        # ₹1,000 line at 5% → ₹50 = 5000 paise
        assert gst_line_tax_mu(100_000, 500) == 5_000

    def test_eighteen_percent_slab(self) -> None:
        # ₹1,000 line at 18% → ₹180 = 18000 paise
        assert gst_line_tax_mu(100_000, 1800) == 18_000

    def test_forty_percent_slab(self) -> None:
        # ₹1,000 line at 40% (luxury) → ₹400 = 40000 paise
        assert gst_line_tax_mu(100_000, 4000) == 40_000

    def test_integer_floor_no_float(self) -> None:
        # 333 paise at 18% → intDiv(333*1800, 10000) = intDiv(599400, 10000) = 59 (FLOOR, not 59.94)
        assert gst_line_tax_mu(333, 1800) == 59

    def test_all_canonical_slabs_accepted(self) -> None:
        for slab in GST_2_0_SLAB_BP:
            # should not raise for any canonical slab
            assert gst_line_tax_mu(100_000, slab) >= 0


# ---------------------------------------------------------------------------
# POSITIVE: per-SKU SUM over a MIXED-slab basket — the honesty guarantee.
# ---------------------------------------------------------------------------

class TestMixedSlabSumIsNotBlended:
    def test_mixed_basket_sums_per_sku(self) -> None:
        # Basket: ₹1,000 essentials (0%) + ₹1,000 apparel (18%) + ₹1,000 luxury (40%)
        line_items = [
            (100_000, 0),     # 0 tax
            (100_000, 1800),  # 18000 paise
            (100_000, 4000),  # 40000 paise
        ]
        # per-SKU SUM = 0 + 18000 + 40000 = 58000 paise (₹580)
        assert total_tax_mu_per_sku(line_items) == 58_000

    def test_blended_rate_cannot_reproduce_per_sku(self) -> None:
        # The legacy anti-pattern: apply ONE blended rate to the basket total.
        # Basket total = ₹3,000 = 300000 paise. There is NO single slab that
        # reproduces the per-SKU total of 58000 paise:
        line_items = [(100_000, 0), (100_000, 1800), (100_000, 4000)]
        per_sku_total = total_tax_mu_per_sku(line_items)  # 58000
        basket_total_mu = sum(p for p, _ in line_items)   # 300000
        for slab in GST_2_0_SLAB_BP:
            blended = gst_line_tax_mu(basket_total_mu, slab)
            assert blended != per_sku_total, (
                f"blended slab {slab}bp produced {blended} == per-SKU {per_sku_total}; "
                "a blended rate must NOT be able to reproduce the per-SKU total."
            )

    def test_empty_basket_is_zero(self) -> None:
        assert total_tax_mu_per_sku([]) == 0


# ---------------------------------------------------------------------------
# NEGATIVE: fail-closed on bad data — never silently understate tax.
# ---------------------------------------------------------------------------

class TestFailClosed:
    def test_invalid_slab_raises(self) -> None:
        # 12% (1200 bp) was a GST 1.0 slab — removed in GST 2.0. Must fail closed.
        with pytest.raises(InvalidGstSlabError):
            gst_line_tax_mu(100_000, 1200)

    def test_arbitrary_slab_raises(self) -> None:
        with pytest.raises(InvalidGstSlabError):
            gst_line_tax_mu(100_000, 999)

    def test_invalid_slab_in_basket_raises(self) -> None:
        with pytest.raises(InvalidGstSlabError):
            total_tax_mu_per_sku([(100_000, 1800), (100_000, 1200)])

    def test_negative_price_raises(self) -> None:
        with pytest.raises(ValueError):
            gst_line_tax_mu(-1, 1800)
