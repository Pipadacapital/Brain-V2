"""
Session-context primitive — Python-native re-expression of the Child-1 TS withWorkspace contract.

@paradigm: sql (connection-handling; no ML, no LLM)

WHY a dedicated session-mode connection (:5432 DIRECT_URL)?
The pgbouncer transaction-pool (:6543) discards SET LOCAL when the backend
connection returns to the pool — so the next tenant that gets that connection
sees no workspace context and, once FORCE RLS is applied, returns 0 rows or
(in a misconfigured policy) stale context. Session-mode (:5432) holds the
backend connection for the lifetime of the psycopg connection; set_config(...,
true) (tx-local) is scrubbed reliably at transaction commit/rollback.

WHY tx-local set_config inside an explicit BEGIN/COMMIT?
  • set_config(name, value, true) is the injection-safe equivalent of
    SET LOCAL — it accepts a bind parameter; SET LOCAL requires string
    interpolation which risks SQL injection.
  • The explicit transaction ensures the context-setting statement and
    the data queries execute in the same transaction; the context is
    scrubbed at commit/rollback even if the connection is long-lived.

GUC names (stable identifiers — IDENTICAL to Child-1 TS workspace-context.ts):
  app.workspace_id  — set per-tx to the workspace UUID
  app.is_superadmin — set to 'true' inside with_superadmin; 'false' inside with_workspace

CF-C3-PY-SESSION-CTX-1: Python-native re-expression of the Child-1 contract.
CF-C3-RLS-CONSUME-1:     EVERY write to a raw table goes through with_workspace.
CF-C1-POOL-1.a (re-expressed): session-mode client (:5432) + tx-local set_config(true).

v1 internal contract (bound 2026-05-24):
  async def with_workspace(workspace_id: str, fn: Callable[[AsyncConnection], Awaitable[T]]) -> T
  async def with_superadmin(fn: Callable[[AsyncConnection], Awaitable[T]]) -> T
"""

from __future__ import annotations

import os
import re
from collections.abc import Awaitable, Callable
from contextlib import asynccontextmanager
from typing import Any, TypeVar

import psycopg
from psycopg import AsyncConnection

# ---------------------------------------------------------------------------
# UUID v4 guard — defense-in-depth (CF-C3-PY-SESSION-CTX-1 + mirrors CF-C1-RLS-DEFAULT-1.a)
# The workspace_id is sourced from the startup allowlist or a verified JWT claim,
# but catching a malformed ID at the app layer gives a clean error rather than
# a Postgres cast error deep inside a transaction.
# ---------------------------------------------------------------------------

_UUID_REGEX = re.compile(
    r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$",
    re.IGNORECASE,
)

T = TypeVar("T")


def _get_direct_url() -> str:
    """Return DIRECT_URL from env; raise on missing (fail-closed)."""
    url = os.environ.get("DIRECT_URL")
    if not url:
        raise RuntimeError(
            "[session_context] DIRECT_URL is not set — the RLS session-context "
            "primitive cannot initialise. All workspace-scoped queries require a "
            "direct (session-mode) connection string on :5432."
        )
    return url


# ---------------------------------------------------------------------------
# with_workspace — the ONLY sanctioned way to touch an RLS-protected raw table
# ---------------------------------------------------------------------------


async def with_workspace(
    workspace_id: str,
    fn: Callable[[AsyncConnection], Awaitable[T]],
) -> T:
    """
    Run `fn` inside an explicit psycopg async transaction on the session-mode
    client (:5432), with `app.workspace_id` set tx-locally as the FIRST statement.
    Context is scrubbed at transaction commit/rollback.

    • workspace_id validated as UUIDv4 — raises ValueError on invalid.
    • fail-closed: empty/None workspace_id raises; fn is NEVER called without a
      bound context.
    • ROLLBACK scrubs the tx-local GUCs.

    CF-C3-PY-SESSION-CTX-1: identical GUC names + fail-closed + tx-local set_config.
    """
    if not workspace_id or not isinstance(workspace_id, str):
        raise ValueError(
            "[with_workspace] workspace_id must be a non-empty string"
        )
    if not _UUID_REGEX.match(workspace_id):
        raise ValueError(
            f"[with_workspace] workspace_id is not a valid UUID: {workspace_id!r}"
        )

    conn_str = _get_direct_url()
    async with await AsyncConnection.connect(conn_str, autocommit=False) as conn:
        try:
            await conn.execute("BEGIN")
            # Bind-param, tx-local: injection-safe + scrubbed at tx end.
            # BANNED alternative: SET LOCAL (string interpolation = injection risk).
            await conn.execute(
                "SELECT set_config('app.workspace_id', %s, true)",
                (workspace_id,),
            )
            # Explicitly clear superadmin flag — belt-and-suspenders against bleed.
            await conn.execute(
                "SELECT set_config('app.is_superadmin', 'false', true)"
            )
            result = await fn(conn)
            await conn.execute("COMMIT")
            return result
        except Exception:
            await conn.execute("ROLLBACK")
            raise


# ---------------------------------------------------------------------------
# with_superadmin — SUPERADMIN context for cron outer-enumeration + system ops
# ---------------------------------------------------------------------------


async def with_superadmin(
    fn: Callable[[AsyncConnection], Awaitable[T]],
) -> T:
    """
    Run `fn` inside an explicit psycopg async transaction with
    `app.is_superadmin` set to 'true' tx-locally. The `app.workspace_id`
    GUC is cleared (empty string) so no workspace policy fires inadvertently.

    STATIC GATE: callable only from:
      (a) the cron outer-enumeration path
      (b) the DPDP §12 erasure path (future)
      (c) the residency/probe path
    Any other call-site is a security finding. Grep before each deployment.
    """
    conn_str = _get_direct_url()
    async with await AsyncConnection.connect(conn_str, autocommit=False) as conn:
        try:
            await conn.execute("BEGIN")
            await conn.execute(
                "SELECT set_config('app.is_superadmin', 'true', true)"
            )
            # Explicitly clear workspace context so no workspace policy fires.
            await conn.execute(
                "SELECT set_config('app.workspace_id', '', true)"
            )
            result = await fn(conn)
            await conn.execute("COMMIT")
            return result
        except Exception:
            await conn.execute("ROLLBACK")
            raise
