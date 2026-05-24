"""
subunits.py — Subunit multiplier lookup (ISO 4217 exponent).

@paradigm: sql (pure lookup, deterministic, zero LLM)
Justified: this is a deterministic currency-exponent table. The rule is
encoded once here; every consumer (convert.py, harness comparator) reads
this function, never hardcodes 100. CF-C2-SUBUNIT-1.

Byte-identity pair with packages/lib-metrics/src/subunits.ts.
"""

from __future__ import annotations

# Registry of ISO 4217 currency codes to minor-unit multiplier.
# Default 100 covers the vast majority (INR, AED, SAR, USD, EUR, GBP, …).
# Exceptions enumerated explicitly so additions are visible in diff.
_SUBUNIT_OVERRIDE: dict[str, int] = {
    # 3-decimal-place currencies (×1000)
    "KWD": 1000,  # Kuwaiti Dinar
    "BHD": 1000,  # Bahraini Dinar
    "OMR": 1000,  # Omani Rial (also 3 dp; added for completeness)
    "TND": 1000,  # Tunisian Dinar
    # 0-decimal-place currencies (×1)
    "JPY": 1,   # Japanese Yen
    "KRW": 1,   # Korean Won
    "VND": 1,   # Vietnamese Dong
    "IDR": 1,   # Indonesian Rupiah (technically 0 minor units at practice)
    "HUF": 1,   # Hungarian Forint
    "ISK": 1,   # Icelandic Krona
    "TWD": 1,   # New Taiwan Dollar (practice: 0)
}

_DEFAULT_MULTIPLIER = 100


def subunit_multiplier(currency_code: str) -> int:
    """Return the subunit multiplier for a given ISO 4217 currency code.

    Default: 100 (covers INR, AED, SAR, USD, EUR, GBP, …).
    KWD / BHD / OMR / TND: 1000.
    JPY / KRW / VND / IDR / HUF / ISK / TWD: 1.

    Args:
        currency_code: ISO 4217 alpha-3 code (e.g. "INR", "KWD", "JPY").

    Returns:
        int: the minor-unit multiplier (positive integer).
    """
    return _SUBUNIT_OVERRIDE.get(currency_code.upper(), _DEFAULT_MULTIPLIER)
