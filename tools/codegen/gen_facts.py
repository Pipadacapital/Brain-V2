#!/usr/bin/env python3
"""gen_facts.py — Canonical-facts codegen (ADR-CONVERGENCE-001 C1, P1-A).

@paradigm: sql
Cost-routing: pure Python/YAML, zero LLM tokens, zero network calls.

Reads  docs/schema/canonical-facts.yaml  (single source of truth for all
connector-fact schemas) and emits FOUR generated artifacts plus the erasure
manifest consumed by the P0-D erasure orchestrator MV fan-out:

  1. tools/codegen/generated/ch_ddl_stubs.sql
     — per-table stub DDL comments that declare the canonical column order;
       acts as the machine-readable "should-look-like-this" reference that the
       CI drift gate diffs against the committed migrations.

  2. tools/codegen/generated/pg_ddl_stubs.sql
     — PG-side equivalents for the hot-mirror tables registered in the YAML.

  3. tools/codegen/generated/ts_row_builders.ts
     — TypeScript const-type row-builder interfaces, one per registered fact,
       for use in acl.ts / sync-use-cases.ts type-checked inserts.

  4. tools/codegen/generated/py_constants.py
     — Python tuple constants (COLUMNS, MUST_COLUMNS) imported by analytics
       query code — replaces inline column lists that drift silently.

  5. tools/codegen/generated/erasure_targets.json
     — Machine-readable manifest of every CH table + MV/projection that carries
       a customer_ref column and must be fanned out by the P0-D erasure
       orchestrator.  A CI gate (check_codegen_drift.py) asserts this file is
       always up-to-date.

Usage:
    python tools/codegen/gen_facts.py            # regenerate all artifacts
    python tools/codegen/gen_facts.py --check    # exit 1 if generated != committed

Exit code: 0 on success / no-drift; 1 on error or drift (with --check).

Flag: none — codegen is a build-time tool, not a runtime flag.
Rollback: generated artifacts are committed; reverting the YAML + re-running
  restores the previous state.
"""

from __future__ import annotations

import argparse
import difflib
import json
import sys
from pathlib import Path

import yaml

# ─────────────────────────────────────────────────────────────────────────────
# Paths
# ─────────────────────────────────────────────────────────────────────────────

_REPO = Path(__file__).resolve().parents[2]
_REGISTRY = _REPO / "docs/schema/canonical-facts.yaml"
_OUT = Path(__file__).resolve().parent / "generated"

_CH_DDL  = _OUT / "ch_ddl_stubs.sql"
_PG_DDL  = _OUT / "pg_ddl_stubs.sql"
_TS_ROW  = _OUT / "ts_row_builders.ts"
_PY_CONS = _OUT / "py_constants.py"
_ERASURE = _OUT / "erasure_targets.json"

# ─────────────────────────────────────────────────────────────────────────────
# CH type hints for TS/Py inference (LowCardinality → string, etc.)
# ─────────────────────────────────────────────────────────────────────────────

# Map of column-name suffixes / exact names to TS types for the row-builder.
# Falls back to `unknown` (keeps type-safety while being permissive).
_TS_TYPE_HINTS: dict[str, str] = {
    "workspace_id": "string",
    "vendor": "string",
    "vendor_order_id": "string",
    "vendor_line_id": "string",
    "vendor_product_id": "string | null",
    "vendor_variant_id": "string | null",
    "vendor_refund_id": "string",
    "vendor_refund_line_id": "string",
    "vendor_logistics_order_id": "string",
    "vendor_shipment_id": "string",
    "vendor_resource_id": "string",
    "customer_id": "string",
    "customer_ref": "string | null",
    "campaign_id": "string",
    "ad_account_id": "string",
    "ad_id": "string",
    "adset_id": "string | null",
    "source_type": "string",
    "channel": "string | null",
    "financial_status": "string | null",
    "fulfillment_status": "string | null",
    "payment_method": "string | null",
    "order_type": "string | null",
    "status": "string | null",
    "courier_name": "string | null",
    "currency_code": "string",
    "sku": "string | null",
    "title": "string | null",
    "handle": "string | null",
    "image_url": "string | null",
    "name": "string | null",
    "stage": "string",
    "delivery_pincode": "string | null",
    "delivery_city": "string | null",
    "delivery_state": "string | null",
    "billing_pincode": "string | null",
    "channel_name": "string | null",
    "channel_order_id": "string | null",
    "channel_id": "string | null",
    "provenance": "string | null",
    "tags": "string[]",
}


