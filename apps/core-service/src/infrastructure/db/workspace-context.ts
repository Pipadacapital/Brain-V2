/**
 * Session-context primitive — the Single Primitive for workspace-scoped DB access.
 *
 * @paradigm sql (SQL/DDL + connection-handling; no ML, no LLM)
 *
 * WHY a dedicated pg Pool on DIRECT_URL (:5432 session-mode)?
 * The legacy singleton connected to :6543 (pgbouncer transaction-mode). Under
 * transaction-mode, a SET LOCAL issued outside an explicit transaction is
 * silently discarded when the backend connection returns to the pool — so the
 * next tenant that gets that connection sees no workspace context and (once
 * FORCE RLS is applied) returns 0 rows or, in a misconfigured policy, stale
 * context. Session-mode (:5432) holds the backend connection for the lifetime
 * of the pg client connection; set_config(..., true) (tx-local) is scrubbed
 * reliably at transaction commit/rollback.
 *
 * WHY tx-local set_config (missing_ok=true) inside an explicit BEGIN/COMMIT?
 *   • set_config(name, value, true) is the injection-safe equivalent of
 *     SET LOCAL — it accepts a bind parameter; SET LOCAL requires string
 *     interpolation which risks SQL injection.
 *   • The explicit transaction ensures the context-setting statement and the
 *     data queries execute in the same transaction; the context is scrubbed at
 *     commit/rollback even if the connection is long-lived.
 *
 * CF-C1-POOL-1.a: session-mode client (:5432) + tx-local set_config (true).
 * CF-SEC-5: correlation 4-tuple carried through AsyncLocalStorage.
 * CF-BN-OWNER-1: this is the ONE sanctioned path for workspace-scoped DB access
 *   in Brain — every workspace-scoped read/write in Children 3–7 imports THIS module.
 *
 * v1 internal contract (bound 2026-05-24):
 *   withWorkspace<T>(workspaceId: string, fn: (tx: PoolClient) => Promise<T>, correlationOverride?): Promise<T>
 *   withSuperadmin<T>(fn: (tx: PoolClient) => Promise<T>, correlationOverride?): Promise<T>
 *
 * GUC names (stable identifiers — do not rename without amending the plan):
 *   app.workspace_id  — set per-tx to the workspace UUID
 *   app.is_superadmin — set to 'true' inside withSuperadmin; 'false' inside withWorkspace
 */

import { Pool, PoolClient } from 'pg'
import { AsyncLocalStorage } from 'node:async_hooks'

// ---------------------------------------------------------------------------
// Correlation-ID 4-tuple store (CF-SEC-5)
// Process-global ALS; seeded by middleware and read by wrappers + logging.
// ---------------------------------------------------------------------------

export interface CorrelationContext {
  requestId: string
  traceId: string
  workspaceId: string | null
  userId: string | null
}

export const correlationStore = new AsyncLocalStorage<CorrelationContext>()

export function getCorrelation(): CorrelationContext {
  return (
    correlationStore.getStore() ?? {
      requestId: 'unset',
      traceId: 'unset',
      workspaceId: null,
      userId: null,
    }
  )
}

// ---------------------------------------------------------------------------
// pg Pool — session-mode DIRECT_URL (:5432)
// Lazily initialised so tests can control env before the module is used.
// ---------------------------------------------------------------------------

let _pool: Pool | undefined

function getPool(): Pool {
  if (_pool) return _pool

  // Slice C (feat-onboarding-membership-db): DATABASE_URL is the Founder-mandated
  // key name for the LOCAL dev Postgres (docker, :5432 session-mode). It is an
  // ACCEPTED ALIAS for DIRECT_URL — both must point at the SAME session-mode
  // (direct, :5432) connection string. We do NOT build a second pool (Single-
  // Primitive Rule): the one session-context primitive serves every workspace-
  // scoped read/write, including onboarding/membership. DIRECT_URL wins if both set.
  const directUrl = process.env['DIRECT_URL'] ?? process.env['DATABASE_URL']
  if (!directUrl) {
    throw new Error(
      '[workspace-context] neither DIRECT_URL nor DATABASE_URL is set — the RLS ' +
        'session-context primitive cannot initialise. All workspace-scoped queries ' +
        'require a direct (session-mode) connection string on :5432.',
    )
  }

  // Append connection_limit if not already in the URL.
  // Cap at 10 to leave headroom for the pooled (:6543) consumer when that
  // comes online in a future child. Never increase without verifying the
  // Supabase plan ceiling for ap-south-1.
  const url = directUrl.includes('connection_limit')
    ? directUrl
    : directUrl.includes('?')
      ? `${directUrl}&connection_limit=10`
      : `${directUrl}?connection_limit=10`

  _pool = new Pool({
    connectionString: url,
    max: 10,
    // Per-statement timeout (canon dashboard-read budget: 30s) — Postgres aborts any
    // single statement exceeding this, capping the blast radius of a pathological
    // query so one read can't pin a pool connection. Migrations run via a separate
    // (superuser) path, so this does not constrain DDL.
    statement_timeout: 30_000,
  })
  return _pool
}

// Exported for testing — allows injection of a mock Pool without touching env.
export function _setPoolForTest(pool: Pool): void {
  _pool = pool
}
export function _resetPoolForTest(): void {
  _pool = undefined
}

