"""C3 — Every workspace-scoped PG table has fail-closed RLS.
   C12 — No cross-service DB read (advisory until per-service GRANTs land).

C3: any table whose body declares a ``workspace_id`` column must have RLS enabled
AND a policy bound to ``current_setting('app.workspace_id'...)``. Documented
exceptions (system-scoped / k-anonymity tables) are allowlisted with a reason.
"""

from __future__ import annotations

import re

from _lib import (
    ROOT,
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
    "pii_purge_log": "system-scoped purge audit log; populated only by SECURITY DEFINER purge_closed_order_pii() (not rls_app); rls_app has SELECT-only; workspace_id is present for filtering, not tenancy isolation — multi-workspace rows are written per purge run (ADR-CONVERGENCE-001 ruling C, P0-A)",
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


# ---- C12: per-service DB isolation by GRANT (blocking after A4) -----------------
# Honest C12 = three signals: (1) the per-service role + grant artifacts EXIST and
# grant to the right svc_ role; (2) no MIS-GRANT (a service's grant file must not
# grant another service's tables); (3) no cross-service raw-SQL FROM in source.
_FOREIGN = {
    "intelligence-service": ["connector_order_facts", "workspace_costs", "customer_pii", "workspace_daily_metrics"],
    "core-service": ["ai.decision_log", "brand_fingerprint", "condition_outcome"],
}

# label -> (path, list of substrings that MUST be present)
_GRANT_ARTIFACTS = {
    "02-create-service-roles.sql": (
        "apps/core-service/docker/initdb-dev/02-create-service-roles.sql",
        ["svc_core", "svc_ingestion", "svc_intelligence", "svc_analytics_ro"],
    ),
    "26-grant-svc-roles.sql": (
        "apps/core-service/migrations/local-dev/26-grant-svc-roles.sql", ["TO svc_core"],
    ),
    "grant-svc-ingestion.sql": (
        "apps/ingestion-service/migrations/manual/raw/grant-svc-ingestion.sql", ["TO svc_ingestion"],
    ),
    "27-revoke-rls-app-overbroad.sql": (
        "apps/core-service/migrations/local-dev/27-revoke-rls-app-overbroad.sql", ["rls_app"],
    ),
    "intelligence up.sql (ai/memory grants)": (
        "apps/intelligence-service/migrations/postgres/up.sql", ["TO svc_intelligence"],
    ),
}


def check_c12() -> CheckResult:
    findings: list[str] = []

    # (1) grant artifacts exist + grant the right roles.
    for label, (relpath, needles) in _GRANT_ARTIFACTS.items():
        p = ROOT / relpath
        if not p.exists():
            findings.append(f"missing grant artifact: {label} ({relpath})")
            continue
        txt = read(p)
        for n in needles:
            if n not in txt:
                findings.append(f"{label}: missing expected `{n}`")

    # (2) no mis-grant — a service's grant file must not name another's tables.
    ing = ROOT / _GRANT_ARTIFACTS["grant-svc-ingestion.sql"][0]
    if ing.exists():
        it = strip_sql_comments(read(ing))
        for core_tbl in ("customer_pii", "connector_credentials", "connector_order_facts"):
            if re.search(rf"\b{core_tbl}\b", it):
                findings.append(f"grant-svc-ingestion.sql grants CORE table `{core_tbl}` (mis-grant)")
    core_g = ROOT / _GRANT_ARTIFACTS["26-grant-svc-roles.sql"][0]
    if core_g.exists():
        ct = strip_sql_comments(read(core_g))
        if re.search(r"\braw_[a-z]", ct) or re.search(r"\bconnector_identity_map\b", ct) or re.search(r"\bconnector_cursor\b", ct):
            findings.append("26-grant-svc-roles.sql grants an INGESTION table (raw_*/identity_map/cursor) to svc_core (mis-grant)")

    # (3) no cross-service raw-SQL FROM/JOIN in service source.
    for svc, foreign in _FOREIGN.items():
        for path in globs(f"apps/{svc}/src/**/*.py", f"apps/{svc}/src/**/*.ts"):
            text = read(path)
            for tbl in foreign:
                if re.search(rf"\bFROM\s+{re.escape(tbl)}\b|\bJOIN\s+{re.escape(tbl)}\b", text, re.I):
                    findings.append(f"{rel(path)} reads foreign table `{tbl}`")

    if findings:
        return CheckResult("C12", "Per-service DB isolation (grants)", Status.FAIL,
                           f"{len(findings)} isolation issue(s)", findings)
    return CheckResult("C12", "Per-service DB isolation (grants)", Status.PASS,
                       "per-service roles + grants present, correctly scoped (no mis-grant), no cross-service FROM")