def _ts_type(col: str) -> str:
    """Best-guess TS type for a column name from the canonical registry."""
    if col in _TS_TYPE_HINTS:
        return _TS_TYPE_HINTS[col]
    if col.endswith("_mu"):
        return "bigint"
    if col.endswith("_bp") or col.endswith("_x100") or col.endswith("_x1000"):
        return "number | null"
    if col.endswith("_qty") or col == "quantity":
        return "number"
    if col.endswith("_at") or col.endswith("_date") or col == "date":
        return "Date | null"
    if col.startswith("is_") or col.startswith("has_"):
        return "boolean"
    if col in ("version",):
        return "bigint"
    if col in ("id",):
        return "string"
    if col in ("ingested_at", "synced_at", "order_date", "send_date"):
        return "Date | null"
    return "unknown"


# ─────────────────────────────────────────────────────────────────────────────
# Erasure-target logic: which tables carry customer_ref?
# ─────────────────────────────────────────────────────────────────────────────

# The erasure orchestrator (P0-D) issues ALTER DELETE WHERE workspace_id=? AND
# customer_ref=? on every CH silver table registered here.  A table qualifies
# if it appears in the YAML with `customer_ref` in its all_columns list.
# Bronze (connector_raw_events) is always included — it was given customer_ref
# in P0-B migration 0012.  MVs that materialise over an erasure-target table
# are listed so the fan-out covers them too.

# Static list of CH MVs derived from erasure-target tables (materialized views
# do NOT cascade ALTER DELETE — they must be listed explicitly).
_CH_MV_TARGETS: list[dict] = [
    {
        "table": "brain.workspace_daily_metrics_mv",
        "type": "materialized_view",
        "source": "brain.workspace_daily_metrics_base",
        "note": "MV over base — base does not carry customer_ref directly; "
                "included for completeness; erasure on source table suffices.",
        "has_customer_ref": False,
    },
]


