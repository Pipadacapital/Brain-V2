"""
ratio.py — Ratio to basis-points conversion.

@paradigm: sql (integer FLOOR arithmetic, deterministic, zero LLM)
Justified: ratio→basis-points is pure integer arithmetic. FLOOR (not
ROUND_HALF_EVEN) is the binding rule for ratio fields per M-A5-Q1 —
"ratio → INT32 FLOOR(ratio × 10,000) _bp". This is intentionally NOT
banker's rounding; ratios are derived from integer counts and the FLOOR
is the correct rounding direction for percentage representations.

Byte-identity pair with packages/lib-metrics/src/ratio.ts.
"""

from __future__ import annotations


# INT32 range for basis-points fields
_INT32_MAX = 2_147_483_647
_INT32_MIN = -2_147_483_648

# Basis-points scale factor (×10,000)
_BP_SCALE = 10_000


def ratio_to_basis_points(numerator: int, denominator: int) -> int:
    """Convert a ratio (numerator/denominator) to INT32 basis points.

    Rule: FLOOR(numerator × 10,000 / denominator)
    NOT ROUND_HALF_EVEN — ratio fields use FLOOR per M-A5-Q1.

    Args:
        numerator: integer numerator (e.g. count of orders).
        denominator: integer denominator. MUST be non-zero; throws if 0.

    Returns:
        int: basis points, e.g. 2333 for 23.33%, 3333 for 1/3.
            Clamped to INT32 range [-2147483648, 2147483647].

    Raises:
        ZeroDivisionError: if denominator is 0. Callers MUST guard.

    Examples:
        >>> ratio_to_basis_points(2333, 10000)
        2333
        >>> ratio_to_basis_points(1, 3)
        3333    # FLOOR(1 * 10000 / 3) = FLOOR(3333.33...) = 3333
        >>> ratio_to_basis_points(1, 4)
        2500    # exact: 1 * 10000 / 4 = 2500
    """
    if denominator == 0:
        raise ZeroDivisionError(
            "ratio_to_basis_points: denominator must be non-zero. "
            "Caller must guard against zero denominator before calling. "
            "M-A5-Q1."
        )

    # Integer FLOOR division: Python's // operator performs floor division for
    # both positive and negative operands, matching the binding rule.
    # We multiply first to preserve precision (integer arithmetic throughout).
    result = (numerator * _BP_SCALE) // denominator

    # Assert INT32 range — throw on overflow, matching TS ratioToBasisPoints RangeError behavior.
    # Parity: both TS and Python throw on overflow (fail-loud, no silent clamp).
    # Cross-language overflow behavior reconciled at Child 4 (this child). CF-C2-RECON-TAXONOMY-1.
    # M-A5-Q1: INT32 overflow → OverflowError in Python; RangeError in TS. Both fail-loud.
    if result > _INT32_MAX or result < _INT32_MIN:
        raise OverflowError(
            f"ratio_to_basis_points: result {result} overflows INT32 range "
            f"[{_INT32_MIN}, {_INT32_MAX}]. This is a metric-integrity error. "
            "F4 parity fix: both TS and Python throw on INT32 overflow. M-A5-Q1."
        )

    return result
