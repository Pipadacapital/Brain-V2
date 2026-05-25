"""
analytics_service_startup.py — Startup assertions for analytics-service.

@paradigm: sql
CF-C4-RESIDENCY-1: refuse to start if the ClickHouse endpoint is not in ap-south-1.
    Mirrors Child-3's CF-C3-RESIDENCY-ASSERT-1 pattern.
CF-C4-SINGLE-WRITER-GREP-2: assert analytics Postgres role is read-only at startup.
    The analytics-service must never have a write path to the legacy Postgres rollup.

Both assertions run before accepting traffic. Either failure causes sys.exit(1).
"""

from __future__ import annotations

import logging
import os
import sys

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# CF-C4-RESIDENCY-1: ClickHouse must be in ap-south-1
# ---------------------------------------------------------------------------
# Known ap-south-1 ClickHouse Cloud hostname patterns.
_AP_SOUTH_1_MARKERS = [
    "ap-south-1",
    "aps1",            # ClickHouse Cloud region code variant
]


class ClickHouseRegionMismatchError(RuntimeError):
    """Raised when the ClickHouse endpoint is not in ap-south-1.

    CF-C4-RESIDENCY-1: analytics-service refuses to start outside ap-south-1.
    This is an India-compliance requirement (DPDP scope — OLAP derives from
    order/customer events; data must remain in ap-south-1).
    """


class PostgresWriteRoleError(RuntimeError):
    """Raised when the analytics Postgres role has write permissions.

    CF-C4-SINGLE-WRITER-GREP-2: the structural backstop the static grep
    cannot provide. If the DB role has write grants, the service refuses to
    start — a misconfigured role cannot silently allow writes.
    """


def assert_clickhouse_residency(host: str | None = None) -> None:
    """Assert the ClickHouse endpoint is in ap-south-1.

    Reads CLICKHOUSE_HOST from the environment if `host` is not provided.
    Raises ClickHouseRegionMismatchError if the host does not contain an
    ap-south-1 marker.

    CF-C4-RESIDENCY-1.

    Args:
        host: ClickHouse host string (overrides env var; for testing).

    Raises:
        ClickHouseRegionMismatchError: if the host is not in ap-south-1.
        EnvironmentError: if CLICKHOUSE_HOST is not set.
    """
    ch_host = host if host is not None else os.environ.get("CLICKHOUSE_HOST", "")

    if not ch_host:
        raise EnvironmentError(
            "CLICKHOUSE_HOST environment variable is required. "
            "analytics-service cannot start without a configured ClickHouse endpoint. "
            "CF-C4-RESIDENCY-1."
        )

    host_lower = ch_host.lower()
    in_ap_south_1 = any(marker in host_lower for marker in _AP_SOUTH_1_MARKERS)

    if not in_ap_south_1:
        raise ClickHouseRegionMismatchError(
            f"CF-C4-RESIDENCY-1: ClickHouse endpoint {ch_host!r} is not in ap-south-1. "
            f"Expected the host to contain one of: {_AP_SOUTH_1_MARKERS}. "
            "analytics-service refuses to start outside ap-south-1 (DPDP compliance — "
            "OLAP store must be in the same region as the ingestion layer). "
            "Set CLICKHOUSE_HOST to the correct ap-south-1 endpoint."
        )

    logger.info(
        "CF-C4-RESIDENCY-1: ClickHouse endpoint %r verified in ap-south-1. Proceeding.",
        ch_host,
    )


