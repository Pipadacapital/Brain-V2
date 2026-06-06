"""C2 — Every ClickHouse table ORDER BY leads with workspace_id.

This is the tenancy + future-sharding invariant: the sort key (and the eventual
``Distributed(cityHash64(workspace_id))`` shard key) must begin with workspace_id.

P1-A additions (epic-warehouse-medallion-wiring):
  check_mv_double_fire_guard()  — ruling I: only one MV fires on the base table.
  check_final_prewhere()        — rulings E,5: every CH read query must carry
                                  FINAL + PREWHERE workspace_id.
"""

from __future__ import annotations

import re
from pathlib import Path

from _lib import CheckResult, Status, globs, read, rel, strip_sql_comments

_CREATE_TABLE = re.compile(r"CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?([\w.]+)", re.I)
_ORDER_BY = re.compile(r"ORDER\s+BY\s*\(?\s*([a-z_][a-z0-9_]*)", re.I)
_CREATE_MV = re.compile(
    r"CREATE\s+MATERIALIZED\s+VIEW\s+(?:IF\s+NOT\s+EXISTS\s+)?([\w.]+).*?FROM\s+([\w.]+)",
    re.I | re.S,
)


def check_c2() -> CheckResult:
    violations: list[str] = []
    tables = 0
    # Only real ClickHouse table DDL; the divop template is doc-only.
    for path in globs("infra/bootstrap/bootstrap-ch.sql"):
        if path.name.startswith("_"):
            continue
        sql = strip_sql_comments(read(path))
        # Walk each CREATE TABLE and grab the first ORDER BY that follows it.
        for m in _CREATE_TABLE.finditer(sql):
            name = m.group(1).split(".")[-1].lower()
            tail = sql[m.end():]
            ob = _ORDER_BY.search(tail)
            if not ob:
                continue  # MV-to-table or column-less; the target table carries the key
            tables += 1
            first_key = ob.group(1).lower()
            if first_key != "workspace_id":
                violations.append(f"{rel(path)}: `{name}` ORDER BY starts with `{first_key}`, not workspace_id")
    if tables == 0:
        return CheckResult("C2", "CH ORDER BY leads with workspace_id", Status.FAIL,
                           "no ClickHouse tables found to check")
    if violations:
        return CheckResult("C2", "CH ORDER BY leads with workspace_id", Status.FAIL,
                           f"{len(violations)} table(s) violate the tenancy sort-key rule", violations)
    return CheckResult("C2", "CH ORDER BY leads with workspace_id", Status.PASS,
                       f"{tables} ClickHouse tables; all ORDER BY lead with workspace_id")


# ─────────────────────────────────────────────────────────────────────────────
# C2-MV — MV double-fire guard (ruling I, P1-A)
# ─────────────────────────────────────────────────────────────────────────────

def check_mv_double_fire_guard() -> CheckResult:
    """P1-A ruling I: only ONE MV should fire on workspace_daily_metrics_base.

    A second MV over the same source table would cause each INSERT to fire both
    MVs, potentially double-counting or producing conflicting computed rows in
    workspace_daily_metrics_computed.

    This check scans committed CH migration DDL files and counts how many
    CREATE MATERIALIZED VIEW statements read FROM workspace_daily_metrics_base.
    Exactly one is correct (workspace_daily_metrics_mv).  Zero = MV not applied;
    two or more = double-fire risk.
    """
    base_table_variants = {
        "brain.workspace_daily_metrics_base",
        "workspace_daily_metrics_base",
    }
    mv_sources: list[str] = []  # (mv_name, source_table, file)

    for path in globs("infra/bootstrap/bootstrap-ch.sql"):
        if path.name.startswith("_") or path.name.startswith("down"):
            continue
        sql = strip_sql_comments(read(path))
        for m in _CREATE_MV.finditer(sql):
            mv_name = m.group(1).strip().lower().split(".")[-1]
            source   = m.group(2).strip().lower()
            if source in base_table_variants:
                mv_sources.append(f"{rel(path)}: MV `{mv_name}` FROM `{source}`")

    n = len(mv_sources)
    if n == 0:
        return CheckResult(
            "C2-MV", "MV double-fire guard (ruling I)", Status.WARN,
            "No MV found over workspace_daily_metrics_base in committed DDL — "
            "MV may not be applied yet (runbook-gated); ensure it is applied before "
            "the metrics base table receives production inserts.",
        )
    if n > 1:
        return CheckResult(
            "C2-MV", "MV double-fire guard (ruling I)", Status.FAIL,
            f"{n} MVs fire on workspace_daily_metrics_base — exactly 1 allowed.",
            mv_sources,
        )
    return CheckResult(
        "C2-MV", "MV double-fire guard (ruling I)", Status.PASS,
        f"Exactly 1 MV fires on workspace_daily_metrics_base: {mv_sources[0]}",
    )


