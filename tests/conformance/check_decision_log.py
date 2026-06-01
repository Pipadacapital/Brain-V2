"""C6 — ai.decision_log is append-only.
   C7 — ai.decision_log has the idempotency unique key.

C6: a BEFORE UPDATE trigger must exist that raises (the "a workflow that cannot
write here is not a Brain action" ledger must never be mutated in place).
C7: a UNIQUE index on (workspace_id, agent_id, input_hash) — dedup anchor.
"""

from __future__ import annotations

import re

from _lib import CheckResult, Status, globs, read, rel, strip_sql_comments

_DECISION_LOG_MIGRATION = "apps/intelligence-service/migrations/postgres/up.sql"


def _decision_log_sql() -> tuple[str, str] | None:
    found = globs(_DECISION_LOG_MIGRATION)
    if not found:
        return None
    return strip_sql_comments(read(found[0])), rel(found[0])


def check_c6() -> CheckResult:
    res = _decision_log_sql()
    if res is None:
        return CheckResult("C6", "decision_log is append-only", Status.FAIL,
                           f"migration not found: {_DECISION_LOG_MIGRATION}")
    sql, src = res
    has_trigger = re.search(
        r"CREATE\s+TRIGGER\s+\w+\s+BEFORE\s+UPDATE\s+ON\s+ai\.decision_log", sql, re.I
    )
    raises = re.search(r"RAISE\b", sql, re.I)
    if has_trigger and raises:
        return CheckResult("C6", "decision_log is append-only", Status.PASS,
                           f"{src}: BEFORE UPDATE trigger present and raises")
    return CheckResult("C6", "decision_log is append-only", Status.FAIL,
                       f"{src}: missing BEFORE UPDATE trigger or RAISE guard",
                       [f"trigger={bool(has_trigger)} raise={bool(raises)}"])


def check_c7() -> CheckResult:
    res = _decision_log_sql()
    if res is None:
        return CheckResult("C7", "decision_log idempotency key", Status.FAIL,
                           f"migration not found: {_DECISION_LOG_MIGRATION}")
    sql, src = res
    # UNIQUE INDEX ... ON ai.decision_log (workspace_id, agent_id, input_hash)
    idx = re.search(
        r"CREATE\s+UNIQUE\s+INDEX[^;]*ON\s+ai\.decision_log\s*\(\s*workspace_id\s*,\s*agent_id\s*,\s*input_hash\s*\)",
        sql, re.I,
    )
    if idx:
        return CheckResult("C7", "decision_log idempotency key", Status.PASS,
                           f"{src}: UNIQUE (workspace_id, agent_id, input_hash)")
    return CheckResult("C7", "decision_log idempotency key", Status.FAIL,
                       f"{src}: missing UNIQUE idempotency index on decision_log")
