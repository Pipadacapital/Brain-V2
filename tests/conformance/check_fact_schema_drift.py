#!/usr/bin/env python3
"""Fact-schema drift gate (ADR-CONVERGENCE-001 P0-4, P0-A full-column hardening).

Static, DB-free CI check: for every connector fact in docs/schema/canonical-facts.yaml,
assert each store's DDL migration file(s) still DECLARE the canonical `must_columns`
(load-bearing money / join / partition columns the read path depends on).

P0-A hardening (epic-warehouse-medallion-wiring): the gate now also checks
`all_columns` for FULL-COLUMN parity — bidirectional check:
  1. Every column in `all_columns` appears in the DDL (registry → DDL direction).
  2. Every column declared in the DDL appears in `all_columns` (DDL → registry direction).

This catches:
  - A column dropped from the DDL without updating the registry (direction 1).
  - A column added to the DDL without registering it (direction 2) — this is the
    "writer column list vs DDL" invariant: if a writer adds a column but the registry
    doesn't know about it, the erasure manifest (P0-D) will miss it.

A column counts as "declared" if it appears as an identifier at the start of a
line in any of the fact's DDL files (CREATE TABLE column list or ALTER ... ADD
COLUMN). Heuristic but robust for these hand-written migrations, and zero-dep
beyond PyYAML. Exit 1 (with a per-fact drift report) on any missing column.

`must_columns` check: always run (for facts with no `all_columns`, this is the only check).
`all_columns` check: run when the fact spec includes `all_columns`. The bidirectional
  check is only as good as the `all_columns` list — if the list is wrong, the gate
  will report false positives. Keep the list in sync with the DDL.

Known DDL-columns exclusions: system columns that appear in SQL but are not table
  columns (CREATE, ENGINE, ORDER, PARTITION, SETTINGS, PRIMARY, ALTER, ADD, etc.).
"""
from __future__ import annotations

import re
import sys
from pathlib import Path

import yaml

REPO = Path(__file__).resolve().parents[2]
REGISTRY = REPO / "docs/schema/canonical-facts.yaml"

# SQL keywords that start a line but are NOT column names.
_SQL_KEYWORDS = {
    "create", "engine", "order", "partition", "settings", "primary",
    "alter", "add", "constraint", "references", "foreign", "unique",
    "index", "if", "not", "exists", "table", "view", "materialized",
    "with", "select", "from", "where", "and", "or", "on", "as",
    "insert", "update", "delete", "drop", "grant", "revoke",
    "comment", "cluster", "replicated", "codec",
}


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
                if kw not in _SQL_KEYWORDS:
                    cols.add(kw)
    return cols


def main() -> int:
    registry = yaml.safe_load(REGISTRY.read_text())
    drift = False
    print("Fact-schema drift gate — canonical columns vs per-store DDL\n")
    print("Mode: FULL-COLUMN (P0-A hardening) — bidirectional check when all_columns present\n")

    for fact, stores in registry["facts"].items():
        for store, spec in stores.items():
            declared = declared_columns(spec["ddl"])
            tag = f"{fact} [{store}:{spec['table']}]"

            # ---------------------------------------------------------------
            # 1. must_columns → DDL (existing check, always run)
            # ---------------------------------------------------------------
            missing_must = [c for c in spec["must_columns"] if c.lower() not in declared]
            if missing_must:
                drift = True
                print(f"  [DRIFT-MUST] {tag} — missing must_columns: {missing_must}")
            else:
                print(f"  [ok-must]   {tag} — {len(spec['must_columns'])} must_columns present")

            # ---------------------------------------------------------------
            # 2. all_columns bidirectional check (P0-A hardening)
            # ---------------------------------------------------------------
            if "all_columns" not in spec:
                print(f"  [WARN]      {tag} — no all_columns registered (P0-A requires full-column parity)")
                continue

            all_cols_registered = [c.lower() for c in spec["all_columns"]]
            all_cols_set = set(all_cols_registered)

            # Direction 1: registry → DDL (every registered column in DDL)
            missing_in_ddl = [c for c in all_cols_registered if c not in declared]
            if missing_in_ddl:
                drift = True
                print(f"  [DRIFT-FULL:R→D] {tag} — registry columns not in DDL: {missing_in_ddl}")
            else:
                print(f"  [ok-full:R→D]   {tag} — all {len(all_cols_registered)} registered columns in DDL")

            # Direction 2: DDL → registry (every DDL column in registry)
            # Filter out system/structural DDL keywords from the declared set.
            # Exclude columns that are in the DDL for OTHER tables in multi-table files
            # (we can't cleanly separate per-table columns from a multi-table file).
            # This direction is a WARNING (not a hard fail) for multi-table DDL files
            # because a DDL file may define multiple tables (e.g. 0007 has shipment +
            # refund + logistics). We report unregistered columns but only fail on
            # single-table DDL files.
            is_single_table_ddl = len(spec["ddl"]) == 1 and _is_single_table_file(
                REPO / spec["ddl"][0]
            )
            unregistered_in_registry = [
                c for c in declared
                if c not in all_cols_set and c not in _SQL_KEYWORDS
            ]
            if unregistered_in_registry:
                if is_single_table_ddl:
                    drift = True
                    print(
                        f"  [DRIFT-FULL:D→R] {tag} — DDL columns not in registry "
                        f"(single-table DDL: hard fail): {unregistered_in_registry}"
                    )
                else:
                    # Multi-table DDL: soft warning (columns may belong to other tables)
                    print(
                        f"  [WARN-FULL:D→R]  {tag} — DDL columns not in registry "
                        f"(multi-table DDL: soft warn, may be from other tables): "
                        f"{unregistered_in_registry}"
                    )
            else:
                print(f"  [ok-full:D→R]   {tag} — no unregistered DDL columns")

    print()
    if drift:
        print("RESULT: fact-schema DRIFT detected — a canonical column is missing from a store DDL.")
        return 1
    print("RESULT: no drift — every store DDL declares its canonical fact columns. (full-column gate)")
    return 0


def _is_single_table_file(path: Path) -> bool:
    """Returns True if the DDL file concerns only one table (one CREATE TABLE, no ALTERs on other tables).

    Used to determine whether the DDL→registry direction should be a hard fail
    (single-table DDL) or a soft warning (multi-table DDL file).

    A file with ALTER TABLE statements on columns is treated as multi-table because
    the declared_columns() heuristic picks up columns from ALL ALTER TABLE stmts,
    even those targeting tables OTHER than the registered fact table. The soft-warn
    path prevents false positives in multi-object migration files.
    """
    if not path.exists():
        return False
    content = path.read_text()
    create_table_count = len(re.findall(r'CREATE\s+TABLE\s', content, re.IGNORECASE))
    # Any ALTER TABLE ADD COLUMN in the file means other table schemas are modified here.
    has_alter_add = bool(re.search(r'ALTER\s+TABLE\s+\S+\s+ADD\s+COLUMN', content, re.IGNORECASE))
    return create_table_count == 1 and not has_alter_add


if __name__ == "__main__":
    sys.exit(main())