def _build_erasure_targets(registry: dict) -> dict:
    """Build the erasure_targets manifest from the canonical registry.

    Returns a dict serialisable to JSON that the P0-D orchestrator reads.
    """
    targets: list[dict] = []

    # Bronze is always an erasure target (customer_ref added in P0-B / 0012).
    targets.append({
        "table": "brain.connector_raw_events",
        "type": "bronze",
        "store": "clickhouse",
        "customer_ref_column": "customer_ref",
        "workspace_id_column": "workspace_id",
        "key_columns": ["workspace_id", "customer_ref"],
        "erasure_mechanism": "ALTER TABLE brain.connector_raw_events DELETE "
                             "WHERE workspace_id={ws} AND customer_ref={ref}",
        "note": "Bronze append-only MergeTree. customer_ref added in P0-B (0012). "
                "Partition-scoped delete (PARTITION BY toYYYYMM(received_at)).",
    })

    # Silver CH tables that carry customer_ref.
    for fact_name, stores in registry.get("facts", {}).items():
        ch_spec = stores.get("ch")
        if not ch_spec:
            continue
        all_cols = [c.lower() for c in ch_spec.get("all_columns", [])]
        if "customer_ref" not in all_cols:
            continue
        table = f"brain.{ch_spec['table']}"
        targets.append({
            "table": table,
            "type": "silver_fact",
            "store": "clickhouse",
            "fact": fact_name,
            "customer_ref_column": "customer_ref",
            "workspace_id_column": "workspace_id",
            "key_columns": ["workspace_id", "customer_ref"],
            "erasure_mechanism": f"ALTER TABLE {table} DELETE "
                                 f"WHERE workspace_id={{ws}} AND customer_ref={{ref}}",
            "note": f"Silver fact table for {fact_name}.",
        })

        # PG hot-mirror for same fact (if registered).
        pg_spec = stores.get("pg")
        if pg_spec:
            all_pg_cols = [c.lower() for c in pg_spec.get("all_columns", [])]
            if "customer_ref" in all_pg_cols:
                pg_table = pg_spec["table"]
                targets.append({
                    "table": pg_table,
                    "type": "silver_fact_pg_mirror",
                    "store": "postgres",
                    "fact": fact_name,
                    "customer_ref_column": "customer_ref",
                    "workspace_id_column": "workspace_id",
                    "key_columns": ["workspace_id", "customer_ref"],
                    "erasure_mechanism": f"UPDATE {pg_table} SET customer_ref = '' "
                                        f"WHERE workspace_id={{ws}} AND customer_ref={{ref}}; "
                                        f"-- or DELETE per erasure policy",
                    "note": f"PG hot-mirror for {fact_name}.",
                })

    # Static CH MVs derived from erasure-target tables.
    for mv in _CH_MV_TARGETS:
        targets.append(mv)

    return {
        "_generated_by": "tools/codegen/gen_facts.py",
        "_source": "docs/schema/canonical-facts.yaml",
        "_note": (
            "Machine-readable manifest for the P0-D erasure orchestrator MV fan-out. "
            "Every CH table/MV carrying customer_ref must be registered here. "
            "CI gate (check_codegen_drift.py) enforces this file is always current. "
            "A new MV added without regenerating → CI fails."
        ),
        "targets": targets,
    }


# ─────────────────────────────────────────────────────────────────────────────
# CH DDL stubs generator
# ─────────────────────────────────────────────────────────────────────────────

def _gen_ch_ddl(registry: dict) -> str:
    lines: list[str] = [
        "-- GENERATED by tools/codegen/gen_facts.py — DO NOT EDIT BY HAND.",
        "-- Source: docs/schema/canonical-facts.yaml",
        "-- Purpose: canonical column-order reference for CH silver fact tables.",
        "--          The CI drift gate (check_codegen_drift.py) diffs this against",
        "--          the committed CH migrations to detect schema drift.",
        "-- @paradigm: sql",
        "",
    ]
    for fact_name, stores in registry.get("facts", {}).items():
        ch_spec = stores.get("ch")
        if not ch_spec:
            continue
        table = ch_spec["table"]
        all_cols = ch_spec.get("all_columns", ch_spec.get("must_columns", []))
        must_cols = set(c.lower() for c in ch_spec.get("must_columns", []))
        lines.append(f"-- ── {fact_name} [{table}] ──────────────────────────")
        lines.append(f"-- CANONICAL COLUMNS (order from registry):")
        for col in all_cols:
            mark = " -- MUST" if col.lower() in must_cols else ""
            lines.append(f"--   {col}{mark}")
        lines.append("")
    return "\n".join(lines)


# ─────────────────────────────────────────────────────────────────────────────
# PG DDL stubs generator
# ─────────────────────────────────────────────────────────────────────────────

def _gen_pg_ddl(registry: dict) -> str:
    lines: list[str] = [
        "-- GENERATED by tools/codegen/gen_facts.py — DO NOT EDIT BY HAND.",
        "-- Source: docs/schema/canonical-facts.yaml",
        "-- Purpose: canonical column-order reference for PG hot-mirror tables.",
        "-- @paradigm: sql",
        "",
    ]
    for fact_name, stores in registry.get("facts", {}).items():
        pg_spec = stores.get("pg")
        if not pg_spec:
            continue
        table = pg_spec["table"]
        all_cols = pg_spec.get("all_columns", pg_spec.get("must_columns", []))
        must_cols = set(c.lower() for c in pg_spec.get("must_columns", []))
        lines.append(f"-- ── {fact_name} [{table}] ──────────────────────────")
        lines.append(f"-- CANONICAL COLUMNS (order from registry):")
        for col in all_cols:
            mark = " -- MUST" if col.lower() in must_cols else ""
            lines.append(f"--   {col}{mark}")
        lines.append("")
    return "\n".join(lines)


