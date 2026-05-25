"""
validator.py — Faithfulness validator (VETO Gate 2).

CF-C5-FAITHFULNESS-1 + CF-C5-FAITHFULNESS-COST-1:
  Placement (LOCKED): gateway-side post-generation middleware, AFTER the LLM
  returns and BEFORE the response reaches the agent or the Decision-Log writer.
  Placing it at the gateway (not the agent) means EVERY Tier-B call is
  validated regardless of which agent made it — a 5b agent cannot ship on an
  unvalidated path.

Signature (LOCKED from §A0.3):
    Signal.signal_id: str
    Signal.value_canonical: int   # paise / smallest unit / bp — NEVER float
    FaithfulnessResult.ok: bool
    FaithfulnessResult.offending_numbers: list[str]

Algorithm:
  1. Extract all numbers from `narration` via extraction.extract_numbers().
  2. Normalize each extracted number AND each signal value to the same canonical
     integer form (already done by extract_numbers + normalize_signal_value).
  3. Set-compare: every extracted number must appear in the signal value set.
     Any number in the narration NOT present in signals -> ok=False.
  4. The validator does NOT check the reverse (a signal value not narrated is
     fine — the LLM may choose to mention only a subset of signals).

False-reject prevention (CF-C5-FAITHFULNESS-COST-1):
  "₹1.2L" normalizes to 120_000 before comparison; if signal value_canonical
  is 120_000, this PASSES. See extraction.py for all normalization rules.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Sequence

from .extraction import extract_numbers, normalize_signal_value


@dataclass(frozen=True)
class Signal:
    """A deterministic Tier-A value the LLM narration may cite.

    value_canonical: ALWAYS an integer in the Brain minor-unit convention
    (paise for money, basis points for ratios, count for counts).
    NEVER a float. CF-C5-FAITHFULNESS-1.
    """

    signal_id: str
    value_canonical: int  # paise / bp / count — NEVER float


@dataclass(frozen=True)
class FaithfulnessResult:
    """Result of validate_faithfulness().

    ok: True if all narration numbers are present in the signal set.
        False if any narration number has no matching signal value.
    offending_numbers: human-readable list of numbers in the narration
        that did NOT match any signal value (empty when ok=True).
    """

    ok: bool
    offending_numbers: list[str] = field(default_factory=list)


def validate_faithfulness(
    narration: str,
    signals: Sequence[Signal],
) -> FaithfulnessResult:
    """Re-extract every number from `narration`, normalize BOTH the extracted
    number and each signal.value_canonical to the SAME canonical integer form
    (paise / bp / count — strip locale: '₹1.2L' -> 120000, '₹1,20,000' -> 120000,
    '12.5%' -> 1250 bp), then set-compare. Any output number with no matching
    signal value, OR any signal value contradicted, => ok=False.

    CF-C5-FAITHFULNESS-COST-1: normalization MUST occur before comparison
    so that locale/notation variants of the same value are not false-rejected.

    Args:
        narration: the LLM-generated text to validate.
        signals: the deterministic Tier-A signal values that were passed to the
            LLM as context. Only these values are considered "authoritative".

    Returns:
        FaithfulnessResult(ok=True, []) if all narration numbers are present
        in the signal set (or narration contains no numbers).
        FaithfulnessResult(ok=False, offending=[...]) otherwise.
    """
    if not narration.strip():
        # Empty narration is trivially faithful (no numbers to check).
        return FaithfulnessResult(ok=True, offending_numbers=[])

    # Build the canonical signal value set (right side of comparison).
    canonical_signal_values: frozenset[int] = frozenset(
        normalize_signal_value(sig.value_canonical) for sig in signals
    )

    # Extract canonical integers from the narration (left side).
    extracted: list[int] = extract_numbers(narration)

    if not extracted:
        # No numbers found in narration — trivially faithful.
        return FaithfulnessResult(ok=True, offending_numbers=[])

    offending: list[str] = []
    for num in extracted:
        if num not in canonical_signal_values:
            offending.append(str(num))

    return FaithfulnessResult(
        ok=len(offending) == 0,
        offending_numbers=offending,
    )
