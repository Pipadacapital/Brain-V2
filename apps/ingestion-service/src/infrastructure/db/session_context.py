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
  async def with_workspace(workspace_id: str, fn: Callable[[DbConn], Awaitable[T]]) -> T
  async def with_superadmin(fn: Callable[[DbConn], Awaitable[T]]) -> T

DbConn wrapper:
  with_workspace and with_superadmin yield a DbConn (thin wrapper around
  psycopg.AsyncConnection) rather than the raw connection.  DbConn adds the
  dict-row convenience layer that the call sites (ingest.py _upsert_event,
  integration tests) rely on:

    await conn.fetchone(sql, params) -> dict | None
    await conn.fetchall(sql, params) -> list[dict]
    await conn.execute(sql, params) -> None

  cursor.py calls conn.cursor() directly (named-param execute + positional-
  tuple fetchone) and continues to work unchanged because DbConn proxies all
  attribute access to the underlying AsyncConnection via __getattr__.

  The GUC set_config calls inside with_workspace/with_superadmin use the raw
  _conn execute so they run on the SAME connection/transaction — RLS context
  is never lost.
"""

from __future__ import annotations

import os
import re
from collections.abc import Awaitable, Callable
from contextlib import asynccontextmanager
from typing import Any, Optional, TypeVar

import psycopg
from psycopg import AsyncConnection
from psycopg.rows import dict_row

# ---------------------------------------------------------------------------
# DbConn — thin dict-row wrapper around psycopg.AsyncConnection
#
# WHY a wrapper instead of patching call sites?
#   _upsert_event, the integration tests, and (future) agent read paths all
#   call  conn.fetchone(sql, params) / conn.fetchall(...) / conn.execute(...)
#   and access results as dicts (row["col"]).  psycopg.AsyncConnection does not
#   expose those convenience methods; it requires an explicit cursor.
#
#   A wrapper is the LEAST-INVASIVE correct change:
#     • ingest.py _upsert_event is unchanged (line 319 stays as-is)
#     • cursor.py is unchanged (uses conn.cursor() directly — proxied via __getattr__)
#     • integration tests are unchanged
#     • The same connection/transaction that set_config() ran on handles every
#       subsequent query — RLS context cannot leak across connections.
#
#   The wrapper's fetchone/fetchall/execute use a dict_row cursor so
#   row["col"] dict-access works.  conn.cursor() (used by cursor.py) returns
#   the default tuple cursor so cursor.py's row[0..5] access is unaffected.
# ---------------------------------------------------------------------------


class DbConn:
    """
    Dict-row convenience wrapper around psycopg.AsyncConnection.

    Exposes:
      await conn.fetchone(sql, params=None) -> dict | None
      await conn.fetchall(sql, params=None) -> list[dict]
      await conn.execute(sql, params=None)  -> None  (fire-and-forget)

    All other attribute access (e.g. conn.cursor(), conn.execute as AsyncConnection
    method, etc.) is transparently proxied to the underlying _conn so that code
    calling conn.cursor() or other AsyncConnection methods continues to work.
    """

    __slots__ = ("_conn",)

    def __init__(self, conn: AsyncConnection) -> None:
        object.__setattr__(self, "_conn", conn)

    # ---- dict-row convenience API ------------------------------------------

    async def fetchone(
        self, sql: str, params: Optional[Any] = None
    ) -> Optional[dict]:
        """Execute sql with params; return first row as dict or None."""
        async with self._conn.cursor(row_factory=dict_row) as cur:
            await cur.execute(sql, params)
            return await cur.fetchone()

    async def fetchall(
        self, sql: str, params: Optional[Any] = None
    ) -> list[dict]:
        """Execute sql with params; return all rows as list[dict]."""
        async with self._conn.cursor(row_factory=dict_row) as cur:
            await cur.execute(sql, params)
            return await cur.fetchall()

    async def execute(self, sql: str, params: Optional[Any] = None) -> None:
        """Execute sql with params (no result returned)."""
        await self._conn.execute(sql, params)

    # ---- transparent proxy to underlying AsyncConnection -------------------

    def __getattr__(self, name: str) -> Any:
        return getattr(object.__getattribute__(self, "_conn"), name)

    def __setattr__(self, name: str, value: Any) -> None:
        if name == "_conn":
            object.__setattr__(self, name, value)
        else:
            setattr(object.__getattribute__(self, "_conn"), name, value)


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
    fn: Callable[[DbConn], Awaitable[T]],
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
            # Wrap in DbConn so callers get fetchone/fetchall/execute dict-row API
            # while running on the SAME connection (GUC/RLS context preserved).
            result = await fn(DbConn(conn))
            await conn.execute("COMMIT")
            return result
        except Exception:
            await conn.execute("ROLLBACK")
            raise


# ---------------------------------------------------------------------------
# with_superadmin — SUPERADMIN context for cron outer-enumeration + system ops
# ---------------------------------------------------------------------------


async def with_superadmin(
    fn: Callable[[DbConn], Awaitable[T]],
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
            # Wrap in DbConn so callers get fetchone/fetchall/execute dict-row API
            # while running on the SAME connection (GUC/RLS context preserved).
            result = await fn(DbConn(conn))
            await conn.execute("COMMIT")
            return result
        except Exception:
            await conn.execute("ROLLBACK")
            raise
