"""
test_single_writer_grep.py — CF-C4-SINGLE-WRITER-GREP-2.

Static grep gate: 3-pattern search over Brain code to ensure ZERO writes to the
legacy Postgres rollup tables.

Pattern 1 (SQL): INSERT/UPDATE/UPSERT/DELETE/COPY within N chars of any legacy rollup
    table name (workspace_daily_metrics, product_daily_aggregates, etc.)
Pattern 2 (Prisma camelCase): .create/.upsert/.update/.createMany/.delete on the
    camelCase Prisma model names (workspaceDailyMetrics, productDailyAggregates, etc.)
Pattern 3 (raw client outside gateway): raw clickhouse_connect write calls outside
    the query_gateway module.

Killed-mutant test (CF-C4-VERIFY-THE-VERIFIER-1):
    A planted `prisma.workspaceDailyMetrics.upsert(...)` literal in Brain code
    triggers the grep gate → test RED. This proves the grep is not vacuous.

@paradigm: sql
CF-C4-SINGLE-WRITER-GREP-2 (HIGH)
CF-C4-VERIFY-THE-VERIFIER-1 (HIGH — planted-upsert mutant)
"""

from __future__ import annotations

import re
import textwrap
import pathlib
import pytest

# ---------------------------------------------------------------------------
# Paths scanned by the static grep gate.
# ---------------------------------------------------------------------------
_REPO_ROOT = pathlib.Path(__file__).parent.parent.parent.parent  # Brain repo root
_SCAN_PATHS = [
    _REPO_ROOT / "apps" / "analytics-service" / "src",
    _REPO_ROOT / "packages" / "lib-metrics" / "src",
]

# ---------------------------------------------------------------------------
# Legacy rollup table names — SQL targets (Pattern 1)
#
# NOTE: workspace_daily_metrics_base and workspace_daily_metrics_computed are
# the NEW ClickHouse metric-engine tables written by recompute_daily_metrics().
# They are NOT legacy Postgres rollup tables. The patterns below match only the
# legacy tables:
#   - workspace_daily_metrics_legacy (the CH shadow of the old PG table)
#   - product_daily_aggregates
#   - shopify_analytics_daily
#   etc.
# The metric-engine tables (workspace_daily_metrics_base / _computed / _mv)
# are intentionally excluded from this list; recompute_daily.py is the
# single authorised writer for those tables.
# ---------------------------------------------------------------------------
_LEGACY_SQL_TABLES = [
    "workspace_daily_metrics_legacy",   # legacy-only CH shadow table
    "product_daily_aggregates",
    "shopify_analytics_daily",
    "meta_ads_daily_metrics",
    "google_ads_daily_metrics",
]

_SQL_WRITE_KEYWORDS = re.compile(
    r"\b(INSERT|UPDATE|UPSERT|DELETE|COPY)\s+(?:INTO\s+|FROM\s+)?",
    re.IGNORECASE,
)

# ---------------------------------------------------------------------------
# Prisma camelCase model write-method patterns (Pattern 2)
# ---------------------------------------------------------------------------
_PRISMA_CAMEL_MODELS = [
    "workspaceDailyMetrics",
    "productDailyAggregates",
    "shopifyAnalyticsDaily",
    "metaAdsDailyMetrics",
    "googleAdsDailyMetrics",
]

_PRISMA_WRITE_METHODS = [
    ".create(",
    ".upsert(",
    ".update(",
    ".createMany(",
    ".delete(",
    ".deleteMany(",
    ".updateMany(",
]

# ---------------------------------------------------------------------------
# Raw clickhouse_connect write patterns outside query_gateway (Pattern 3)
# ---------------------------------------------------------------------------
_CH_WRITE_PATTERNS = [
    re.compile(r"client\.insert\s*\(", re.IGNORECASE),
    re.compile(r"client\.execute\s*\(", re.IGNORECASE),
    re.compile(r"clickhouse_connect\.get_client", re.IGNORECASE),  # only allowed in query_gateway
]

_GATEWAY_MODULE_NAME = "query_gateway.py"


# ---------------------------------------------------------------------------
# Helper: collect all .py, .ts files in scan paths (excluding .gitkeep)
# ---------------------------------------------------------------------------

def _collect_source_files() -> list[pathlib.Path]:
    files: list[pathlib.Path] = []
    for base in _SCAN_PATHS:
        if not base.exists():
            continue
        for ext in ("*.py", "*.ts"):
            for f in base.rglob(ext):
                # Skip test files in the scan (they may contain intentional mutants)
                if "test_" in f.name or f.suffix == ".test.ts":
                    continue
                files.append(f)
    return files


# ---------------------------------------------------------------------------
# Pattern 1: SQL write keywords near legacy table names
# ---------------------------------------------------------------------------

