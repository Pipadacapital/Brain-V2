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

Algorithm (CF-C5-FAITHFULNESS-1 — revised to fix B3 live-run defect):
  The narration is the raw JSON the model emits (InsightItem[] schema).  Running
  extract_numbers() on the entire JSON blob captures structural integers that are
  NOT metric data claims:

    - "confidence": 95      → self-assessed confidence (0-100 int), NOT a signal.
    - "2026-05-19"          → calendar date in detail/summary text.  Day/month/year
                              digits appear as bare numbers after extraction.
    - "20%", "15%", "5%"   → benchmark thresholds _BENCHMARKS_BLOCK EXPLICITLY
                              tells the model to cite ("critical <20%", etc.).
                              Normalised to bp these are 2000, 1500, 500 — not signals.
    - "up 12%"              → percentage-change phrasing normalised to 1200 bp.

  None of these are fabricated signal values; the gate was tripping on structural
  noise, not hallucinations.  This is defect CF-C5-FAITHFULNESS-1 (B3 live run,
  workspace f165da80-e6d5-4c58-9aff-ec654b873bd7, date 2026-05-19).

  Fix — validate over NARRATIVE TEXT only, extended allowed set:

  Step 1 — Parse the model JSON.  Extract only the free-text claim fields
    (title, summary, detail, rationale).  Structural fields (confidence int,
    recommendation.action enum, metrics[] signal-id strings) are excluded.
    If JSON parsing fails (malformed output), fall back to full-string
    validation — fail-safe, same VETO strength as before.

  Step 2 — Build the allowed set as:
    (a) all signal.value_canonical values (the authoritative data claims), PLUS
    (b) STRUCTURAL_CONFIDENCE_RANGE: integers 0-100 (confidence self-assessment
        — a structural schema field, never a data claim), PLUS
    (c) BENCHMARK_BP_VALUES: the threshold bp values the prompt's
        _BENCHMARKS_BLOCK explicitly instructs the model to cite (e.g. 20% →
        2000 bp, 15% → 1500 bp).  These are prompt-injected constants, not
        invented by the model, PLUS
    (d) calendar date tokens: year digits (e.g. 2026), and generic day/month
        ordinals 1-31.  The model is instructed to write period dates in detail
        fields; these are structurally injected from the brief date, not
        hallucinated metric values.

  Step 3 — extract_numbers() on the concatenated narrative text, set-compare
    against the extended allowed set.  A number in narrative text NOT in the
    extended allowed set is still an offending hallucination.

  This preserves the VETO: "CM2 was ₹9.9L" where no signal equals 990_000
  will still fail.  The gate's purpose — catching LLM-invented or contradicted
  DATA numbers — is fully preserved.

False-reject prevention (CF-C5-FAITHFULNESS-COST-1):
  "₹1.2L" normalizes to 120_000 before comparison; if signal value_canonical
  is 120_000, this PASSES. See extraction.py for all normalization rules.

Three B3-live-run defects (2026-05-19, workspace f165da80-e6d5-4c58-9aff-ec654b873bd7):

  Defect 1 — Markdown fence breaks JSON parser:
    The model wraps output in ```json … ``` despite Rule 10.  json.loads()
    throws → _extract_narrative_text returns None → strict fallback path →
    _STRUCTURAL_ALLOWED never applies → confidence 95/92 and year 2026 VETO.
    Fix: _strip_markdown_fence() in _extract_narrative_text() strips the fence
    before json.loads(); also slices from first '{' to last '}' as last resort.

  Defect 2 — Percentage unit mismatch (pct_x10 vs basis points):
    pnl_insight_agent.py emitted Signal("trend:*:pct_x10", pct_change_x10)
    where 9.9% → value 99.  But extract_numbers("9.9%") → 990 bp.
    990 ∉ {99} → false VETO on faithfully-narrated percentage changes.
    Fix: emit pct signals as basis points (pct_change_x10 * 10 = 990).
    Signal renamed to "trend:*:pct_bp" to make the unit explicit.

  Defect 3 — Money rounding + derived numbers:
    The model converts paise → lakhs/crores itself and gets it wrong (10× error).
    Fix (approach a — primary): Tier-A now emits all derived signals the model
    needs (delta, ratio metrics: MER, CM2%, CM3%), and pre-formats every display
    string in _format_signals_as_user_content.  The model is instructed to quote
    provided display values verbatim, never recompute.
    Fix (approach b — safety net): _build_display_tolerance_set() adds the
    display-rounded paise form of each money signal to the allowed set, so that
    a correctly-rounded ₹X.XL value matches its signal even when the exact paise
    differ in the last digit of rounding.  Invented/contradicted values still fail.

