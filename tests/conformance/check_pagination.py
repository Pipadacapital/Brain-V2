"""C10 — Pagination is cursor-only (OFFSET banned in prod read paths).

Invariant: no production query path uses OFFSET / .offset() — OFFSET has an O(n)
deep-page cliff. Comments that merely mention the ban are not violations.
"""

from __future__ import annotations

import re

from _lib import ROOT, CheckResult, Status, iter_lines, rel

_OFFSET = re.compile(r"\bOFFSET\b|\.offset\s*\(", re.I)
_COMMENT = re.compile(r"^\s*(//|--|\*|#)")
# Lines that talk about the ban rather than use OFFSET.
_BAN_TALK = re.compile(r"BANNED|no\s+OFFSET|CF-API-CURSOR|cursor pagination", re.I)


def check_c10() -> CheckResult:
    paths = [ROOT / "apps" / "api-gateway" / "src", ROOT / "apps" / "core-service" / "src"]
    violations: list[str] = []
    for path, lineno, line in iter_lines(paths, (".ts", ".py")):
        if "test" in path.name.lower() or ".test." in path.name:
            continue
        if not _OFFSET.search(line):
            continue
        if _COMMENT.match(line) or _BAN_TALK.search(line):
            continue
        violations.append(f"{rel(path)}:{lineno}: {line.strip()}")
    if violations:
        return CheckResult("C10", "Pagination is cursor-only (OFFSET banned)", Status.FAIL,
                           f"{len(violations)} OFFSET usage(s) in production read paths", violations)
    return CheckResult("C10", "Pagination is cursor-only (OFFSET banned)", Status.PASS,
                       "no OFFSET usage in production read paths")