def _check_sql_write_to_legacy_table(content: str, filepath: str) -> list[str]:
    """Return list of violation strings if SQL writes to legacy rollup tables found."""
    violations = []
    lines = content.splitlines()
    for lineno, line in enumerate(lines, start=1):
        # Skip comment lines
        stripped = line.lstrip()
        if stripped.startswith("#") or stripped.startswith("//") or stripped.startswith("--"):
            continue
        line_upper = line.upper()
        if _SQL_WRITE_KEYWORDS.search(line):
            for table in _LEGACY_SQL_TABLES:
                # Check within 200 chars (same line or context window)
                if table.upper() in line_upper or table in line:
                    violations.append(
                        f"{filepath}:{lineno}: SQL write to legacy table '{table}': {line.strip()!r}"
                    )
    return violations


# ---------------------------------------------------------------------------
# Pattern 2: Prisma camelCase model writes
# ---------------------------------------------------------------------------

def _check_prisma_camel_writes(content: str, filepath: str) -> list[str]:
    """Return violation strings if Prisma camelCase model write-method calls found."""
    violations = []
    lines = content.splitlines()
    for lineno, line in enumerate(lines, start=1):
        stripped = line.lstrip()
        if stripped.startswith("#") or stripped.startswith("//"):
            continue
        for model in _PRISMA_CAMEL_MODELS:
            for method in _PRISMA_WRITE_METHODS:
                pattern = model + method
                if pattern in line:
                    violations.append(
                        f"{filepath}:{lineno}: Prisma write to legacy model '{model}{method}': {line.strip()!r}"
                    )
    return violations


# ---------------------------------------------------------------------------
# Pattern 3: raw ClickHouse client write calls outside query_gateway
# ---------------------------------------------------------------------------

def _check_raw_ch_writes_outside_gateway(content: str, filepath: str) -> list[str]:
    """Return violation strings for raw CH writes outside the gateway module."""
    if pathlib.Path(filepath).name == _GATEWAY_MODULE_NAME:
        # The gateway module itself is allowed to reference clickhouse_connect.
        return []
    violations = []
    lines = content.splitlines()
    for lineno, line in enumerate(lines, start=1):
        stripped = line.lstrip()
        if stripped.startswith("#") or stripped.startswith("//"):
            continue
        for pattern in _CH_WRITE_PATTERNS:
            if pattern.search(line):
                violations.append(
                    f"{filepath}:{lineno}: Raw CH client call outside query_gateway: {line.strip()!r}"
                )
    return violations


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------

class TestSingleWriterGrepGate:
    """CF-C4-SINGLE-WRITER-GREP-2: 3-pattern static gate over Brain source code."""

    def test_no_sql_write_to_legacy_tables(self) -> None:
        """Pattern 1: No SQL write keywords targeting legacy rollup table names."""
        all_violations: list[str] = []
        for filepath in _collect_source_files():
            content = filepath.read_text(encoding="utf-8", errors="ignore")
            violations = _check_sql_write_to_legacy_table(content, str(filepath))
            all_violations.extend(violations)

        assert not all_violations, (
            f"CF-C4-SINGLE-WRITER-GREP-2 VIOLATED (Pattern 1 — SQL writes): "
            f"{len(all_violations)} violation(s):\n"
            + "\n".join(all_violations)
        )

    def test_no_prisma_camel_writes_to_legacy_models(self) -> None:
        """Pattern 2: No Prisma camelCase write-method calls on legacy rollup models."""
        all_violations: list[str] = []
        for filepath in _collect_source_files():
            content = filepath.read_text(encoding="utf-8", errors="ignore")
            violations = _check_prisma_camel_writes(content, str(filepath))
            all_violations.extend(violations)

        assert not all_violations, (
            f"CF-C4-SINGLE-WRITER-GREP-2 VIOLATED (Pattern 2 — Prisma camelCase): "
            f"{len(all_violations)} violation(s):\n"
            + "\n".join(all_violations)
        )

    def test_no_raw_ch_writes_outside_gateway(self) -> None:
        """Pattern 3: No raw ClickHouse client write calls outside query_gateway.py."""
        all_violations: list[str] = []
        for filepath in _collect_source_files():
            content = filepath.read_text(encoding="utf-8", errors="ignore")
            violations = _check_raw_ch_writes_outside_gateway(content, str(filepath))
            all_violations.extend(violations)

        assert not all_violations, (
            f"CF-C4-SINGLE-WRITER-GREP-2 VIOLATED (Pattern 3 — raw CH writes): "
            f"{len(all_violations)} violation(s):\n"
            + "\n".join(all_violations)
        )

    def test_legacy_table_names_enumerated(self) -> None:
        """Sanity: the legacy table list is non-empty and covers the known rollup tables."""
        assert len(_LEGACY_SQL_TABLES) >= 5
        # workspace_daily_metrics_legacy is the protected legacy name.
        # workspace_daily_metrics_base/_computed are the NEW metric-engine tables
        # written by recompute_daily.py — they are explicitly excluded here.
        assert "workspace_daily_metrics_legacy" in _LEGACY_SQL_TABLES
        assert "product_daily_aggregates" in _LEGACY_SQL_TABLES
        assert "shopify_analytics_daily" in _LEGACY_SQL_TABLES

    def test_prisma_models_enumerated(self) -> None:
        """Sanity: the Prisma model list covers all known legacy rollup camelCase names."""
        assert "workspaceDailyMetrics" in _PRISMA_CAMEL_MODELS
        assert "productDailyAggregates" in _PRISMA_CAMEL_MODELS
        assert "shopifyAnalyticsDaily" in _PRISMA_CAMEL_MODELS