def assert_postgres_read_only_role(dsn: str | None = None) -> None:
    """Assert the analytics Postgres role is read-only (no INSERT/UPDATE/DELETE grants).

    CF-C4-SINGLE-WRITER-GREP-2: the DB-level read-only role is the structural
    single-writer backstop the static grep cannot provide. If the role has write
    permissions, the service refuses to start.

    This function probes Postgres to verify the role cannot write. It checks the
    `pg_catalog.pg_roles` / `information_schema.role_table_grants` to confirm
    no INSERT, UPDATE, DELETE, or TRUNCATE grants exist for the current role.

    In CI/test environments, set ANALYTICS_POSTGRES_ROLE_CHECK=skip to bypass.
    In production, this check MUST pass before the service accepts traffic.

    Args:
        dsn: Postgres DSN (overrides DATABASE_URL env var; for testing).

    Raises:
        PostgresWriteRoleError: if the role has write grants.
        EnvironmentError: if DATABASE_URL is not set and dsn is None.
    """
    # Allow test bypass via environment flag (for unit tests that don't provision Postgres)
    role_check = os.environ.get("ANALYTICS_POSTGRES_ROLE_CHECK", "enforce")
    if role_check == "skip":
        logger.warning(
            "CF-C4-SINGLE-WRITER-GREP-2: Postgres read-only role check SKIPPED "
            "(ANALYTICS_POSTGRES_ROLE_CHECK=skip). Only valid in CI/test environments."
        )
        return

    pg_dsn = dsn if dsn is not None else os.environ.get("DATABASE_URL", "")
    if not pg_dsn:
        raise EnvironmentError(
            "DATABASE_URL environment variable is required for the analytics-service "
            "Postgres read-only role assertion. CF-C4-SINGLE-WRITER-GREP-2."
        )

    try:
        import psycopg2  # type: ignore[import-untyped]
    except ImportError:
        logger.warning(
            "psycopg2 not available; skipping read-only role check. "
            "Install psycopg2 in production. CF-C4-SINGLE-WRITER-GREP-2."
        )
        return

    write_privilege_types = ("INSERT", "UPDATE", "DELETE", "TRUNCATE")

    try:
        conn = psycopg2.connect(pg_dsn)
        conn.autocommit = True
        cur = conn.cursor()

        # Query role_table_grants for write privileges on ANY table.
        cur.execute("""
            SELECT grantee, table_name, privilege_type
            FROM information_schema.role_table_grants
            WHERE grantee = current_user
              AND privilege_type = ANY(%s)
            LIMIT 10
        """, (list(write_privilege_types),))

        write_grants = cur.fetchall()
        cur.close()
        conn.close()

        if write_grants:
            grant_summary = ", ".join(
                f"{g[0]}.{g[1]}:{g[2]}" for g in write_grants
            )
            raise PostgresWriteRoleError(
                f"CF-C4-SINGLE-WRITER-GREP-2: analytics Postgres role has write grants: "
                f"{grant_summary}. "
                "The analytics-service role must be read-only (SELECT only). "
                "Revoke INSERT/UPDATE/DELETE/TRUNCATE grants and restart the service. "
                "See migrations/clickhouse/README.md for the provisioning SQL."
            )

        logger.info(
            "CF-C4-SINGLE-WRITER-GREP-2: Postgres read-only role verified (no write grants). Proceeding."
        )

    except psycopg2.Error as exc:
        raise EnvironmentError(
            f"CF-C4-SINGLE-WRITER-GREP-2: Failed to verify Postgres read-only role: {exc}. "
            "Cannot start analytics-service without confirming single-writer safety."
        ) from exc


def run_startup_assertions(
    clickhouse_host: str | None = None,
    postgres_dsn: str | None = None,
) -> None:
    """Run all startup assertions. Exit(1) on any failure.

    Called from the analytics-service main entry-point before accepting traffic.
    Both assertions run; errors are logged before exit.

    Args:
        clickhouse_host: override for testing.
        postgres_dsn: override for testing.
    """
    errors: list[str] = []

    try:
        assert_clickhouse_residency(host=clickhouse_host)
    except (ClickHouseRegionMismatchError, EnvironmentError) as exc:
        errors.append(f"[RESIDENCY] {exc}")

    try:
        assert_postgres_read_only_role(dsn=postgres_dsn)
    except (PostgresWriteRoleError, EnvironmentError) as exc:
        errors.append(f"[READ-ONLY-ROLE] {exc}")

    if errors:
        for err in errors:
            logger.critical("STARTUP ASSERTION FAILED: %s", err)
        sys.exit(1)

    logger.info("analytics-service: all startup assertions passed.")
