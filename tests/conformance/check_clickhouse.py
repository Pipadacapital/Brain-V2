"""C2 — Every ClickHouse table ORDER BY leads with workspace_id.

This is the tenancy + future-sharding invariant: the sort key (and the eventual
``Distributed(cityHash64(workspace_id))`` shard key) must begin with workspace_id.
"""

from __future__ import annotations

import re

from _lib import CheckResult, Status, globs, read, rel, strip_sql_comments

_CREATE_TABLE = re.compile(r"CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?([\w.]+)", re.I)
_ORDER_BY = re.compile(r"ORDER\s+BY\s*\(?\s*([a-z_][a-z0-9_]*)", re.I)


def check_c2() -> CheckResult:
    violations: list[str] = []
    tables = 0
    # Only real ClickHouse table DDL; the divop template is doc-only.
    for path in globs("apps/analytics-service/migrations/clickhouse/*.sql"):
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