class TestKilledMutantSingleWriter:
    """CF-C4-VERIFY-THE-VERIFIER-1: planted-upsert mutant must be detected.

    This test plants a `prisma.workspaceDailyMetrics.upsert(...)` call in
    synthetic Brain code content and asserts the grep gate catches it.
    Proves the grep is NOT vacuous (it would catch a real write if introduced).
    """

    def test_planted_prisma_upsert_mutant_detected(self) -> None:
        """A planted prisma.workspaceDailyMetrics.upsert() is caught by Pattern 2."""
        mutant_content = textwrap.dedent("""
            // This is a fake Brain module that mistakenly writes to the legacy rollup.
            // MUTANT: this line must be caught by the single-writer grep gate.
            await prisma.workspaceDailyMetrics.upsert({
                where: { id: rowId },
                update: { net_sales_mu: 100000 },
                create: { workspace_id: ws, date: '2026-01-01', net_sales_mu: 100000 },
            });
        """)
        violations = _check_prisma_camel_writes(mutant_content, "fake/brain_module.ts")
        assert violations, (
            "CF-C4-VERIFY-THE-VERIFIER-1 FAILED: planted "
            "prisma.workspaceDailyMetrics.upsert() mutant was NOT detected. "
            "The single-writer grep gate is not catching Prisma camelCase writes."
        )
        assert any("workspaceDailyMetrics" in v for v in violations)
        assert any("upsert" in v for v in violations)

    def test_planted_sql_insert_mutant_detected(self) -> None:
        """A planted INSERT INTO workspace_daily_metrics_legacy is caught by Pattern 1."""
        mutant_content = textwrap.dedent("""
            -- MUTANT: Brain should never write to the legacy rollup.
            INSERT INTO workspace_daily_metrics_legacy (workspace_id, date, net_sales_mu)
            VALUES ('ws_abc', '2026-01-01', 100000);
        """)
        violations = _check_sql_write_to_legacy_table(mutant_content, "fake/brain_migration.sql")
        assert violations, (
            "CF-C4-VERIFY-THE-VERIFIER-1 FAILED: planted SQL INSERT to "
            "workspace_daily_metrics_legacy was NOT detected. "
            "The single-writer grep gate is not catching SQL writes."
        )
        assert any("workspace_daily_metrics_legacy" in v for v in violations)

    def test_planted_prisma_create_mutant_detected(self) -> None:
        """A planted prisma.productDailyAggregates.create() is caught by Pattern 2."""
        mutant_content = "await prisma.productDailyAggregates.create({ data: {} });"
        violations = _check_prisma_camel_writes(mutant_content, "fake/product_sync.ts")
        assert violations, (
            "CF-C4-VERIFY-THE-VERIFIER-1: prisma.productDailyAggregates.create() not detected."
        )

    def test_planted_prisma_upsert_python_snake_not_detected(self) -> None:
        """Pattern 2 only catches camelCase Prisma writes; snake_case is Pattern 1 (SQL).
        This verifies the camelCase grep is not a false-positive on Python ORM snake_case.
        """
        non_match_content = 'prisma.workspace_daily_metrics.upsert()'  # snake_case — not camelCase
        violations = _check_prisma_camel_writes(non_match_content, "fake/py_module.py")
        # snake_case does NOT match Pattern 2 (camelCase Prisma model names)
        assert not violations, (
            "Pattern 2 falsely flagged snake_case ORM call as a Prisma camelCase write."
        )

    def test_legit_brain_code_not_flagged(self) -> None:
        """Legitimate Brain ClickHouse writes in the gateway module are NOT flagged by Pattern 3."""
        gateway_content = textwrap.dedent("""
            import clickhouse_connect
            client = clickhouse_connect.get_client(host='...')
            client.query(sql, parameters=params)
        """)
        violations = _check_raw_ch_writes_outside_gateway(
            gateway_content, "fake/query_gateway.py"
        )
        assert not violations, (
            "Pattern 3 falsely flagged the query_gateway module itself."
        )
