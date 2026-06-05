#!/usr/bin/env python3
"""check_codegen_drift.py — Codegen drift CI gate (P1-A, ADR-CONVERGENCE-001 C1).

@paradigm: sql
Cost-routing: pure Python/YAML diffing, zero LLM tokens, zero network.

Fails (exit 1) if the generated artifacts under tools/codegen/generated/
differ from what `gen_facts.py` would produce from the current
docs/schema/canonical-facts.yaml.  This is the invariant:

  "Committed generated artifacts are always in sync with the YAML registry."

A PR that edits canonical-facts.yaml WITHOUT running gen_facts.py will be
caught here.  A PR that edits the DDL without updating the YAML will be caught
by check_fact_schema_drift.py (the separate full-column-parity gate).

Usage:
    python tools/ci/check_codegen_drift.py    # exit 0 = clean, exit 1 = drift

This script is a thin wrapper that invokes gen_facts.py --check and surfaces
its output in CI-friendly format.  It also asserts that the erasure_targets
manifest is present and well-formed (non-empty targets list), catching the
silent case where a CH MV is added but never registered.
"""

from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path

_REPO = Path(__file__).resolve().parents[2]
_GEN_FACTS = _REPO / "tools/codegen/gen_facts.py"
_ERASURE_JSON = _REPO / "tools/codegen/generated/erasure_targets.json"


def _check_erasure_manifest() -> list[str]:
    """Assert erasure_targets.json is present, parseable, and non-empty."""
    issues: list[str] = []
    if not _ERASURE_JSON.exists():
        issues.append(
            f"erasure_targets.json not found at {_ERASURE_JSON.relative_to(_REPO)}. "
            "Run gen_facts.py to generate it."
        )
        return issues

    try:
        manifest = json.loads(_ERASURE_JSON.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        issues.append(f"erasure_targets.json is not valid JSON: {exc}")
        return issues

    targets = manifest.get("targets", [])
    if not targets:
        issues.append(
            "erasure_targets.json has an empty 'targets' list. "
            "At minimum, brain.connector_raw_events (bronze) must be registered. "
            "A new MV added without registration is a silent non-compliance gap — "
            "run gen_facts.py to regenerate."
        )
        return issues

    # Assert bronze is always present.
    bronze_tables = [t["table"] for t in targets if t.get("type") == "bronze"]
    if "brain.connector_raw_events" not in bronze_tables:
        issues.append(
            "brain.connector_raw_events (bronze) is NOT in erasure_targets — "
            "this table always carries customer_ref (0012). "
            "Run gen_facts.py to regenerate."
        )

    # Assert connector_order_facts (the primary silver table) is present.
    silver_tables = [t["table"] for t in targets if t.get("type") == "silver_fact"]
    if "brain.connector_order_facts" not in silver_tables:
        issues.append(
            "brain.connector_order_facts is NOT in erasure_targets as a silver_fact — "
            "it carries customer_ref and must be included. "
            "Run gen_facts.py to regenerate."
        )

    return issues


def main() -> int:
    print("Codegen drift CI gate — canonical-facts.yaml → generated artifacts\n")

    # Step 1: run gen_facts.py --check (the real diff engine).
    result = subprocess.run(
        [sys.executable, str(_GEN_FACTS), "--check"],
        capture_output=False,   # let output flow through for CI logs
    )
    codegen_ok = result.returncode == 0

    # Step 2: structural assertion on erasure_targets.json.
    print("\nErasure-manifest structural assertions:")
    erasure_issues = _check_erasure_manifest()
    if erasure_issues:
        for issue in erasure_issues:
            print(f"  [FAIL] {issue}")
    else:
        manifest = json.loads(_ERASURE_JSON.read_text(encoding="utf-8"))
        n_ch  = sum(1 for t in manifest["targets"] if t.get("store") == "clickhouse")
        n_pg  = sum(1 for t in manifest["targets"] if t.get("store") == "postgres")
        n_mv  = sum(1 for t in manifest["targets"] if t.get("type") == "materialized_view")
        print(
            f"  [ok]   {len(manifest['targets'])} registered targets "
            f"({n_ch} CH, {n_pg} PG, {n_mv} MVs)"
        )

    print()
    if not codegen_ok or erasure_issues:
        print(
            "RESULT: codegen drift DETECTED — regenerate artifacts with:\n"
            "    python tools/codegen/gen_facts.py\n"
            "Then commit the updated tools/codegen/generated/ files."
        )
        return 1

    print("RESULT: no codegen drift — generated artifacts are in sync with the registry.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
