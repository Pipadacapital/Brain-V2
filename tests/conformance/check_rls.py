"""C3 — Every workspace-scoped PG table has fail-closed RLS.
   C12 — No cross-service DB read (advisory until per-service GRANTs land).

C3: any table whose body declares a ``workspace_id`` column must have RLS enabled
AND a policy bound to ``current_setting('app.workspace_id'...)``. Documented
exceptions (system-scoped / k-anonymity tables) are allowlisted with a reason.
"""

from __future__ import annotations

import re

from _lib import (
    CheckResult,
    Status,
    extract_create_tables,
    globs,
    read,
    rel,
    strip_sql_comments,
)

# Brain-native OLTP migration DDL (excludes ClickHouse + legacy cutover runbooks).
_PG_GLOBS = (
    "apps/core-service/migrations/local-dev/*.sql",
    "apps/intelligence-service/migrations/postgres/*.sql",
    "apps/ingestion-service/migrations/manual/raw/*.sql",
    "apps/ingestion-service/migrations/manual/shop-map/*.sql",
)

# table -> reason RLS is intentionally absent (documented exceptions).
_ALLOWLIST = {
    "cross_brand_pattern": "k-anonymity cohort aggregate; no workspace_id, RLS intentionally absent",
    "connector_identity_map": "system-scoped pre-workspace lookup that PRODUCES workspace_id; RLS intentionally absent",
}

_ENABLE_RLS = re.compile(
    r"ALTER\s+TABLE\s+(?:IF\s+EXISTS\s+)?([\w.\"]+)\s+ENABLE\s+ROW\s+LEVEL\s+SECURITY", re.I
)
_POLICY_ON = re.compile(r"CREATE\s+POLICY\s+\w+\s+ON\s+([\w.\"]+)", re.I)
_WS_SETTING = re.compile(r"current_setting\(\s*'app\.workspace_id'", re.I)


def _norm(name: str) -> str:
    return name.strip('"').split(".")[-1].lower()


def check_c3() -> CheckResult:
    paths = globs(*_PG_GLOBS, exclude_prefixes=("down",))
    rls_tables: set[str] = set()
    ws_setting_seen = False
    ws_scoped: dict[str, str] = {}  # table -> file where defined

    for path in paths:
        sql = strip_sql_comments(read(path))
        for m in _ENABLE_RLS.finditer(sql):
            rls_tables.add(_norm(m.group(1)))
        for m in _POLICY_ON.finditer(sql):
            rls_tables.add(_norm(m.group(1)))
        if _WS_SETTING.search(sql):
            ws_setting_seen = True
        for name, body in extract_create_tables(sql):
            if re.search(r"\bworkspace_id\b", body):
                ws_scoped.setdefault(name, rel(path))

    if not ws_scoped:
        return CheckResult("C3", "Workspace-scoped PG tables have RLS", Status.FAIL,
                           "no workspace-scoped tables discovered (parser found nothing)")
    if not ws_setting_seen:
        return CheckResult("C3", "Workspace-scoped PG tables have RLS", Status.FAIL,
                           "no policy uses current_setting('app.workspace_id'...) — RLS not fail-closed")

    missing = [
        f"{tbl} (defined {src})"
        for tbl, src in sorted(ws_scoped.items())
        if tbl not in rls_tables and tbl not in _ALLOWLIST
    ]
    if missing:
        return CheckResult("C3", "Workspace-scoped PG tables have RLS", Status.FAIL,
                           f"{len(missing)} workspace-scoped table(s) lack RLS", missing)
    return CheckResult("C3", "Workspace-scoped PG tables have RLS", Status.PASS,
                       f"{len(ws_scoped)} workspace-scoped tables; all RLS-protected "
                       f"({len(_ALLOWLIST)} documented exceptions allowlisted)")


# ---- C12: cross-service DB read (advisory) -------------------------------------
# Heuristic: a Python service must not raw-SQL a table owned by another service.
_FOREIGN = {
    "intelligence-service": ["connector_order_facts", "workspace_costs", "customer_pii", "workspace_daily_metrics"],
    "core-service": ["ai.decision_log", "brand_fingerprint", "condition_outcome"],
}


def check_c12() -> CheckResult:
    hits: list[str] = []
    for svc, foreign in _FOREIGN.items():
        for path in globs(f"apps/{svc}/src/**/*.py", f"apps/{svc}/src/**/*.ts"):
            text = read(path)
            for tbl in foreign:
                if re.search(rf"\bFROM\s+{re.escape(tbl)}\b|\bJOIN\s+{re.escape(tbl)}\b", text, re.I):
                    hits.append(f"{rel(path)} references foreign table `{tbl}`")
    if hits:
        return CheckResult("C12", "No cross-service DB read (advisory)", Status.WARN,
                           "possible cross-schema reads (convention-enforced; hardens to GRANT at Phase A4)", hits)
    return CheckResult("C12", "No cross-service DB read (advisory)", Status.PASS,
                       "no cross-service raw-SQL table references found "
                       "(convention-enforced; hardens to per-service GRANT at Phase A4)")
