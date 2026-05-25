#!/usr/bin/env python3
# @paradigm: sql
# CI parity gate runner — Python side.
# Reads golden fixtures and outputs BIGINT conversion results as JSON.
# Invoked by tools/check-metrics-parity.sh for the byte-identity comparison.
# CF-QA-1.HARD.
#
# Child-4 extension (F3 carry-forward):
#   Also asserts expected_minor_units per fixture — the py_result must ALSO match the
#   declared `expected_minor_units` in the fixture. A fixture where py_result != expected_minor_units
#   is reported as an F3 violation (the declared expectation is wrong or the formula is wrong).
#   This catches fixtures that are internally consistent (TS==Python) but both wrong.
#
# Usage: python3 parity-runner.py <fixture_path>
# Output: JSON array of { id, py_result, expected_minor_units, f3_pass } — one per fixture vector.

from __future__ import annotations

import json
import sys
from pathlib import Path

# Add the pylibs directory to sys.path so we can import brain_metrics.
_REPO_ROOT = Path(__file__).parent.parent
_PYLIBS_PATH = _REPO_ROOT / "pylibs" / "brain_metrics"
if str(_PYLIBS_PATH) not in sys.path:
    sys.path.insert(0, str(_PYLIBS_PATH))

from brain_metrics.convert import decimal_to_minor_units


def main() -> None:
    if len(sys.argv) < 2:
        print("parity-runner.py: usage: python3 parity-runner.py <fixture_path>", file=sys.stderr)
        sys.exit(1)

    fixture_path = Path(sys.argv[1])
    if not fixture_path.exists():
        print(f"parity-runner.py: fixture not found: {fixture_path}", file=sys.stderr)
        sys.exit(1)

    with fixture_path.open("r", encoding="utf-8") as fh:
        raw = json.load(fh)

    results = []
    any_error = False
    f3_violations = 0

    for key, items in raw.items():
        if key.startswith("_"):
            continue
        if not isinstance(items, list):
            continue
        for item in items:
            if not isinstance(item, dict):
                continue
            if "amount" not in item or "expected_minor_units" not in item:
                continue

            fid = item.get("id", "unknown")
            amount = item["amount"]
            mult = item.get("subunit_multiplier", 100)
            expected_mu = item["expected_minor_units"]

            try:
                result = decimal_to_minor_units(amount, mult)
                # F3 carry-forward (Child-4): assert py_result == expected_minor_units.
                f3_pass = result == expected_mu
                if not f3_pass:
                    print(
                        f"parity-runner.py: F3 VIOLATION on fixture {fid!r}: "
                        f"py_result={result} != expected_minor_units={expected_mu} "
                        f"(amount={amount!r}, multiplier={mult})",
                        file=sys.stderr,
                    )
                    f3_violations += 1
                    any_error = True
                results.append({
                    "id": fid,
                    "py_result": str(result),
                    "expected_minor_units": expected_mu,
                    "f3_pass": f3_pass,
                })
            except Exception as e:
                print(f"parity-runner.py: ERROR on fixture {fid!r}: {e}", file=sys.stderr)
                any_error = True

    print(json.dumps(results, indent=2))

    if f3_violations > 0:
        print(
            f"parity-runner.py: {f3_violations} F3 violation(s): py_result != expected_minor_units. "
            "CF-C4-PARITY-SCOPE-1 / Child-2-F3.",
            file=sys.stderr,
        )

    if any_error:
        sys.exit(1)


if __name__ == "__main__":
    main()