// ---------------------------------------------------------------------------
// _rawQuery — probe-only: run a single query on a raw pool connection with
// NO GUC set (no workspace context, no superadmin flag). This is the genuine
// "context-less" path used by the CF-SEC-1 fail-closed probe to assert that
// a bare connection returns 0 rows after FORCE ROW LEVEL SECURITY is applied.
//
// STATIC GATE: only rls-probe.ts may call this function (grep before deploy).
// Production correctness assertion: the role used MUST NOT have rolbypassrls=true
// otherwise this check is trivially bypassed. The probe asserts this at runtime.
// ---------------------------------------------------------------------------
export async function _rawQuery<T extends Record<string, unknown>>(
  text: string,
  params?: unknown[],
): Promise<{ rows: T[] }> {
  const client = await getPool().connect()
  try {
    // Assert the current role is not BYPASSRLS — fail-closed probe is meaningless
    // if run as a BYPASSRLS role (e.g. postgres superuser). This is the production
    // correctness corollary: if Brain's application role has BYPASSRLS=true then
    // FORCE RLS is entirely bypassed for Brain's own queries.
    const roleCheck = await client.query<{ rolbypassrls: boolean }>(
      `SELECT rolbypassrls FROM pg_roles WHERE rolname = current_user`,
    )
    const bypassrls = roleCheck.rows[0]?.rolbypassrls ?? false
    if (bypassrls) {
      throw new Error(
        `[_rawQuery] current_user has rolbypassrls=true — contextless RLS probe is ` +
        `meaningless on a BYPASSRLS connection. Use a non-BYPASSRLS application role ` +
        `(e.g. rls_app) for Brain's DIRECT_URL. This is a production misconfiguration.`,
      )
    }
    const result = await client.query<T>(text, params)
    return result
  } finally {
    client.release()
  }
}

// ---------------------------------------------------------------------------
// UUID v4 guard — defense-in-depth (CF-C1-RLS-DEFAULT-1.a)
// The workspaceId is sourced from a verified JWT claim, but catching a
// malformed ID at the app layer gives a clean error rather than a Postgres
// cast error deep inside a transaction.
// ---------------------------------------------------------------------------

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// ---------------------------------------------------------------------------
// withWorkspace — the ONLY sanctioned way to touch an RLS-protected table
// ---------------------------------------------------------------------------

/**
 * Runs `fn` inside an explicit pg transaction on the session-mode client (:5432),
 * with `app.workspace_id` set tx-locally (set_config(..., true)) as the FIRST
 * statement. Context is scrubbed at transaction commit/rollback.
 *
 * CF-C1-POOL-1.a: session-mode client + tx-local set_config — no session-SET.
 * CF-SEC-5: correlation 4-tuple is bound to the ALS store before calling fn.
 */
export async function withWorkspace<T>(
  workspaceId: string,
  fn: (tx: PoolClient) => Promise<T>,
  correlationOverride?: Partial<CorrelationContext>,
): Promise<T> {
  if (!workspaceId || typeof workspaceId !== 'string') {
    throw new Error('[withWorkspace] workspaceId must be a non-empty string')
  }
  if (!UUID_REGEX.test(workspaceId)) {
    throw new Error(
      `[withWorkspace] workspaceId is not a valid UUID: ${workspaceId}`,
    )
  }

  const ctx: CorrelationContext = {
    ...getCorrelation(),
    workspaceId,
    ...correlationOverride,
  }

  return correlationStore.run(ctx, async () => {
    const client = await getPool().connect()
    try {
      await client.query('BEGIN')
      // Bind-param, tx-local: injection-safe + scrubbed at tx end.
      // BANNED alternative: SET LOCAL (string interpolation = injection risk).
      await client.query(
        "SELECT set_config('app.workspace_id', $1, true)",
        [workspaceId],
      )
      // Explicitly clear superadmin flag — belt-and-suspenders against bleed.
      await client.query(
        "SELECT set_config('app.is_superadmin', 'false', true)",
      )
      const result = await fn(client)
      await client.query('COMMIT')
      return result
    } catch (err) {
      await client.query('ROLLBACK')
      throw err
    } finally {
      client.release()
    }
  })
}

// ---------------------------------------------------------------------------
// withSuperadmin — SUPERADMIN context for cron outer enumeration + system ops
// ---------------------------------------------------------------------------

/**
 * Runs `fn` inside an explicit pg transaction with `app.is_superadmin` set to
 * 'true' tx-locally. The `app.workspace_id` GUC is cleared (empty string) so
 * no workspace policy fires inadvertently.
 *
 * STATIC GATE: this function MUST only be called from:
 *   (a) the cron outer-enumeration path (session-scoped-fanout.ts)
 *   (b) the DPDP §12 erasure path (future)
 *   (c) the CF-SEC-1 RLS probe (rls-probe.ts)
 * Any other call-site is a security finding. Grep before each deployment.
 */
export async function withSuperadmin<T>(
  fn: (tx: PoolClient) => Promise<T>,
  correlationOverride?: Partial<CorrelationContext>,
): Promise<T> {
  const ctx: CorrelationContext = {
    ...getCorrelation(),
    workspaceId: null,
    ...correlationOverride,
  }

  return correlationStore.run(ctx, async () => {
    const client = await getPool().connect()
    try {
      await client.query('BEGIN')
      await client.query(
        "SELECT set_config('app.is_superadmin', 'true', true)",
      )
      // Explicitly clear workspace context so no workspace policy fires.
      await client.query(
        "SELECT set_config('app.workspace_id', '', true)",
      )
      const result = await fn(client)
      await client.query('COMMIT')
      return result
    } catch (err) {
      await client.query('ROLLBACK')
      throw err
    } finally {
      client.release()
    }
  })
}
