"""C1 — Money is integer minor-units (never float/NUMERIC).

Invariant: any column whose NAME denotes money (``*_mu``, ``*_minor`` or a money
noun) must be declared as an integer type (BIGINT / Int64 / INTEGER), never
NUMERIC / DECIMAL / REAL / FLOAT / DOUBLE / MONEY. Scans all PG + CH migration DDL.
"""

from __future__ import annotations

import re

from _lib import CheckResult, Status, globs, read, rel, strip_sql_comments

_MONEY_NAME = re.compile(
    r"(_mu|_minor)\b"
    r"|(revenue|cogs|gmv|spend|salary|payout|subtotal|gross_sales|net_sales"
    r"|unit_price|compare_at_price|grand_total|total_amount|amount_mu|fee_mu)",
    re.I,
)
_FORBIDDEN_TYPE = re.compile(
    r"^(numeric|decimal|dec|real|double|float\d*|money|smallmoney)$", re.I
)
# A column definition line: leading identifier + a type token.
_COL = re.compile(r"^\s*([a-z_][a-z0-9_]*)\s+([A-Za-z]+\d*)")

_MIGRATION_GLOBS = (
    "apps/*/migrations/**/*.sql",
)


def check_c1() -> CheckResult:
    violations: list[str] = []
    scanned = 0
    for path in globs(*_MIGRATION_GLOBS, exclude_prefixes=("down",)):
        scanned += 1
        for raw in strip_sql_comments(read(path)).splitlines():
            m = _COL.match(raw)
            if not m:
                continue
            col, typ = m.group(1), m.group(2)
            if _MONEY_NAME.search(col) and _FORBIDDEN_TYPE.match(typ):
                violations.append(f"{rel(path)}: `{col} {typ}` (money column must be integer minor-units)")
    if scanned == 0:
        return CheckResult("C1", "Money is integer minor-units", Status.FAIL,
                           "no migration files scanned (glob matched nothing)")
    if violations:
        return CheckResult("C1", "Money is integer minor-units", Status.FAIL,
                           f"{len(violations)} money column(s) use a float/decimal type",
                           violations)
    return CheckResult("C1", "Money is integer minor-units", Status.PASS,
                       f"{scanned} migration files; no money-named float/NUMERIC columns")
