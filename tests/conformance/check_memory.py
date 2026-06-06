"""C13 — Memory cross-brand k-anonymity (brand_count >= 5).
   C14 — Single pgvector opclass repo-wide + decision_log correlation quad.

C14 directly prevents the l2-vs-cosine landmine (two contradictory HNSW index
definitions) from ever reappearing, and asserts the trace quad is persisted.
"""

from __future__ import annotations

import re

from _lib import CheckResult, Status, globs, read, rel, strip_sql_comments

_DECISION_LOG_MIGRATION = "infra/bootstrap/bootstrap-pg-ai.sql"
_HNSW = re.compile(r"USING\s+hnsw\s*\(\s*\w+\s+(vector_\w+_ops)\s*\)", re.I)


def check_c13() -> CheckResult:
    for path in globs(_DECISION_LOG_MIGRATION):
        sql = strip_sql_comments(read(path))
        if re.search(r"brand_count\s+\w+\s+NOT\s+NULL\s+CHECK\s*\(\s*brand_count\s*>=\s*5\s*\)", sql, re.I) \
           or re.search(r"CHECK\s*\(\s*brand_count\s*>=\s*5\s*\)", sql, re.I):
            return CheckResult("C13", "Cross-brand k-anonymity (k>=5)", Status.PASS,
                               f"{rel(path)}: CHECK (brand_count >= 5) present")
    return CheckResult("C13", "Cross-brand k-anonymity (k>=5)", Status.FAIL,
                       "no CHECK (brand_count >= 5) found on cross_brand_pattern")


def check_c14() -> CheckResult:
    # (a) exactly one HNSW opclass definition repo-wide.
    opclasses: list[str] = []
    for path in globs("infra/bootstrap/bootstrap-pg-ai.sql"):
        for m in _HNSW.finditer(strip_sql_comments(read(path))):
            opclasses.append(f"{rel(path)}: {m.group(1)}")
    if len(opclasses) != 1:
        return CheckResult("C14", "Single pgvector opclass + correlation quad", Status.FAIL,
                           f"expected exactly 1 HNSW opclass definition, found {len(opclasses)} "
                           "(distance-metric divergence is a correctness landmine)", opclasses)
    if "vector_cosine_ops" not in opclasses[0]:
        return CheckResult("C14", "Single pgvector opclass + correlation quad", Status.FAIL,
                           "the single HNSW opclass is not vector_cosine_ops", opclasses)

    # (b) decision_log carries the correlation quad.
    dl = globs(_DECISION_LOG_MIGRATION)
    if not dl:
        return CheckResult("C14", "Single pgvector opclass + correlation quad", Status.FAIL,
                           f"migration not found: {_DECISION_LOG_MIGRATION}")
    sql = strip_sql_comments(read(dl[0]))
    quad = ["request_id", "trace_id", "workspace_id", "actor_id"]
    missing = [c for c in quad if not re.search(rf"\b{c}\b", sql)]
    if missing:
        return CheckResult("C14", "Single pgvector opclass + correlation quad", Status.FAIL,
                           f"decision_log missing correlation columns: {missing}")
    return CheckResult("C14", "Single pgvector opclass + correlation quad", Status.PASS,
                       f"single opclass ({opclasses[0]}); decision_log carries the trace quad")