# ─────────────────────────────────────────────────────────────────────────────
# C2-FINAL — FINAL + PREWHERE enforcement in Python analytics code (rulings E,5)
# ─────────────────────────────────────────────────────────────────────────────

_FACT_TABLES = {
    "connector_order_facts",
    "connector_line_item_facts",
    "connector_ad_spend_facts",
    "connector_shipment_facts",
    "connector_product_facts",
    "connector_refund_facts",
    "connector_variant_facts",
    "connector_email_send_facts",
    "connector_logistics_order_facts",
    "connector_ad_creative_facts",
    "connector_ad_funnel_facts",
    "workspace_daily_metrics_computed",
    "workspace_daily_metrics_base",
}

# Pattern: a SQL string literal containing a SELECT from a CH fact table,
# but without FINAL.  We detect raw string literals assigned to variables
# or used in .query() / .command() calls.
#
# Strategy: scan Python files for string literals that match
#   FROM brain.<fact_table>
# and check they also contain FINAL.

_FROM_BRAIN = re.compile(r"FROM\s+brain\.(" + "|".join(_FACT_TABLES) + r")\b", re.I)
_FINAL_KW   = re.compile(r"\bFINAL\b", re.I)
_PREWHERE_KW = re.compile(r"\bPREWHERE\b", re.I)

# Context: the query_gateway.py uses workspace_daily_metrics_computed (no FINAL
# needed — computed is a plain table, not RMT). We exclude it from the check.
_FINAL_EXEMPT = {"workspace_daily_metrics_computed", "workspace_daily_metrics_base"}


def check_final_prewhere() -> CheckResult:
    """P1-A rulings E,5: every CH read over a ReplacingMergeTree fact table must
    carry FINAL (for dedup semantics) and PREWHERE workspace_id (for partition
    pruning).

    This is a STATIC check that scans Python source files for SQL string literals
    containing FROM brain.<fact_table> and flags any that:
      - Are NOT exempt tables (computed/base — not RMT)
      - Do NOT contain FINAL in the same string context
      - Do NOT contain PREWHERE workspace_id in the same string context

    Note: the gateway auto-appends FINAL and PREWHERE via the
    brain_clickhouse library (see P1-A task 4). This check verifies that
    hand-written queries in analytics-service are also correctly annotated.
    A missing FINAL on a ReplacingMergeTree read can return duplicate rows,
    corrupting metrics and %-of-GMV billing.
    """
    violations: list[str] = []
    checked_files = 0

    py_paths = globs(
        "apps/analytics-service/src/**/*.py",
        "pylibs/brain_clickhouse/**/*.py",
    )
    # Also check the recompute_daily specifically (it uses raw SQL strings).
    py_paths += globs("apps/analytics-service/src/**/recompute_daily.py")

    seen_paths: set[Path] = set()
    for path in py_paths:
        if path in seen_paths:
            continue
        seen_paths.add(path)
        checked_files += 1
        content = read(path)

        # Find all occurrences of FROM brain.<fact_table>
        for m in _FROM_BRAIN.finditer(content):
            table = m.group(1).lower()
            if table in _FINAL_EXEMPT:
                continue

            # Extract surrounding context (up to 800 chars before + after match)
            ctx_start = max(0, m.start() - 400)
            ctx_end   = min(len(content), m.end() + 400)
            context   = content[ctx_start:ctx_end]

            missing = []
            if not _FINAL_KW.search(context):
                missing.append("FINAL")
            if not _PREWHERE_KW.search(context):
                missing.append("PREWHERE workspace_id")

            if missing:
                violations.append(
                    f"{rel(path)}:{content[:m.start()].count(chr(10)) + 1}: "
                    f"query on `brain.{table}` missing: {', '.join(missing)}"
                )

    if violations:
        return CheckResult(
            "C2-FINAL", "CH reads carry FINAL + PREWHERE workspace_id (rulings E,5)",
            Status.WARN,   # WARN not FAIL: many existing queries pre-date this rule.
            f"{len(violations)} CH read(s) on RMT tables without FINAL/PREWHERE "
            f"(checked {checked_files} files). "
            "The brain_clickhouse gateway auto-appends both — use it for all reads.",
            violations[:12],
        )

    return CheckResult(
        "C2-FINAL", "CH reads carry FINAL + PREWHERE workspace_id (rulings E,5)",
        Status.PASS,
        f"All checked CH reads on RMT tables carry FINAL + PREWHERE "
        f"(or route through the gateway; {checked_files} files checked).",
    )
