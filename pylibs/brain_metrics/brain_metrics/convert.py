"""
convert.py — Exact decimal-string to minor-units conversion.

@paradigm: sql (exact-integer arithmetic, zero float, zero LLM)
Justified: money conversion is a pure deterministic function. The algorithm
uses decimal.Decimal(str) natively — this is exact rational arithmetic, no
IEEE-754 float anywhere in the conversion path. CF-C2-STRING-API-1 (CRITICAL).

CRITICAL RULES (binding, CF-C2-STRING-API-1):
  - `amount` MUST be a str. TypeError is raised on any non-str input.
  - NO float, NO Number(str)*100, NO 1e-10 epsilon.
  - Rounding mode is ROUND_HALF_EVEN (banker's rounding) at the subunit boundary.
  - `subunit_multiplier` is always passed by the caller (never hardcoded 100).

Byte-identity pair with packages/lib-metrics/src/convert.ts.
"""

from __future__ import annotations

from decimal import ROUND_HALF_EVEN, Decimal


def decimal_to_minor_units(amount: str, subunit_multiplier: int) -> int:
    """Convert a decimal string amount to integer minor units.

    Uses Python's native decimal.Decimal for exact rational arithmetic.
    ROUND_HALF_EVEN (banker's rounding) is applied at the subunit boundary.

    Args:
        amount: a decimal string, e.g. "1234.565" (as returned by Prisma /
            Postgres serialization of Decimal columns). MUST be a str.
        subunit_multiplier: e.g. 100 for INR/AED/SAR, 1000 for KWD/BHD,
            1 for JPY. Read from the Money object or currency lookup; never
            hardcode 100 at call sites. CF-C2-SUBUNIT-1.

    Returns:
        int: exact minor units, e.g. 123456 for "1234.56" × 100.

    Raises:
        TypeError: if `amount` is not a str (float, int, None, etc. are all
            rejected). This guard makes it physically impossible for a caller
            to pass a float through the boundary. CF-C2-STRING-API-1.
        ValueError: if `amount` is not a valid decimal string.

    Examples:
        >>> decimal_to_minor_units("1234.565", 100)
        123456           # ROUND_HALF_EVEN: 5 → nearest even = 6 (even)
        >>> decimal_to_minor_units("1234.575", 100)
        123458           # ROUND_HALF_EVEN: 5 → nearest even = 8 (even)
        >>> decimal_to_minor_units("0.005", 100)
        0                # ROUND_HALF_EVEN: 0.5 → nearest even = 0 (even)
        >>> decimal_to_minor_units("-1234.565", 100)
        -123456          # negative: ROUND_HALF_EVEN mirrors positive
        >>> decimal_to_minor_units("1.255", 1000)   # KWD
        1255             # exact: 1.255 × 1000 = 1255.000 — no rounding needed
    """
    # CF-C2-STRING-API-1: reject non-string at runtime (type-level enforcement
    # comes from the str annotation + mypy; this guard catches runtime
    # callers who pass float/int/None).
    if not isinstance(amount, str):
        raise TypeError(
            f"decimal_to_minor_units: `amount` must be a str, got {type(amount).__name__!r}. "
            "Do NOT call this function with a float or int — pass the Prisma/Postgres "
            "Decimal string directly. CF-C2-STRING-API-1."
        )

    # exact decimal arithmetic — Decimal(str) is the ONLY construction path
    # (no Decimal(float)). This is the Brain-native correction of the legacy
    # Number(decimalString)*100 float pattern.
    d = Decimal(amount)
    multiplier = Decimal(subunit_multiplier)

    # Scale to minor units. Because both `d` and `multiplier` are exact
    # Decimal values (no float taint), the product is exact.
    scaled = d * multiplier

    # Quantize to an integer using ROUND_HALF_EVEN (banker's rounding).
    # "1" is the quantum that forces an integer result.
    quantized = scaled.quantize(Decimal("1"), rounding=ROUND_HALF_EVEN)

    return int(quantized)
