#!/usr/bin/env python3
"""Fact-schema drift gate (ADR-CONVERGENCE-001 P0-4).

Static, DB-free CI check: for every connector fact in docs/schema/canonical-facts.yaml,
assert each store's DDL migration file(s) still DECLARE the canonical `must_columns`
(load-bearing money / join / partition columns the read path depends on).

This catches the class of regression that shipped to prod here: the line-item
`vendor_product_id` join key was dropped (zeroing COGS/CM1 and 500ing pages), and
the PG/CH money columns drifted in name. The PG hot-mirror is intentionally a
SUBSET of the CH fact, so we check each store against ITS declared projection
rather than asserting PG == CH.

A column counts as "declared" if it appears as an identifier at the start of a
line in any of the fact's DDL files (CREATE TABLE column list or ALTER ... ADD
COLUMN). Heuristic but robust for these hand-written migrations, and zero-dep
beyond PyYAML. Exit 1 (with a per-fact drift report) on any missing column.
"""
from __future__ import annotations

import re
import sys
from pathlib import Path

import yaml

REPO = Path(__file__).resolve().parents[2]
REGISTRY = REPO / "docs/schema/canonical-facts.yaml"


def declared_columns(ddl_files: list[str]) -> set[str]:
    """Column identifiers declared across the given DDL files."""
    cols: set[str] = set()
    # `col_name TYPE...` (CREATE column list, optionally backtick/quoted) or
    # `ADD COLUMN [IF NOT EXISTS] col_name ...`.
    col_line = re.compile(r'^\s*[`"]?([a-z_][a-z0-9_]*)[`"]?\s+\S', re.IGNORECASE)
    add_col = re.compile(r'ADD\s+COLUMN\s+(?:IF\s+NOT\s+EXISTS\s+)?[`"]?([a-z_][a-z0-9_]*)', re.IGNORECASE)
    for rel in ddl_files:
        path = REPO / rel
        if not path.exists():
            print(f"  ! DDL file not found: {rel}")
            continue
        for line in path.read_text().splitlines():
            m = add_col.search(line)
            if m:
                cols.add(m.group(1).lower())
                continue
            m = col_line.match(line)
            if m:
                kw = m.group(1).lower()
                if kw not in {"create", "engine", "order", "partition", "settings", "primary",
                              "alter", "add", "constraint", "references", "foreign", "unique", "index"}:
                    cols.add(kw)
    return cols


def main() -> int:
    registry = yaml.safe_load(REGISTRY.read_text())
    drift = False
    print("Fact-schema drift gate — canonical columns vs per-store DDL\n")
    for fact, stores in registry["facts"].items():
        for store, spec in stores.items():
            declared = declared_columns(spec["ddl"])
            missing = [c for c in spec["must_columns"] if c.lower() not in declared]
            tag = f"{fact} [{store}:{spec['table']}]"
            if missing:
                drift = True
                print(f"  [DRIFT] {tag} — missing canonical columns: {missing}")
            else:
                print(f"  [ok]    {tag} — {len(spec['must_columns'])} canonical columns present")
    print()
    if drift:
        print("RESULT: fact-schema DRIFT detected — a canonical column is missing from a store DDL.")
        return 1
    print("RESULT: no drift — every store DDL declares its canonical fact columns. ✔")
    return 0


if __name__ == "__main__":
    sys.exit(main())
