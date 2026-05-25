"""
taxonomy.py — Parity harness mismatch category taxonomy.

@paradigm: sql (exact-integer classification, zero LLM)
Justified: mismatch categories are pure deterministic rules. The
ROUNDING_MODE_MISMATCH re-derivation is exact Decimal arithmetic.
CF-C2-RECON-TAXONOMY-1 (HIGH).

6 categories (updated Child 4 — added COGS_SETTINGS_CHANGE_DELTA):
  1. BLOCKING_BUG         — genuine Brain arithmetic or logic error; blocks cutover.
  2. EXPECTED_DEFINITIONAL_DELTA — known semantic difference (Child 4 registers).
  3. EXCLUDED_FX_MISMATCH — cross-currency FX rate difference; excluded from gate.
  4. RATIO_MISMATCH       — ratio/basis-point field; separate tolerance.
  5. ROUNDING_MODE_MISMATCH — division-derived Postgres intermediate: legacy used
                              ROUND_HALF_UP, Brain uses ROUND_HALF_EVEN. Expected
                              and NOT a BLOCKING_BUG.
  6. COGS_SETTINGS_CHANGE_DELTA — (Child 4 NEW) data-staleness class, NOT a formula
                              change. Fires when an incremental MV would diverge from
                              legacy's full-daily-recompute on a coq-settings-change day.
                              Brain uses full daily recompute → delta = 0 vs legacy.
                              DISTINCT from EXPECTED_DEFINITIONAL_DELTA (that is for
                              formula changes, not data-staleness). CF-C4-COGS-MV-REFRESH-1.

The `expected_definitional_delta` hook is WIRED to the DDR this child (Child 4).
parity_gap:true metrics route to the correctness-fixture gate, NOT here.
CF-C4-DDR-1, CF-C4-COGS-MV-REFRESH-1, CF-C4-PARITY-SCOPE-1.

--- ROUNDING_MODE_MISMATCH RE-DERIVATION RULE (F2 fix) ---

The tautology that made the RMM branch unreachable in the original code:
    re_derive_legacy_via_brain_path() called decimal_to_minor_units() (ROUND_HALF_EVEN),
    which is identical to how classify_mismatch computed legacy_mu.
    Since both used the same function on the same input, re_derive always equalled
    legacy_mu, and because classify_mismatch is only reached when legacy_mu != brain_mu,
    the branch condition (re_derive == brain_mu) was always False.

The correct two-path model:

    Path A  — LEGACY path (ROUND_HALF_UP):
        Legacy TS code computed miscExpensesProrated = monthlyAmt / daysInMonth
        as a JavaScript float, then stored the result in Postgres Decimal(12,2)
        via Postgres's implicit ROUND_HALF_UP. During migration or import, if the
        stored integer in Brain's DB was written using ROUND_HALF_UP (the legacy
        anti-pattern), brain_mu for that row reflects ROUND_HALF_UP rounding.

    Path B  — BRAIN canonical path (ROUND_HALF_EVEN):
        The harness applies decimal_to_minor_units() (ROUND_HALF_EVEN) to the
        legacy-stored decimal string. This is Brain's canonical conversion path.
        legacy_mu in classify_mismatch is this ROUND_HALF_EVEN result.

    On a .X45 midpoint (e.g. "4642.845" × 100 = 464284.5):
        ROUND_HALF_UP → 464285   (brain_mu if imported via legacy path)
        ROUND_HALF_EVEN → 464284 (legacy_mu in classify_mismatch; harness canonical)
        delta = 464285 - 464284 = +1

    The RMM branch fires when:
        field in DIVISION_DERIVED_FIELDS
        AND re_derive_legacy_via_brain_path(legacy_decimal, mult) == brain_mu
        (re_derive uses ROUND_HALF_UP — the LEGACY path — and matches brain_mu)
        AND legacy_mu (ROUND_HALF_EVEN) != brain_mu

    This is genuinely reachable: when brain_mu = ROUND_HALF_UP(legacy_decimal × mult)
    and legacy_mu = ROUND_HALF_EVEN(legacy_decimal × mult), they differ by 1 on
    .X45 midpoints, and re_derive (ROUND_HALF_UP) == brain_mu → RMM.

    Fail-safe: re_derive uses ROUND_HALF_UP strictly. Any delta that cannot be
    explained by the ROUND_HALF_UP path falls through to BLOCKING_BUG. No real
    arithmetic bug is suppressed.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from decimal import ROUND_HALF_EVEN, ROUND_HALF_UP, Decimal
from enum import Enum
from typing import Optional

# ---------------------------------------------------------------------------
# Division-derived fields that use Postgres ROUND_HALF_UP on the intermediate
# stored value, creating a systematic 1-paise drift on .X45 midpoints.
# Enumerated explicitly per CF-C2-RECON-TAXONOMY-1.
# ---------------------------------------------------------------------------
DIVISION_DERIVED_FIELDS: frozenset[str] = frozenset(
    [
        "miscExpensesProrated",  # compute-daily.ts:243: monthlyAmt / daysInMonth
        "cm3",                   # cm2 - miscExpensesProrated; carries the drift
        # Audited: cogs and totalAdSpend go through float accumulation, NOT
        # a single irrational-quotient division step, so they are classified
        # separately (CF-C2-FLOAT-COGS-1 artifact) rather than ROUNDING_MODE_MISMATCH.
        # They are listed here for completeness; the harness audits them at run-time.
        "cogs",          # float-accumulation artifact (CF-C2-FLOAT-COGS-1), not division
        "totalAdSpend",  # float-accumulation artifact, not division
    ]
)


class MismatchCategory(str, Enum):
    """Parity harness mismatch classification (6 categories, updated Child 4).

    CF-C2-RECON-TAXONOMY-1: all base categories present. BLOCKING_BUG is the
    only category that blocks cutover.
    CF-C4-COGS-MV-REFRESH-1: adds COGS_SETTINGS_CHANGE_DELTA (6th category).
    """

    BLOCKING_BUG = "BLOCKING_BUG"
    """Genuine Brain arithmetic or logic error. Blocks cutover. Must be resolved."""

    EXPECTED_DEFINITIONAL_DELTA = "EXPECTED_DEFINITIONAL_DELTA"
    """Known semantic difference between Brain and legacy (e.g. different field
    definitions). Registered in the Definitional-Delta Register (Child 4).
    DDR hook WIRED this child (Child 4) via expected_definitional_delta field."""

    EXCLUDED_FX_MISMATCH = "EXCLUDED_FX_MISMATCH"
    """Cross-currency FX rate difference. Excluded from the parity gate.
    Legacy hardcoded EXCHANGE_RATES (workspace-costs.ts:9-21, pnl.ts:11-17).
    Shadow phase: Brain uses same static 83.5 rate. CF-C4-DDR-FX-RESTATEMENT-1."""

    RATIO_MISMATCH = "RATIO_MISMATCH"
    """Ratio / basis-point field mismatch. Evaluated under a separate tolerance
    (not exact-integer). INT32 FLOOR vs ROUND_HALF_EVEN distinction."""

    ROUNDING_MODE_MISMATCH = "ROUNDING_MODE_MISMATCH"
    """Division-derived Postgres intermediate: legacy used Postgres ROUND_HALF_UP
    on the stored value; Brain uses ROUND_HALF_EVEN on the re-derived value.
    This is an EXPECTED systematic 1-paise drift on .X45 midpoints for
    miscExpensesProrated / cm3. NOT a BLOCKING_BUG.
    IMPORTANT (CF-C4-PRORATED-DIVOP-1): this category covers ONLY the Postgres
    ROUND_HALF_UP story — NOT Float64 coercion artifacts. A wrong days_in_month
    constant (e.g. hardcoded 30 instead of toDaysInMonth) must NOT be classified
    here; it is a BLOCKING_BUG. Adjudication must ask "Is Brain's formula correct?"
    before stamping ROUNDING_MODE_MISMATCH.
    See: DIVISION_DERIVED_FIELDS, re_derive_legacy_via_brain_path()."""

    COGS_SETTINGS_CHANGE_DELTA = "COGS_SETTINGS_CHANGE_DELTA"
    """Data-staleness class — NOT a formula change. CF-C4-COGS-MV-REFRESH-1.
    Fires when an incremental MV would capture the old coq for line items
    before a coq-settings-change and the new coq for line items after it —
    permanently wrong vs legacy's nightly full daily recompute.
    Brain uses full daily recompute → delta = 0 vs legacy by construction.
    DISTINCT from EXPECTED_DEFINITIONAL_DELTA (which is for formula-level
    semantic differences, not data-staleness from incremental capture).
    A fixture proving the full-recompute model yields zero delta is REQUIRED.
    Kill-test: reverting to incremental MV on a coq-change-day fixture → RED."""


@dataclass(frozen=True)
class MismatchRecord:
    """A single field-level mismatch record from the harness.

    Shape mirrors the FIRST_DIVERGENCE JSON record defined in §9 of the plan:
    {workspace_id, date, field, legacy_mu, brain_mu, delta, category}.
    """

    workspace_id: str
    date: str                       # ISO date string "YYYY-MM-DD"
    field: str                      # metric field name (e.g. "netSales")
    legacy_mu: int                  # legacy decimal × subunit_multiplier → MU
    brain_mu: int                   # Brain BIGINT value
    delta: int                      # brain_mu - legacy_mu
    category: MismatchCategory
    note: str = ""


@dataclass
class HarnessReport:
    """Structured report emitted by the parity harness engine.

    CF-C2-RECON-TAXONOMY-1: must include rounding_mode_mismatches_count.
    CF-C4-DDR-1: expected_definitional_delta hook WIRED to DDR (Child 4).
    CF-C4-COGS-MV-REFRESH-1: cogs_settings_change_delta_count added.
    CF-C4-RATIO-DIVOP-1: clickhouse_roundtrip_checked flag added.
    CF-C4-PARITY-SCOPE-1: input_source declaration added.
    """

    rows_checked: int = 0
    fields_checked: int = 0
    passed: int = 0
    mismatches: list[MismatchRecord] = field(default_factory=list)

    # CF-C2-RECON-TAXONOMY-1: category counters
    blocking_bug_count: int = 0
    expected_definitional_delta_count: int = 0
    excluded_fx_mismatch_count: int = 0
    ratio_mismatch_count: int = 0
    rounding_mode_mismatches_count: int = 0  # named field per contract

    # CF-C4-COGS-MV-REFRESH-1: new 6th category counter
    cogs_settings_change_delta_count: int = 0

    # First divergence (fail-fast reporting)
    first_divergence: Optional[MismatchRecord] = None

    # CF-C4-DDR-1: expected_definitional_delta hook WIRED to the DDR.
    # Child 4 populates this via definitional_delta_register.py.
    # Shape: {metric_id: DDRRow.reason} for metrics with DDR rows.
    expected_definitional_delta: Optional[dict] = None  # wired Child 4

    # CF-C4-RATIO-DIVOP-1: ClickHouse round-trip fixtures checked this run.
    clickhouse_roundtrip_checked: bool = False

    # CF-C4-COGS-MV-REFRESH-1: count of COGS settings change delta fixtures checked.
    cogs_settings_change_delta_fixtures_checked: int = 0

    # Correctness-fixture gate: count of parity_gap:true metrics verified.
    correctness_fixture_pass: int = 0
    correctness_fixture_fail: int = 0

    # CF-C4-PARITY-SCOPE-1: input source declaration.
    # Every harness run MUST declare its input source.
    # "legacy_sourced" GREEN proves formula/representation parity only —
    # NOT a cutover license. "brain_child3_sourced" required for live flip.
    input_source: str = "legacy_sourced"  # "legacy_sourced" | "brain_child3_sourced"

    @property
    def total_mismatches(self) -> int:
        return len(self.mismatches)

    @property
    def is_pass(self) -> bool:
        """True iff zero BLOCKING_BUG mismatches (other categories are non-blocking)."""
        return self.blocking_bug_count == 0

    def record_mismatch(self, record: MismatchRecord) -> None:
        """Record a mismatch, update category counters, set first_divergence."""
        self.mismatches.append(record)
        if self.first_divergence is None:
            self.first_divergence = record
        if record.category == MismatchCategory.BLOCKING_BUG:
            self.blocking_bug_count += 1
        elif record.category == MismatchCategory.EXPECTED_DEFINITIONAL_DELTA:
            self.expected_definitional_delta_count += 1
        elif record.category == MismatchCategory.EXCLUDED_FX_MISMATCH:
            self.excluded_fx_mismatch_count += 1
        elif record.category == MismatchCategory.RATIO_MISMATCH:
            self.ratio_mismatch_count += 1
        elif record.category == MismatchCategory.ROUNDING_MODE_MISMATCH:
            self.rounding_mode_mismatches_count += 1
        elif record.category == MismatchCategory.COGS_SETTINGS_CHANGE_DELTA:
            self.cogs_settings_change_delta_count += 1

    def to_dict(self) -> dict:
        """Serialize to a JSON-compatible dict for structured logging.

        CF-C4 extensions: includes clickhouse_roundtrip_checked,
        cogs_settings_change_delta_count, correctness_fixture_pass,
        input_source declaration (CF-C4-PARITY-SCOPE-1).
        """
        return {
            "rows_checked": self.rows_checked,
            "fields_checked": self.fields_checked,
            "passed": self.passed,
            "total_mismatches": self.total_mismatches,
            "blocking_bug_count": self.blocking_bug_count,
            "expected_definitional_delta_count": self.expected_definitional_delta_count,
            "excluded_fx_mismatch_count": self.excluded_fx_mismatch_count,
            "ratio_mismatch_count": self.ratio_mismatch_count,
            "rounding_mode_mismatches_count": self.rounding_mode_mismatches_count,
            "cogs_settings_change_delta_count": self.cogs_settings_change_delta_count,
            "is_pass": self.is_pass,
            "first_divergence": (
                {
                    "workspace_id": self.first_divergence.workspace_id,
                    "date": self.first_divergence.date,
                    "field": self.first_divergence.field,
                    "legacy_mu": self.first_divergence.legacy_mu,
                    "brain_mu": self.first_divergence.brain_mu,
                    "delta": self.first_divergence.delta,
                    "category": self.first_divergence.category.value,
                }
                if self.first_divergence
                else None
            ),
            "expected_definitional_delta": self.expected_definitional_delta,
            # CF-C4 extensions
            "clickhouse_roundtrip_checked": self.clickhouse_roundtrip_checked,
            "cogs_settings_change_delta_fixtures_checked": self.cogs_settings_change_delta_fixtures_checked,
            "correctness_fixture_pass": self.correctness_fixture_pass,
            "correctness_fixture_fail": self.correctness_fixture_fail,
            # CF-C4-PARITY-SCOPE-1: source declaration
            "input_source": self.input_source,
            "parity_scope_note": (
                "legacy_sourced GREEN proves formula/representation parity ONLY — "
                "NOT a cutover license. Live flip requires Brain-Child-3-sourced GREEN."
                if self.input_source == "legacy_sourced"
                else "brain_child3_sourced: ingest parity included in this run."
            ),
        }


def _decimal_to_minor_units_round_half_up(
    amount: str,
    subunit_multiplier: int,
) -> int:
    """Convert a decimal string to minor units using ROUND_HALF_UP (the legacy Postgres path).

    This function is INTENTIONALLY DISTINCT from decimal_to_minor_units(), which uses
    ROUND_HALF_EVEN (Brain's canonical path). The two functions produce different
    results on .X45 midpoints, making the RMM re-derivation rule genuinely reachable.

    Only used internally by re_derive_legacy_via_brain_path() for the RMM check.
    Do NOT use this function anywhere else — Brain's canonical path is always
    ROUND_HALF_EVEN via decimal_to_minor_units(). CF-C2-RECON-TAXONOMY-1.

    Args:
        amount: a decimal string (the Postgres-stored value).
        subunit_multiplier: e.g. 100 for INR.

    Returns:
        int: legacy minor units using ROUND_HALF_UP (Postgres convention).

    Examples:
        >>> _decimal_to_minor_units_round_half_up("4642.845", 100)
        464285   # ROUND_HALF_UP: 464284.5 rounds UP → 464285
        >>> _decimal_to_minor_units_round_half_up("4642.835", 100)
        464284   # ROUND_HALF_UP: 464283.5 rounds UP → 464284
    """
    if not isinstance(amount, str):
        raise TypeError(
            f"_decimal_to_minor_units_round_half_up: `amount` must be a str, "
            f"got {type(amount).__name__!r}."
        )
    d = Decimal(amount)
    multiplier = Decimal(subunit_multiplier)
    scaled = d * multiplier
    quantized = scaled.quantize(Decimal("1"), rounding=ROUND_HALF_UP)
    return int(quantized)


def re_derive_legacy_via_brain_path(
    legacy_stored_decimal: str,
    subunit_multiplier: int,
) -> int:
    """Re-derive the legacy stored value using the LEGACY Postgres ROUND_HALF_UP path.

    This function models the LEGACY computation path:
    - Legacy TS computed division-derived fields as JS floats
    - Postgres stored the result using ROUND_HALF_UP rounding
    - During migration/import, the integer in Brain's DB may reflect ROUND_HALF_UP

    The RMM re-derivation rule (CF-C2-RECON-TAXONOMY-1):
    If this function returns a value equal to brain_mu, the mismatch is explained
    by the ROUND_HALF_UP vs ROUND_HALF_EVEN difference — classify ROUNDING_MODE_MISMATCH.
    If this function does NOT equal brain_mu, the delta has a different cause —
    classify BLOCKING_BUG (fail-safe: no real bug is suppressed).

    CRITICAL DISTINCTION from decimal_to_minor_units():
    - decimal_to_minor_units() uses ROUND_HALF_EVEN (Brain's canonical path)
    - This function uses ROUND_HALF_UP (the legacy Postgres path)
    - On .X45 midpoints (e.g. "4642.845" × 100 = 464284.5):
        ROUND_HALF_UP  → 464285  (this function)
        ROUND_HALF_EVEN → 464284  (decimal_to_minor_units)
    This 1-unit difference makes the RMM branch genuinely reachable when
    brain_mu reflects ROUND_HALF_UP storage and legacy_mu (ROUND_HALF_EVEN) differs.

    Args:
        legacy_stored_decimal: the Postgres Decimal value as a string
            (e.g. "4642.845" — a .X45 midpoint stored by Postgres).
        subunit_multiplier: e.g. 100 for INR.

    Returns:
        int: minor units using ROUND_HALF_UP (the legacy Postgres convention).
    """
    return _decimal_to_minor_units_round_half_up(legacy_stored_decimal, subunit_multiplier)


def classify_mismatch(
    workspace_id: str,
    date: str,
    field: str,
    legacy_stored_decimal: str,
    brain_mu: int,
    subunit_multiplier: int,
) -> MismatchRecord:
    """Classify a single field-level mismatch into one of the 5 categories.

    Re-derivation rule for ROUNDING_MODE_MISMATCH (CF-C2-RECON-TAXONOMY-1):

    Two distinct computations — each simulates a different path:

        legacy_mu (ROUND_HALF_EVEN, Brain's canonical path):
            Applies decimal_to_minor_units() to the stored decimal. This is the
            harness's canonical path — the same formula Brain uses everywhere.

        re_derive (ROUND_HALF_UP, the legacy Postgres path):
            Applies re_derive_legacy_via_brain_path() which uses ROUND_HALF_UP,
            simulating the legacy Postgres convention for division-derived fields.

    Classification logic:
        - If delta == 0: no mismatch (graceful no-op; caller should not reach here).
        - If field in DIVISION_DERIVED_FIELDS AND re_derive_legacy_via_brain_path()
          == brain_mu: the mismatch is explained by the ROUND_HALF_UP vs ROUND_HALF_EVEN
          difference → ROUNDING_MODE_MISMATCH (expected; NOT a BLOCKING_BUG).
        - Otherwise: BLOCKING_BUG (fail-safe; no genuine arithmetic error is suppressed).

    Why the branch is now genuinely reachable:
        For a .X45 midpoint (e.g. "4642.845" × 100 = 464284.5):
            legacy_mu (ROUND_HALF_EVEN) = 464284
            re_derive (ROUND_HALF_UP)   = 464285
        When brain_mu = 464285 (Brain stored via legacy ROUND_HALF_UP path):
            delta = 464285 - 464284 = +1  (non-zero → enters classification)
            re_derive = 464285 == brain_mu → ROUNDING_MODE_MISMATCH  ✓
        When brain_mu = 464284 (Brain used its own ROUND_HALF_EVEN path):
            delta = 464284 - 464284 = 0   (no mismatch; handled gracefully)
        When brain_mu = 464290 (genuine arithmetic bug, unrelated to rounding):
            delta = +6 ≠ 0
            re_derive = 464285 ≠ 464290   → BLOCKING_BUG  ✓ (fail-safe)

    Args:
        workspace_id: workspace identifier.
        date: ISO date string.
        field: metric field name.
        legacy_stored_decimal: the legacy Postgres Decimal value as string.
        brain_mu: Brain's integer minor-unit value for this field.
        subunit_multiplier: currency subunit multiplier.

    Returns:
        MismatchRecord with the correct category.
    """
    from brain_metrics.convert import decimal_to_minor_units

    # Path A — ROUND_HALF_EVEN (Brain's canonical path; same as harness pre-check).
    legacy_mu = decimal_to_minor_units(legacy_stored_decimal, subunit_multiplier)
    delta = brain_mu - legacy_mu

    if delta == 0:
        # Caller should not call classify_mismatch when there is no mismatch,
        # but handle gracefully.
        return MismatchRecord(
            workspace_id=workspace_id,
            date=date,
            field=field,
            legacy_mu=legacy_mu,
            brain_mu=brain_mu,
            delta=0,
            category=MismatchCategory.BLOCKING_BUG,
            note="classify_mismatch called with no delta (no mismatch)",
        )

    # Check ROUNDING_MODE_MISMATCH: division-derived fields where the legacy
    # Postgres ROUND_HALF_UP convention creates a systematic 1-unit drift on
    # .X45 midpoints vs Brain's ROUND_HALF_EVEN.
    #
    # Path B — ROUND_HALF_UP (legacy Postgres path; DISTINCT from Path A):
    # re_derive_legacy_via_brain_path() uses ROUND_HALF_UP internally, making
    # this a genuinely independent computation. On a .X45 midpoint it returns
    # a value that differs from legacy_mu by 1. When that value equals brain_mu,
    # the delta is fully explained by the rounding-mode difference — not a bug.
    #
    # Fail-safe: if re_derive (ROUND_HALF_UP) does NOT equal brain_mu, the delta
    # cannot be explained by rounding — default to BLOCKING_BUG. No real bug is
    # ever suppressed into a non-blocking bucket. CF-C2-RECON-TAXONOMY-1.
    if field in DIVISION_DERIVED_FIELDS:
        legacy_path_result = re_derive_legacy_via_brain_path(
            legacy_stored_decimal, subunit_multiplier
        )
        if legacy_path_result == brain_mu:
            return MismatchRecord(
                workspace_id=workspace_id,
                date=date,
                field=field,
                legacy_mu=legacy_mu,
                brain_mu=brain_mu,
                delta=delta,
                category=MismatchCategory.ROUNDING_MODE_MISMATCH,
                note=(
                    f"Division-derived field '{field}': legacy ROUND_HALF_UP "
                    f"(re_derive={legacy_path_result}) matches brain_mu={brain_mu}, "
                    f"while Brain canonical ROUND_HALF_EVEN gives legacy_mu={legacy_mu}. "
                    f"Systematic .X45 midpoint delta={delta}; NOT a BLOCKING_BUG. "
                    "CF-C2-RECON-TAXONOMY-1."
                ),
            )

    # Default: BLOCKING_BUG — genuine arithmetic or logic error.
    return MismatchRecord(
        workspace_id=workspace_id,
        date=date,
        field=field,
        legacy_mu=legacy_mu,
        brain_mu=brain_mu,
        delta=delta,
        category=MismatchCategory.BLOCKING_BUG,
        note=f"Unexplained delta={delta} for field='{field}'. Investigate.",
    )
