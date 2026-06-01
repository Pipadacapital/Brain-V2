"""C11 — DDD-by-bounded-context layering (no technical-layer folders).

Invariant: services are organised by domain, never by technical layer. A
``controllers/`` / ``models/`` / ``managers/`` / ``helpers/`` directory under any
service ``src/`` is a code-review blocker.
"""

from __future__ import annotations

from _lib import ROOT, CheckResult, Status, rel

_BANNED_DIRS = {"controllers", "models", "managers", "helpers"}


def check_c11() -> CheckResult:
    apps = ROOT / "apps"
    violations: list[str] = []
    services = 0
    for svc in sorted(apps.iterdir()) if apps.is_dir() else []:
        src = svc / "src"
        if not src.is_dir():
            continue
        services += 1
        for d in src.rglob("*"):
            if d.is_dir() and d.name in _BANNED_DIRS and "node_modules" not in d.parts:
                violations.append(f"{rel(d)} (technical-layer folder; organise by bounded context)")
    if violations:
        return CheckResult("C11", "DDD layering (no technical-layer dirs)", Status.FAIL,
                           f"{len(violations)} banned technical-layer dir(s)", violations)
    return CheckResult("C11", "DDD layering (no technical-layer dirs)", Status.PASS,
                       f"{services} service src trees scanned; no controllers/models/managers/helpers dirs")
