"""
extraction.py — Number extraction + canonical-integer normalization rules.

CF-C5-FAITHFULNESS-1 + CF-C5-FAITHFULNESS-COST-1:
  Re-extract every number from an LLM narration and normalize BOTH the
  extracted number AND each signal.value_canonical to the SAME canonical
  integer form BEFORE comparison. This prevents false-reject (the C3 cost bug)
  where "₹1.2L" and 120000 represent the same value but a naive string
  comparison would call them different.

Normalization rules (LOCKED — co-designed at the Vikram↔Maya seam):
  - Indian Lakh notation: "₹1.2L" -> 120_000, "₹1.5L" -> 150_000
  - Indian Crore notation: "₹1.2Cr" -> 12_000_000
  - Indian grouping: "₹1,20,000" -> 120_000, "₹1,20,00,000" -> 12_000_000
  - Standard grouping: "₹1,20,000" -> 120_000 (same after strip commas)
  - Percentage to basis-points: "12.5%" -> 1250, "0.5%" -> 50
  - Plain integer with currency: "₹120000" -> 120_000
  - Plain integer without currency: "120000" -> 120_000
  - Negative values: "-₹1.2L" -> -120_000
  - "approximately" / "~" prefixes: stripped before normalization

All values returned as Python int (minor units or basis points — no float).
Ambiguous cases (no explicit unit) default to minor-units integer passthrough.

Maya owns these rules; Vikram's gateway validator imports from this module.
"""

from __future__ import annotations

import re
from typing import Sequence


# ---------------------------------------------------------------------------
# Regex patterns for number extraction from narration text.
# ---------------------------------------------------------------------------

# Matches optional sign + optional ₹ + optional ~ or "approx" prefix,
# then the numeric body in various Indian/standard formats.
_RE_INDIAN_LAKH = re.compile(
    r"[-−]?\s*(?:approximately\s+|approx\.?\s+|~\s*)?"
    r"(?:₹|Rs\.?|INR\s*)?"
    r"(\d+(?:\.\d+)?)\s*[Ll](?:akh)?s?",
    re.IGNORECASE,
)
_RE_INDIAN_CRORE = re.compile(
    r"[-−]?\s*(?:approximately\s+|approx\.?\s+|~\s*)?"
    r"(?:₹|Rs\.?|INR\s*)?"
    r"(\d+(?:\.\d+)?)\s*[Cc]r(?:ore)?s?",
    re.IGNORECASE,
)
_RE_PERCENTAGE = re.compile(
    r"[-−]?\s*(\d+(?:\.\d+)?)\s*%",
)
_RE_CURRENCY_NUMBER = re.compile(
    r"[-−]?\s*(?:₹|Rs\.?|INR\s*)(\d[\d,]*(?:\.\d+)?)",
    re.IGNORECASE,
)
_RE_PLAIN_NUMBER = re.compile(
    r"(?<![₹\w])[-−]?\d[\d,]*(?:\.\d+)?(?!\s*[%LlCc])",
)

_LAKH = 100_000
_CRORE = 10_000_000


def extract_numbers(text: str) -> list[int]:
    """Extract all numbers from `text` and return as canonical integers.

    Processes in order: Lakh, Crore, Percentage (-> bp), currency-prefixed
    integers, plain integers. Each number is normalized exactly once.

    Returns a de-duplicated list preserving order of first occurrence.
    The result can be empty if no numbers appear in `text`.

    CF-C5-FAITHFULNESS-COST-1: normalization happens BEFORE caller compares
    against signal values — no false-reject on locale/notation differences.
    """
    # Track character spans already consumed so we don't double-count.
    consumed_spans: list[tuple[int, int]] = []
    results: list[int] = []

    def _register(value: int, span: tuple[int, int]) -> None:
        for cs in consumed_spans:
            # Reject if this span overlaps a previously consumed one.
            if span[0] < cs[1] and span[1] > cs[0]:
                return
        consumed_spans.append(span)
        if value not in results:
            results.append(value)

    # 1. Lakh notation
    for m in _RE_INDIAN_LAKH.finditer(text):
        raw = m.group(0)
        negative = raw.lstrip().startswith(("-", "−"))
        num_str = m.group(1)
        val = round(float(num_str) * _LAKH)
        if negative:
            val = -val
        _register(val, m.span())

    # 2. Crore notation
    for m in _RE_INDIAN_CRORE.finditer(text):
        raw = m.group(0)
        negative = raw.lstrip().startswith(("-", "−"))
        num_str = m.group(1)
        val = round(float(num_str) * _CRORE)
        if negative:
            val = -val
        _register(val, m.span())

    # 3. Percentage -> basis points
    for m in _RE_PERCENTAGE.finditer(text):
        raw = m.group(0)
        negative = raw.lstrip().startswith(("-", "−"))
        num_str = m.group(1)
        val = round(float(num_str) * 100)  # % -> basis points
        if negative:
            val = -val
        _register(val, m.span())

    # 4. Currency-prefixed integers (₹1,20,000 etc.)
    for m in _RE_CURRENCY_NUMBER.finditer(text):
        raw_num = m.group(1).replace(",", "")
        full_raw = m.group(0)
        negative = full_raw.lstrip().startswith(("-", "−"))
        try:
            val = int(float(raw_num))
            if negative:
                val = -val
            _register(val, m.span())
        except ValueError:
            pass

    # 5. Plain numbers (after consuming locale-specific forms above)
    for m in _RE_PLAIN_NUMBER.finditer(text):
        raw_num = m.group(0).replace(",", "").replace("−", "-")
        try:
            val = int(float(raw_num))
            _register(val, m.span())
        except ValueError:
            pass

    return results


def normalize_signal_value(value: int) -> int:
    """Normalize a signal.value_canonical for comparison.

    Signal values are already in canonical minor-unit integer form
    (per the Brain money invariant — BIGINT, no float). This function
    is an identity for integers; it exists so the caller always goes
    through one normalization surface for both sides of the comparison.

    CF-C5-FAITHFULNESS-COST-1: both sides (extracted numbers + signal values)
    must pass through normalization BEFORE the set-compare.
    """
    return int(value)  # Already canonical; validate it is an int.


def numbers_from_narration_as_set(narration: str) -> frozenset[int]:
    """Return the set of canonical integers extracted from a narration."""
    return frozenset(extract_numbers(narration))


def signal_values_as_set(signal_values: Sequence[int]) -> frozenset[int]:
    """Return the set of normalized signal canonical values."""
    return frozenset(normalize_signal_value(v) for v in signal_values)
