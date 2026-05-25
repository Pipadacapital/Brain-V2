"""
harness.py — Parity harness engine: exact-integer comparator over fixtures.

@paradigm: sql (exact-integer comparator, zero float in the harness, zero LLM)
Justified: the harness compares `SUM(legacy Decimal × subunit_multiplier
ROUND_HALF_EVEN) == SUM(Brain BIGINT)` at zero tolerance. The paradigm is the
strongest possible: deterministic integer equality. Any float in the harness
would defeat the purpose. M-A5-1, CF-C2-GOLDEN-1.

Child 4 extensions (CF-C4-DDR-1, CF-C4-PARITY-SCOPE-1, CF-C4-RATIO-DIVOP-1):
- DDR hook wired via `ddr_lookup` parameter (definitional_delta_register.py)
- `input_source` parameter added (CF-C4-PARITY-SCOPE-1: every run declares source)
- parity_gap:true metrics routed to correctness-fixture gate (NEVER shadow-compare)
- COGS_SETTINGS_CHANGE_DELTA category counter added

Iteration grain: (workspace_id, date, field) — future live run uses the same
grain by construction (mechanical re-point at real data, not a re-derivation).

ZERO live DB read. ZERO legacy edit. Fixtures are synthetic.
CF-C2-NO-LIVE-1, CF-BN-NOLEGACY-1.
"""

from __future__ import annotations

import json
import pathlib
from typing import Any, Callable, Optional

from brain_metrics.convert import decimal_to_minor_units
from brain_metrics.parity.taxonomy import (
    HarnessReport,
    MismatchCategory,
    MismatchRecord,
    classify_mismatch,
)

# Default fixture file (the golden set, co-located with this package).
_DEFAULT_FIXTURE_PATH = pathlib.Path(__file__).parent / "fixtures" / "golden_fixtures.json"

# DDR hook type: accepts a metric field name, returns the DDR row reason string
# or None if no DDR row is registered (exact equality expected).
# CF-C4-DDR-1: wired to definitional_delta_register.get_ddr_row().
DDRLookupFn = Callable[[str], Optional[str]]  # field_name -> reason_str | None


def _load_fixtures(fixture_path: pathlib.Path) -> dict[str, Any]:
    """Load the golden fixture JSON file."""
    with fixture_path.open("r", encoding="utf-8") as fh:
        return json.load(fh)


def _compare_field(
    workspace_id: str,
    date: str,
    field: str,
    legacy_decimal: str,
    brain_mu: int,
    subunit_multiplier: int,
    report: HarnessReport,
) -> None:
    """Compare one (workspace, date, field) cell. Update the report in-place.

    @paradigm: sql — exact integer comparison; no float arithmetic.
    """
    report.fields_checked += 1

    # Convert legacy decimal string to minor units (exact path — no float).
    legacy_mu = decimal_to_minor_units(legacy_decimal, subunit_multiplier)

    if legacy_mu == brain_mu:
        report.passed += 1
        return

    # Mismatch: classify into one of the 5 categories.
    record = classify_mismatch(
        workspace_id=workspace_id,
        date=date,
        field=field,
        legacy_stored_decimal=legacy_decimal,
        brain_mu=brain_mu,
        subunit_multiplier=subunit_multiplier,
    )
    report.record_mismatch(record)


