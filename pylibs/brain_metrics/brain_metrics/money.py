"""
money.py — Canonical Money value object.

@paradigm: sql (deterministic value type, zero LLM)
Justified: Money is a pure immutable value object. minor_units is always an
integer (BIGINT/Int64); no float anywhere in this type. CF-C2-PRIMITIVE-1.

Byte-identity pair with packages/lib-metrics/src/money.ts.
"""

from __future__ import annotations

from dataclasses import dataclass

from brain_metrics.subunits import subunit_multiplier as _subunit_multiplier


@dataclass(frozen=True)
class Money:
    """Canonical Brain money representation.

    Fields:
        minor_units: integer minor units (paise for INR, fils for KWD, …).
            Always an int (BIGINT/Int64 semantics). Negative values are valid
            (refunds, credits). Never a float.
        currency_code: ISO 4217 alpha-3 code, e.g. "INR".
        subunit_multiplier: e.g. 100 for INR/AED/SAR, 1000 for KWD/BHD,
            1 for JPY. Stored on the object so consumers never hardcode 100.
            CF-C2-SUBUNIT-1.
    """

    minor_units: int
    currency_code: str
    subunit_multiplier: int


def make_money(minor_units: int, currency_code: str) -> Money:
    """Construct a Money value, resolving subunit_multiplier from currency_code.

    Args:
        minor_units: integer minor units (e.g. 123456 for ₹1234.56).
        currency_code: ISO 4217 alpha-3 (e.g. "INR").

    Returns:
        Money: frozen dataclass instance.
    """
    return Money(
        minor_units=int(minor_units),
        currency_code=currency_code.upper(),
        subunit_multiplier=_subunit_multiplier(currency_code),
    )