# ─────────────────────────────────────────────────────────────────────────────
# TypeScript row-builder generator
# ─────────────────────────────────────────────────────────────────────────────

_TS_HEADER = """\
// GENERATED by tools/codegen/gen_facts.py — DO NOT EDIT BY HAND.
// Source: docs/schema/canonical-facts.yaml
// Purpose: typed row-builder interfaces for CH/PG fact inserts.
// @paradigm: sql  (zero LLM, zero network)
//
// Usage: import { ConnectorOrderFactsRow } from '@brain/codegen/facts';
//
// These interfaces are the canonical column contract between the ingest
// write path (acl.ts / sync-use-cases.ts) and the fact DDL. A column
// added to the DDL without updating canonical-facts.yaml will not appear
// here, causing a type error at the call site — making schema drift a
// compile-time failure rather than a runtime surprise.

"""


def _ts_interface_name(fact_name: str) -> str:
    """connector_order_facts → ConnectorOrderFactsRow"""
    parts = fact_name.split("_")
    return "".join(p.capitalize() for p in parts) + "Row"


def _gen_ts_row_builders(registry: dict) -> str:
    out = [_TS_HEADER]
    for fact_name, stores in registry.get("facts", {}).items():
        # Prefer CH spec for the authoritative column set; fall back to PG.
        spec = stores.get("ch") or stores.get("pg")
        if not spec:
            continue
        all_cols = spec.get("all_columns", spec.get("must_columns", []))
        must_cols = set(c.lower() for c in spec.get("must_columns", []))
        iface = _ts_interface_name(fact_name)
        out.append(f"/** Row type for brain.{spec.get('table', fact_name)} */")
        out.append(f"export interface {iface} {{")
        for col in all_cols:
            ts_type = _ts_type(col)
            required = col.lower() in must_cols
            optional = "" if required else "?"
            out.append(f"  {col}{optional}: {ts_type};")
        out.append("}")
        out.append("")
    return "\n".join(out)


# ─────────────────────────────────────────────────────────────────────────────
# Python constants generator
# ─────────────────────────────────────────────────────────────────────────────

_PY_HEADER = '''\
"""py_constants.py — GENERATED by tools/codegen/gen_facts.py — DO NOT EDIT.

Source: docs/schema/canonical-facts.yaml
Purpose: canonical column tuples for analytics query code.  Import these instead
         of maintaining inline column lists that drift silently.

@paradigm: sql  (zero LLM, zero network)
"""

from __future__ import annotations

'''


def _py_const_name(fact_name: str, suffix: str) -> str:
    """connector_order_facts + COLUMNS → CONNECTOR_ORDER_FACTS_COLUMNS"""
    return fact_name.upper() + "_" + suffix


def _gen_py_constants(registry: dict) -> str:
    lines = [_PY_HEADER]
    for fact_name, stores in registry.get("facts", {}).items():
        # Use CH spec as the primary column set; PG where CH absent.
        for store_name, spec in [("ch", stores.get("ch")), ("pg", stores.get("pg"))]:
            if not spec:
                continue
            all_cols = spec.get("all_columns", spec.get("must_columns", []))
            must_cols = spec.get("must_columns", [])
            store_tag = store_name.upper()
            all_name = _py_const_name(f"{fact_name}_{store_tag}", "COLUMNS")
            must_name = _py_const_name(f"{fact_name}_{store_tag}", "MUST_COLUMNS")
            lines.append(f"# {fact_name} — {spec.get('table', fact_name)} [{store_name}]")
            cols_repr = "(\n    " + "\n    ".join(f'"{c}",' for c in all_cols) + "\n)"
            must_repr = "(\n    " + "\n    ".join(f'"{c}",' for c in must_cols) + "\n)"
            lines.append(f"{all_name}: tuple[str, ...] = {cols_repr}")
            lines.append(f"{must_name}: tuple[str, ...] = {must_repr}")
            lines.append("")
    return "\n".join(lines)