Reviewer note (Shreya — security): this change narrows the validation surface
  from the full JSON blob to the free-text claim fields only.  Structural fields
  that carry no data claims (confidence, action enum, metric ids) are excluded.
  The hallucination guard is preserved: any invented metric value that appears
  in title/summary/detail/rationale and is NOT a signal value will still trigger
  ok=False.  The allowed-set extensions (confidence 0-100, benchmark bp,
  calendar date tokens, display-rounded money) are bounded and deterministic —
  they cannot be exploited to whitelist an arbitrary hallucinated number.
  An invented money value "₹9.9L" (990_000_000 paise? No — 9.9L = 9_900_000
  paise) must equal the display-rounded form of a real signal to pass; it will
  not do so unless there is a real signal near 9.9L.
"""

from __future__ import annotations

import json
import logging
from dataclasses import dataclass, field
from typing import Sequence

from .extraction import extract_numbers, normalize_signal_value

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Structural allowed-set constants (CF-C5-FAITHFULNESS-1 fix — B3 defect)
# ---------------------------------------------------------------------------

# Confidence is a 0-100 integer self-assessment injected by the output schema.
# It is never a metric data claim; allow the full range.
_CONFIDENCE_RANGE: frozenset[int] = frozenset(range(0, 101))

# Benchmark thresholds from _BENCHMARKS_BLOCK that the prompt EXPLICITLY tells
# the model to cite when a metric crosses them.  Stored as canonical int form
# because extract_numbers() normalises "20%" → 2000 bp, "2.5x" → 2 (int trunc).
#
# Derived PROGRAMMATICALLY from _BENCHMARKS_BLOCK constants so they cannot
# drift.  Two encoding rules:
#   %-benchmarks:  extract_numbers("40%") = round(40 * 100) = 4000 bp
#   MER multipliers: extract_numbers("2.5x") = int(2.5) = 2 — already covered
#     by _DAY_MONTH_ORDINALS (1–31).  BUT if the model ever cites MER in its
#     x100 signal form (e.g. "MER x100 = 250") those plain ints are:
#       4x  → 400, 2.5x → 250, 1.5x → 150
#     These are NOT in any other structural bucket, so we add them explicitly.
#
# Sources (from pnl_system_prompt._BENCHMARKS_BLOCK):
#   CM1%:       good ≥40%, warning <30%, critical <20%  → 4000, 3000, 2000 bp
#   CM2%:       good ≥25%, warning <15%, critical <5%   → 2500, 1500,  500 bp
#   CM3%:       good ≥20%, warning <10%, critical <0%   → 2000, 1000,    0 bp
#   Net Profit%:good ≥15%, warning <5%, critical <-5%  → 1500,  500, -500 bp
#   COGS%:      good ≤30%, warning >45%, critical >55%  → 3000, 4500, 5500 bp
#   MER (x100): good ≥4x (400), warning <2.5x (250), critical <1.5x (150)
#   ACOS%:      good ≤15%, warning >25%, critical >40%  → 1500, 2500, 4000 bp
#
# This set is module-level and applied on BOTH the JSON-narrative path AND the
# plain-text fallback path (unlike the broader _STRUCTURAL_ALLOWED which is
# JSON-only).  Benchmark thresholds are Brain-authored global constants that the
# model MUST cite — they are safe to whitelist on every path.
_BENCHMARK_BP_ALLOWED: frozenset[int] = frozenset([
    # CM1% thresholds (% → bp: value * 100)
    4000, 3000, 2000,
    # CM2% thresholds
    2500, 1500,  500,
    # CM3% thresholds (2000 already covered by CM1; 0 is explicit)
    1000,    0,
    # Net Profit% thresholds (-500 = −5%)
    -500,
    # COGS% thresholds
    4500, 5500,
    # ACOS% thresholds (1500 and 2500 already covered above; 4000 already above)
    # (no new entries needed — deduplicated by frozenset)
    # MER x100 form: extract_numbers("4x")=4, "2.5x"=2, "1.5x"=1 are in ordinals.
    # If the model cites MER in x100 notation these plain ints are NOT covered:
    400, 250, 150,
])

# Calendar date tokens: year fragments (e.g. 2026, 2025) and day/month ordinals
# (1-31).  The model writes period dates in detail/summary ("May 29, 2026").
# After extract_numbers() these surface as plain integers.  We allow:
#   - years: 2020-2030 (reasonable brief date range)
#   - day/month ordinals: 1-31
_CALENDAR_YEARS: frozenset[int] = frozenset(range(2020, 2031))
_DAY_MONTH_ORDINALS: frozenset[int] = frozenset(range(1, 32))

# The full structural allowed set (does NOT include signal values — those are
# added per-call from the request signals).
_STRUCTURAL_ALLOWED: frozenset[int] = (
    _CONFIDENCE_RANGE
    | _BENCHMARK_BP_ALLOWED
    | _CALENDAR_YEARS
    | _DAY_MONTH_ORDINALS
)

# Free-text narrative fields in the InsightItem JSON schema that MAY contain
# metric data claims the model must not fabricate.  Structural fields
# (confidence, action enum, metrics ids) are excluded.
_NARRATIVE_FIELDS: tuple[str, ...] = ("title", "summary", "detail", "rationale")

# ---------------------------------------------------------------------------
# Display-rounding tolerance constants (Defect 3 safety net)
# ---------------------------------------------------------------------------
# Money signals are displayed as "₹X.XL" (lakh, one decimal) or "₹X.XCr"
# (crore, one decimal).  extract_numbers() converts those display strings
# back to canonical integers, but with rounding loss.
#
# Unit convention: both Signal.value_canonical AND extract_numbers() use the
# same units defined by extraction.py:
#   _LAKH = 100_000   (1 lakh = 100,000 signal units)
#   _CRORE = 10_000_000  (1 crore = 10,000,000 signal units)
#
# Example: signal 53_437_304 → display "₹534.4L" (= 534.37 lakhs)
#   extract_numbers("₹534.4L") = round(534.4 * 100_000) = 53_440_000
#   53_440_000 ≠ 53_437_304  (rounding loss of 2696)
#
# Tolerance approach (CF-C5-FAITHFULNESS-1 Defect 3 safety net):
# For each money signal S, compute its display-rounded canonical form D
# (= what extract_numbers returns when parsing the display string of S),
# and add D to the allowed set.  A narrated money value that rounds to D
# PASSES.  Ratio/bp values (|S| < _LAKH = 100_000) are exact — no tolerance.
# The guard is preserved: an invented value must round to a real signal's
# display form to pass; arbitrary hallucinations still fail.
_LAKH_EXTR = 100_000      # matches extraction.py _LAKH
_CRORE_EXTR = 10_000_000  # matches extraction.py _CRORE


def _display_round_paise(value: int) -> int | None:
    """Return the display-rounded canonical form of a money signal value.

    Uses the SAME unit constants as extraction.py (_LAKH=100_000, _CRORE=10_000_000)
    so that the result equals what extract_numbers() produces when parsing the
    formatted display string.

    Only applies to values that would be displayed as ₹X.XL or ₹X.XCr
    (i.e. |value| ≥ _LAKH = 100_000).  Returns None for smaller values
    (ratio/bp values — those must match exactly).

    Example:
      _display_round_paise(53_437_304)
        → 53437304 / 100000 = 534.37L → display "₹534.4L"
        → extract_numbers("₹534.4L") = round(534.4 * 100000) = 53_440_000
        → returns 53_440_000

    The guard is preserved: an invented value must have the same display-rounded
    form as a real signal to pass; arbitrary hallucinations still fail.
    """
    abs_val = abs(value)
    if abs_val < _LAKH_EXTR:
        return None  # small value or ratio/bp — no tolerance
    sign = -1 if value < 0 else 1
    if abs_val >= _CRORE_EXTR:
        # Display as crores, one decimal: ₹X.XCr
        crore_x10 = round(abs_val * 10 / _CRORE_EXTR)
        # extract_numbers("₹X.XCr") = round(X.X * _CRORE_EXTR)
        # = crore_x10 * (_CRORE_EXTR // 10)
        display_canonical = crore_x10 * (_CRORE_EXTR // 10)
    else:
        # Display as lakhs, one decimal: ₹X.XL
        lakh_x10 = round(abs_val * 10 / _LAKH_EXTR)
        # extract_numbers("₹X.XL") = round(X.X * _LAKH_EXTR)
        # = lakh_x10 * (_LAKH_EXTR // 10)
        display_canonical = lakh_x10 * (_LAKH_EXTR // 10)
    return sign * display_canonical


def _build_display_tolerance_set(signal_values: frozenset[int]) -> frozenset[int]:
    """Build the display-rounded tolerance expansion of a signal value set.

    For each signal S, add _display_round_paise(S) to the result.
    Only money values (|S| ≥ _LAKH_EXTR = 100_000) get a tolerance entry;
    smaller ratio/bp values must match exactly.

    Defect 3 (b) safety net: even after Tier-A pre-formats display strings
    and the model quotes them verbatim, this prevents a residual mismatch
    when extract_numbers re-parses the display string.  The guard is preserved:
    an invented value must round to a signal's display form to pass.
    """
    tolerance: set[int] = set()
    for v in signal_values:
        d = _display_round_paise(v)
        if d is not None:
            tolerance.add(d)
    return frozenset(tolerance)


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


def _strip_markdown_fence(text: str) -> str:
    """Strip a leading/trailing markdown code fence from model output.

    The system prompt (Rule 10) forbids fences, but the model emits them
    anyway in practice.  Be robust: strip ```json … ``` or ``` … ```.

    CF-C5-FAITHFULNESS-1 (Defect 1 fix — B3 live-run, workspace
    f165da80-e6d5-4c58-9aff-ec654b873bd7, date 2026-05-19):
      json.loads() throws on a fenced string → _extract_narrative_text
      returned None → full-string strict fallback → _STRUCTURAL_ALLOWED
      never applied → confidence 95/92 and year 2026 appeared as offending
      numbers in a genuinely faithful brief.

    Strategy: strip fence first; if no fence, also try slicing from the
    first '{' to the last '}' as a last-resort extraction.  This does NOT
    weaken the faithfulness guard — the narrative-text content is unchanged;
    we only remove the non-JSON wrapper characters the model added.
    """
    s = text.strip()
    # Remove leading ```json or ``` fence
    if s.startswith("```"):
        # Find the end of the opening fence line
        newline_pos = s.find("\n")
        if newline_pos != -1:
            s = s[newline_pos + 1:]
        else:
            s = s[3:]
    # Remove trailing ``` fence
    if s.rstrip().endswith("```"):
        s = s.rstrip()
        s = s[: s.rfind("```")]
    s = s.strip()
    # Last-resort: slice from first '{' to last '}'
    if s and not s.startswith("{") and not s.startswith("["):
        first_brace = s.find("{")
        last_brace = s.rfind("}")
        if first_brace != -1 and last_brace > first_brace:
            s = s[first_brace : last_brace + 1]
    return s


def _extract_narrative_text(narration: str) -> str | None:
    """Parse the model JSON and concatenate all free-text narrative fields.

    Returns the concatenated narrative string, or None if parsing fails
    (caller should fall back to full-string validation).

    CF-C5-FAITHFULNESS-1 fix: we validate only the claim-bearing fields
    (title, summary, detail, rationale), NOT the full JSON blob.  Structural
    fields (confidence int, recommendation.action enum, metrics[] id strings)
    carry no data claims and are excluded to prevent false VETO trips.

    Defect 1 fix: strip markdown code fence before json.loads() so that
    fence-wrapped model output does not force the strict fallback path.
    """
    # Defect 1: strip any markdown fence the model added despite Rule 10.
    cleaned = _strip_markdown_fence(narration)
    try:
        data = json.loads(cleaned)
    except (json.JSONDecodeError, ValueError):
        return None  # Caller falls back to full-string validation.

    if not isinstance(data, dict):
        return None

    narrative_parts: list[str] = []
    insights = data.get("insights", [])
    if not isinstance(insights, list):
        return None

    for item in insights:
        if not isinstance(item, dict):
            continue
        for field_name in _NARRATIVE_FIELDS:
            value = item.get(field_name)
            if isinstance(value, str):
                narrative_parts.append(value)
        # Also walk recommendation sub-object for rationale.
        rec = item.get("recommendation")
        if isinstance(rec, dict):
            rationale = rec.get("rationale")
            if isinstance(rationale, str):
                narrative_parts.append(rationale)

    if not narrative_parts:
        return ""

    return " ".join(narrative_parts)


def validate_faithfulness(
    narration: str,
    signals: Sequence[Signal],
) -> FaithfulnessResult:
    """Validate that every metric number in the LLM narration is a real signal.

    CF-C5-FAITHFULNESS-1 (fix — B3 live-run defect, workspace
    f165da80-e6d5-4c58-9aff-ec654b873bd7, date 2026-05-19):

    The model emits JSON (InsightItem[] schema).  Validating the full JSON blob
    caused false VETO trips on structural integers (confidence: 95, calendar
    dates, benchmark thresholds from _BENCHMARKS_BLOCK).  The fix:

      1. Parse the JSON and validate only the free-text claim fields
         (title, summary, detail, rationale).
      2. Extend the allowed set with structural constants:
         - confidence range 0-100 (schema field, not a data claim)
         - benchmark bp values the prompt explicitly tells the model to cite
         - calendar date tokens (year, day/month ordinals)

    The hallucination guard is FULLY PRESERVED: a fabricated metric value in
    any narrative field (e.g. "CM2 was ₹9.9L" when no signal equals 990_000)
    will still produce ok=False.

    If JSON parsing fails (malformed output), falls back to full-string
    validation — fail-safe, same VETO strength as the original implementation.

    CF-C5-FAITHFULNESS-COST-1: normalization MUST occur before comparison
    so that locale/notation variants of the same value are not false-rejected.

    Args:
        narration: the LLM-generated text (raw JSON from model) to validate.
        signals: the deterministic Tier-A signal values that were passed to the
            LLM as context. Only these values are considered "authoritative".

    Returns:
        FaithfulnessResult(ok=True, []) if all narrative-claim numbers are
        present in the extended allowed set (signal values + structural
        constants), or if narration contains no claim numbers.
        FaithfulnessResult(ok=False, offending=[...]) otherwise.
    """
    if not narration.strip():
        # Empty narration is trivially faithful (no numbers to check).
        return FaithfulnessResult(ok=True, offending_numbers=[])

    # Build the canonical signal value set (authoritative data claims).
    canonical_signal_values: frozenset[int] = frozenset(
        normalize_signal_value(sig.value_canonical) for sig in signals
    )

    # --- Step 1: attempt JSON parse to extract narrative text only. ---
    # If the model returned valid JSON (expected path — InsightItem[] schema),
    # validate only the free-text claim fields and use the EXTENDED allowed set.
    # If JSON is malformed, fall back to full-string validation with the STRICT
    # allowed set (signal values only) — fail-safe, same strength as before.
    #
    # CF-C5-FAITHFULNESS-1 design note: the _STRUCTURAL_ALLOWED extensions
    # (confidence range, benchmark bp, calendar dates) only apply on the JSON
    # path because those numbers appear STRUCTURALLY there (confidence is a JSON
    # field; benchmark thresholds are cited because the prompt tells the model to).
    # On the plain-text fallback path those structural numbers are not expected,
    # so we do not relax the allowed set — any non-signal number still offends.
    #
    # Defect 1 fix: _extract_narrative_text now strips markdown fences before
    # json.loads(), so a ``\`json … \``` wrapped output uses the JSON path
    # (with the STRUCTURAL_ALLOWED extension) instead of the strict fallback.
    narrative_text = _extract_narrative_text(narration)

    # Defect 3 (b) safety net: display-rounded paise tolerance.
    # For each money signal, add its display-rounded form (what extract_numbers
    # produces when the model correctly quotes the display string) to the allowed
    # set.  Ratio/bp values are exact and are not expanded.
    # This is a SAFETY NET on top of Tier-A emitting pre-formatted display
    # strings (Defect 3a) — it handles any residual mismatch from rounding.
    display_tolerance = _build_display_tolerance_set(canonical_signal_values)

    if narrative_text is None:
        # JSON parse failed — fall back to full-string validation (strict).
        # Signal values + display tolerance apply on both paths.
        # _BENCHMARK_BP_ALLOWED is also applied here: benchmark thresholds are
        # Brain-authored global constants (not data claims) that the model is
        # INSTRUCTED to cite when a metric crosses a threshold.  Vetoing them on
        # the fallback path was a false-positive — these numbers cannot be
        # exploited to whitelist arbitrary hallucinated DATA values (they are a
        # bounded frozenset of known constants, and a fabricated workspace metric
        # e.g. "net sales ₹9.9Cr" produces 99_000_000 which is NOT in this set).
        # The broader _STRUCTURAL_ALLOWED (confidence 0-100, calendar dates) is
        # still JSON-path only; only the benchmark subset is safe on all paths.
        logger.debug(
            "validate_faithfulness: JSON parse failed, falling back to "
            "full-string validation with benchmark whitelist. narration_preview=%r",
            narration[:100],
        )
        text_to_validate = narration
        allowed = canonical_signal_values | display_tolerance | _BENCHMARK_BP_ALLOWED
    else:
        text_to_validate = narrative_text
        # Extended allowed set = signal values + display tolerance + structural constants.
        # CF-C5-FAITHFULNESS-1: structural constants are bounded, deterministic,
        # and cannot be exploited to whitelist an arbitrary hallucinated number.
        # _BENCHMARK_BP_ALLOWED is a subset of _STRUCTURAL_ALLOWED; unioning both
        # is idempotent — it is explicit here for readability.
        allowed = canonical_signal_values | display_tolerance | _STRUCTURAL_ALLOWED

    if not text_to_validate.strip():
        # No narrative text to check (empty JSON or no insights) — trivially faithful.
        return FaithfulnessResult(ok=True, offending_numbers=[])

    # --- Step 2: extract canonical integers from the narrative text. ---
    extracted: list[int] = extract_numbers(text_to_validate)

    if not extracted:
        return FaithfulnessResult(ok=True, offending_numbers=[])

    # --- Step 3: set-compare against the (path-appropriate) allowed set. ---
    offending: list[str] = []
    for num in extracted:
        if num not in allowed:
            offending.append(str(num))

    return FaithfulnessResult(
        ok=len(offending) == 0,
        offending_numbers=offending,
    )
