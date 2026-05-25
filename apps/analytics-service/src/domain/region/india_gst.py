"""
india_gst.py — India GST 2.0 per-SKU line-tax extraction.

@paradigm: sql (pure integer arithmetic; zero float; zero LLM)
Justified: GST line tax is a deterministic integer-FLOOR formula per line item.
No inference path. Money in BIGINT minor units (paise).

WHY THIS EXISTS (the headline correctness constraint of slice 1):
  The legacy revenue path (analytics-sync.ts / compute-daily.ts) reads a Shopify
  DAY-LEVEL blended `taxes` aggregate. That is the anti-pattern this slice removes.
  Brain extracts GST PER LINE ITEM by the SKU's GST 2.0 slab and SUMs — never a
  blended day-level rate. A mixed-slab workspace (0% essentials + 18% apparel +
  40% luxury) has a day total that a single blended rate cannot reproduce.

GST 2.0 slabs (India, post-2025 reform): 0%, 5%, 18%, 40%.
Stored as integer basis points to stay float-free:
  0%  -> 0 bp
  5%  -> 500 bp
  18% -> 1800 bp
  40% -> 4000 bp

This is the India branch ONLY. UAE/GCC (5% VAT) is Phase 4 RegionAdapter — not here.
Single-Primitive Rule: ONE per-SKU line-tax function; no per-channel forks.
"""

from __future__ import annotations

# Canonical GST 2.0 slab set, in integer basis points (rate × 10000).
# A SKU's gst_slab_bp MUST be one of these — anything else is a data-quality bug.
GST_2_0_SLAB_BP: frozenset[int] = frozenset({0, 500, 1800, 4000})

# Human-readable slab labels for diagnostics (not used in arithmetic).
GST_2_0_SLAB_LABELS: dict[int, str] = {
    0: "0% (essentials)",
    500: "5%",
    1800: "18%",
    4000: "40% (luxury/sin)",
}


class InvalidGstSlabError(ValueError):
    """Raised when a SKU's gst_slab_bp is not a valid GST 2.0 slab.

    Fail-closed: an unrecognized slab is a data-quality bug, not a silent 0%.
    Silently treating an unknown slab as 0% would understate tax and overstate
    net-of-tax revenue — exactly the kind of quiet money corruption this slice
    exists to prevent.
    """


def gst_line_tax_mu(line_price_mu: int, gst_slab_bp: int) -> int:
    """Compute the GST tax (minor units) on ONE line item at its SKU's slab.

    @paradigm: sql — integer FLOOR. NEVER float.
    Formula: intDiv(line_price_mu * gst_slab_bp, 10000)
    (line_price_mu is the taxable line value in paise; gst_slab_bp is the slab in bp.)

    Args:
        line_price_mu: the taxable line value in minor units (paise). Must be >= 0.
        gst_slab_bp: the SKU's GST slab in basis points. Must be a GST_2_0_SLAB_BP.

    Returns:
        int: the GST tax on this line in minor units (paise), integer FLOOR.

    Raises:
        InvalidGstSlabError: if gst_slab_bp is not a recognized GST 2.0 slab.
        ValueError: if line_price_mu is negative.
    """
    if line_price_mu < 0:
        raise ValueError(
            f"gst_line_tax_mu: line_price_mu must be >= 0, got {line_price_mu}."
        )
    if gst_slab_bp not in GST_2_0_SLAB_BP:
        raise InvalidGstSlabError(
            f"gst_line_tax_mu: gst_slab_bp={gst_slab_bp} is not a valid GST 2.0 slab. "
            f"Valid slabs (bp): {sorted(GST_2_0_SLAB_BP)} "
            f"({', '.join(GST_2_0_SLAB_LABELS[b] for b in sorted(GST_2_0_SLAB_BP))}). "
            "An unknown slab is a data-quality bug — fail closed, never assume 0%."
        )
    # Integer FLOOR division (Python '//') — mirrors intDiv in ClickHouse.
    return (line_price_mu * gst_slab_bp) // 10_000


def total_tax_mu_per_sku(line_items: list[tuple[int, int]]) -> int:
    """SUM per-SKU GST line tax over a day's line items — NEVER a blended rate.

    @paradigm: sql — integer SUM of integer FLOORs. Zero float.

    This is the canonical Brain total_tax_mu: each line is taxed at ITS OWN SKU's
    GST slab, then summed. A single blended day-level rate cannot reproduce this on
    a mixed-slab workspace — that is precisely the legacy anti-pattern.

    Args:
        line_items: list of (line_price_mu, gst_slab_bp) tuples, one per line item.

    Returns:
        int: total GST tax for the day in minor units (paise).

    Raises:
        InvalidGstSlabError: if any line carries an invalid slab (fail-closed).
    """
    return sum(gst_line_tax_mu(price_mu, slab_bp) for price_mu, slab_bp in line_items)