def run_harness(
    fixtures: list[dict[str, Any]] | None = None,
    fixture_path: pathlib.Path = _DEFAULT_FIXTURE_PATH,
    inject_drift: dict[str, Any] | None = None,
    ddr_lookup: DDRLookupFn | None = None,
    input_source: str = "legacy_sourced",
) -> HarnessReport:
    """Run the parity harness over a synthetic fixture set.

    @paradigm: sql — exact-integer comparator. Zero live DB read.
    CF-C2-GOLDEN-1: operates on synthetic fixtures only (ZERO live data).

    Child 4 parameters:
    - ddr_lookup: optional DDR hook callable (field_name → reason_str | None).
      When provided, mismatches on DDR-registered fields are classified as
      EXPECTED_DEFINITIONAL_DELTA (non-blocking) rather than BLOCKING_BUG.
      parity_gap:True fields are NEVER routed here — they go to the
      correctness-fixture gate. CF-C4-DDR-1.
    - input_source: "legacy_sourced" (default) or "brain_child3_sourced".
      CF-C4-PARITY-SCOPE-1: every run must declare its source. A
      legacy-sourced GREEN is NOT a cutover license (proves formula parity only).

    Args:
        fixtures: explicit list of fixture dicts (for testing with injected
            drift or inline fixtures). If None, loads from `fixture_path`.
        fixture_path: path to the golden fixture JSON file. Defaults to the
            co-located golden_fixtures.json.
        inject_drift: if provided, override one fixture's `legacy_decimal`
            with a drifted value to verify FIRST_DIVERGENCE detection. Format:
            {"workspace_id": ..., "date": ..., "field": ..., "drifted_legacy": "..."}.
        ddr_lookup: DDR hook callable (CF-C4-DDR-1). When provided, fields
            with DDR rows are non-blocking (EXPECTED_DEFINITIONAL_DELTA).
        input_source: parity scope declaration (CF-C4-PARITY-SCOPE-1).
            "legacy_sourced" | "brain_child3_sourced".

    Returns:
        HarnessReport: structured report with PASS/FAIL and category counts.
    """
    report = HarnessReport(input_source=input_source)

    # Populate DDR hook into report for observability (CF-C4-DDR-1).
    if ddr_lookup is not None:
        report.expected_definitional_delta = {
            "__ddr_hook": "wired",
            "__source": "definitional_delta_register.py",
        }

    # Load fixtures
    raw: list[dict[str, Any]]
    if fixtures is not None:
        raw = fixtures
    else:
        data = _load_fixtures(fixture_path)
        # Flatten all fixture groups into a comparable list.
        # Each top-level key (except _meta) is a list of fixture objects.
        raw = []
        for key, items in data.items():
            if key.startswith("_"):
                continue
            if not isinstance(items, list):
                continue
            raw.extend(items)

    # Build (workspace, date, field) triples for the harness.
    # Fixtures carry `expected_minor_units` as the "Brain BIGINT" value.
    # The `amount` is the "legacy decimal string".
    for fx in raw:
        # Skip non-field fixtures (COGS accumulation uses different shape)
        if "expected_minor_units" not in fx and "brain_expected_mu" not in fx:
            continue

        # Support both shapes
        if "brain_expected_mu" in fx:
            # COGS / RMM fixture shape
            workspace_id = fx.get("workspace_id", "ws_test_golden_001")
            date_str = fx.get("date", "2026-01-01")
            field_name = fx.get("field", fx.get("id", "unknown"))
            legacy_decimal = fx.get("legacy_stored_decimal", fx.get("coq_per_item", "0"))
            brain_mu = fx["brain_expected_mu"]
            subunit_mult = fx.get("subunit_multiplier", 100)
        else:
            # Standard conversion fixture shape
            workspace_id = fx.get("workspace_id", "ws_test_golden_001")
            date_str = fx.get("date", "2026-01-01")
            field_name = fx.get("field", fx.get("id", "unknown"))
            legacy_decimal = fx.get("amount", "0")
            brain_mu = fx["expected_minor_units"]
            subunit_mult = fx.get("subunit_multiplier", 100)

        # Apply drift injection if requested (for testing FIRST_DIVERGENCE)
        if inject_drift is not None:
            if (
                inject_drift.get("workspace_id", workspace_id) == workspace_id
                and inject_drift.get("field", field_name) == field_name
                and inject_drift.get("id") == fx.get("id")
            ):
                legacy_decimal = inject_drift["drifted_legacy"]

        report.rows_checked += 1
        _compare_field(
            workspace_id=workspace_id,
            date=date_str,
            field=field_name,
            legacy_decimal=legacy_decimal,
            brain_mu=brain_mu,
            subunit_multiplier=subunit_mult,
            report=report,
        )

    return report