# ─────────────────────────────────────────────────────────────────────────────
# Write / diff helpers
# ─────────────────────────────────────────────────────────────────────────────

def _write(path: Path, content: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(content, encoding="utf-8")


def _check_drift(path: Path, content: str) -> list[str]:
    """Return unified diff lines if committed content differs from generated."""
    if not path.exists():
        return [f"  MISSING: {path} — run gen_facts.py to generate it"]
    committed = path.read_text(encoding="utf-8")
    if committed == content:
        return []
    diff = list(difflib.unified_diff(
        committed.splitlines(keepends=True),
        content.splitlines(keepends=True),
        fromfile=f"committed/{path.name}",
        tofile=f"generated/{path.name}",
        n=3,
    ))
    return diff


# ─────────────────────────────────────────────────────────────────────────────
# Main
# ─────────────────────────────────────────────────────────────────────────────

def main() -> int:
    ap = argparse.ArgumentParser(
        description="Generate canonical-facts artifacts from docs/schema/canonical-facts.yaml"
    )
    ap.add_argument(
        "--check",
        action="store_true",
        help="Diff-only mode: exit 1 if generated content differs from committed files.",
    )
    args = ap.parse_args()

    if not _REGISTRY.exists():
        print(f"ERROR: canonical-facts.yaml not found at {_REGISTRY}")
        return 1

    registry = yaml.safe_load(_REGISTRY.read_text(encoding="utf-8"))

    # Build all artifacts in memory first.
    ch_ddl   = _gen_ch_ddl(registry)
    pg_ddl   = _gen_pg_ddl(registry)
    ts_rows  = _gen_ts_row_builders(registry)
    py_consts = _gen_py_constants(registry)
    erasure  = json.dumps(_build_erasure_targets(registry), indent=2, ensure_ascii=False) + "\n"

    artifacts: list[tuple[Path, str]] = [
        (_CH_DDL,  ch_ddl),
        (_PG_DDL,  pg_ddl),
        (_TS_ROW,  ts_rows),
        (_PY_CONS, py_consts),
        (_ERASURE, erasure),
    ]

    if args.check:
        # Diff mode — exit 1 if any artifact differs from committed.
        drift_found = False
        print("Codegen drift check — generated vs committed artifacts\n")
        for path, content in artifacts:
            diff_lines = _check_drift(path, content)
            if diff_lines:
                drift_found = True
                print(f"  [DRIFT] {path.relative_to(_REPO)}")
                for line in diff_lines[:30]:
                    print("   ", line, end="")
                if len(diff_lines) > 30:
                    print(f"\n   ... ({len(diff_lines) - 30} more diff lines)")
                print()
            else:
                print(f"  [ok]    {path.relative_to(_REPO)}")
        print()
        if drift_found:
            print("RESULT: codegen DRIFT — run `python tools/codegen/gen_facts.py` to regenerate.")
            return 1
        print("RESULT: no drift — all generated artifacts are current.")
        return 0
    else:
        # Write mode — regenerate all artifacts.
        for path, content in artifacts:
            _write(path, content)
            print(f"  wrote {path.relative_to(_REPO)}")
        print(f"\nAll {len(artifacts)} artifacts generated under tools/codegen/generated/")
        print("Commit the generated/ directory alongside any YAML changes.")
        return 0


if __name__ == "__main__":
    sys.exit(main())
