"""C10 — Pagination is cursor-only (OFFSET banned in prod read paths).

Invariant: no production query path uses SQL ``OFFSET`` / ``.offset()`` — OFFSET
has an O(n) deep-page cliff. A small, TIME-BOXED set of admin browse tables is
allowlisted (each bounds OFFSET in code via ``boundedOffset`` / MAX_OFFSET) pending
keyset conversion — see docs/req-keyset-pagination-admin-tables.md. OFFSET in any
NON-allowlisted file fails the gate (the allowlist is non-vacuous).
"""

from __future__ import annotations

import re

from _lib import ROOT, CheckResult, Status, iter_lines, rel

# Match real SQL OFFSET (followed by a $param / number / :named bind) or a
# query-builder .offset(...) call — NOT the bare JS word "offset" (a loop var).
_OFFSET = re.compile(r"\bOFFSET\s+(\$|\d|:)|\.offset\s*\(", re.I)
_COMMENT = re.compile(r"^\s*(//|--|\*|#)")
_BAN_TALK = re.compile(r"BANNED|no\s+OFFSET|CF-API-CURSOR|cursor pagination", re.I)

# Time-boxed exception: repo-relative path -> justification. Each file bounds
# OFFSET <= MAX_OFFSET in code (deep pages return an empty "refine filters" page),
# so the unbounded cliff is removed today; full keyset conversion is tracked by
# req-keyset-pagination-admin-tables (expires before Scale-tier onboarding).
_ALLOWLIST = {
    "apps/core-service/src/application/contexts/store-browser/store-browser-use-cases.ts":
        "admin browse tables (orders/products/customers); OFFSET bounded by MAX_OFFSET",
    "apps/core-service/src/application/contexts/product-cogs/product-cogs-use-cases.ts":
        "COGS editor admin table; OFFSET bounded by MAX_OFFSET",
}
_EXPIRES_WITH = "req-keyset-pagination-admin-tables (gated before Scale-tier onboarding)"


def check_c10() -> CheckResult:
    paths = [ROOT / "apps" / "api-gateway" / "src", ROOT / "apps" / "core-service" / "src"]
    blocking: list[str] = []
    allowed_files: set[str] = set()
    allowed_hits = 0
    for path, lineno, line in iter_lines(paths, (".ts", ".py")):
        if "test" in path.name.lower() or ".test." in path.name:
            continue
        if not _OFFSET.search(line) or _COMMENT.match(line) or _BAN_TALK.search(line):
            continue
        relpath = rel(path)
        if relpath in _ALLOWLIST:
            allowed_files.add(relpath)
            allowed_hits += 1
        else:
            blocking.append(f"{relpath}:{lineno}: {line.strip()}")

    if blocking:
        return CheckResult("C10", "Pagination is cursor-only (OFFSET banned)", Status.FAIL,
                           f"{len(blocking)} OFFSET usage(s) in NON-allowlisted production paths", blocking)

    if allowed_hits:
        detail = (
            f"{allowed_hits} OFFSET site(s) across {len(allowed_files)} allowlisted admin-table "
            f"file(s), each bounded by MAX_OFFSET; expires with {_EXPIRES_WITH}"
        )
        return CheckResult("C10", "Pagination is cursor-only (OFFSET banned)", Status.PASS, detail,
                           [f"{f} — {_ALLOWLIST[f]}" for f in sorted(allowed_files)])

    return CheckResult("C10", "Pagination is cursor-only (OFFSET banned)", Status.PASS,
                       "no OFFSET usage in production read paths")
