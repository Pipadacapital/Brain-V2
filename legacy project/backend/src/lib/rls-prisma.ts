/**
 * RLS session-context primitive.
 *
 * Paradigm: sql-ddl-and-connection-handling (no ML, no LLM)
 *
 * WHY a second PrismaClient on DIRECT_URL (:5432 session-mode)?
 * The singleton `prisma` client in lib/prisma.ts connects to :6543
 * (pgbouncer transaction-mode). Under transaction-mode, a `SET LOCAL
 * app.workspace_id` issued outside an explicit transaction is silently
 * discarded when the backend connection returns to the pool — so the next
 * tenant that gets that connection sees no workspace context and (once
 * FORCE RLS is applied) gets 0 rows or, in a misconfigured policy, stale
 * context. Session-mode (:5432) holds the backend connection for the
 * lifetime of the client connection, making set_config(..., true) (tx-local)
 * scrubbed reliably at transaction commit/rollback.
 *
 * WHY tx-local set_config (true) AND an explicit $transaction?
 * Belt-and-suspenders:
 *   • set_config(name, value, true) is the injection-safe equivalent of
 *     SET LOCAL (accepts a bind parameter; SET LOCAL requires string
 *     interpolation which risks SQL injection).
 *   • The explicit $transaction ensures context and data queries are in the
 *     same transaction; context is scrubbed when the transaction ends, even
 *     within a long-lived session-mode connection.
 *
 * CF-C1-POOL-1.a satisfied: rlsPrisma on :5432 + tx-local set_config.
 * CF-SEC-5 satisfied: correlation 4-tuple bound through AsyncLocalStorage.
 */

import { Prisma, PrismaClient } from '@prisma/client'
import { AsyncLocalStorage } from 'async_hooks'

// ---------------------------------------------------------------------------
// Correlation-ID 4-tuple store (CF-SEC-5)
// ---------------------------------------------------------------------------

export interface CorrelationContext {
  requestId: string
  traceId: string
  workspaceId: string | null
  userId: string | null
}

// Process-global ALS; the span is set in middleware and read in wrappers/logging.
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
// Second PrismaClient — session-mode DIRECT_URL (:5432)
// ---------------------------------------------------------------------------

const globalForRls = globalThis as unknown as {
  rlsPrisma: PrismaClient | undefined
}

/**
 * RLS-scoped Prisma client.  ALL reads/writes of Group-A/B/C tables MUST go
 * through withWorkspace() or withSuperadmin() on this client — never on the
 * bare singleton `prisma` which uses the :6543 transaction-mode pool.
 *
 * connection_limit is set conservatively: the singleton carries
 * connection_limit=20 on DATABASE_URL; we cap rlsPrisma at 10 so the two
 * together stay under the Supabase plan's connection ceiling.
 * (T1.2 note: confirmed via Supabase project limits for ap-south-1 instance;
 * adjust if plan changes — do not increase without verifying the tier ceiling.)
 */
export const rlsPrisma: PrismaClient =
  globalForRls.rlsPrisma ??
  (() => {
    const directUrl = process.env['DIRECT_URL']
    if (!directUrl) {
      throw new Error(
        '[rls-prisma] DIRECT_URL is not set — rlsPrisma cannot initialize. ' +
          'All RLS-scoped queries require the session-mode connection string.',
      )
    }
    // Append connection_limit if not already present in the URL.
    const url = directUrl.includes('connection_limit')
      ? directUrl
      : directUrl.includes('?')
        ? `${directUrl}&connection_limit=10`
        : `${directUrl}?connection_limit=10`

    return new PrismaClient({
      datasources: { db: { url } },
      log: [
        { emit: 'stdout', level: 'error' },
        { emit: 'stdout', level: 'warn' },
      ],
    })
  })()

if (process.env['NODE_ENV'] !== 'production') {
  globalForRls.rlsPrisma = rlsPrisma
}

// ---------------------------------------------------------------------------
// Prisma tx type alias — the interactive-transaction client shape
// (Prisma 5 interactive tx parameter — $executeRaw is available on it)
//
// WHY Prisma.TransactionClient and not the previous Parameters<> derivation?
// PrismaClient.$transaction is overloaded (batch-array form + interactive-
// callback form). TypeScript resolves Parameters<> against the LAST overload
// in the declaration order, which is the batch-array form — its parameter is
// an array of PrismaPromise, not a callback, so the derived type collapsed
// to `never`. Prisma exports TransactionClient explicitly as
// Omit<PrismaClient, ITXClientDenyList> — the correct shape for the
// interactive-callback tx arg.
// ---------------------------------------------------------------------------

type PrismaTx = Prisma.TransactionClient

// ---------------------------------------------------------------------------
// withWorkspace — the ONLY sanctioned way to touch an RLS-protected table
// ---------------------------------------------------------------------------

/**
 * Runs `fn` inside an explicit Prisma transaction on `rlsPrisma` (:5432),
 * with `app.workspace_id` set tx-locally (set_config(..., true)) as the
 * first statement.  Context is scrubbed at transaction commit/rollback.
 *
 * CF-C1-POOL-1.a: session-mode client + tx-local set_config.
 * CF-SEC-5: correlation 4-tuple is bound to the ALS store before calling fn.
 */
// UUID v4 shape guard — defense-in-depth (L1 from Shreya's review).
// The caller (requireWorkspace) sources workspaceId from a verified DB row so
// exploitation surface is nil, but catching a malformed ID here gives a clean
// application-level error rather than a Postgres cast error deep in a sync loop.
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function withWorkspace<T>(
  workspaceId: string,
  fn: (tx: PrismaTx) => Promise<T>,
  correlationOverride?: Partial<CorrelationContext>,
): Promise<T> {
  if (!workspaceId || typeof workspaceId !== 'string') {
    throw new Error('[withWorkspace] workspaceId must be a non-empty string')
  }
  if (!UUID_REGEX.test(workspaceId)) {
    throw new Error(`[withWorkspace] workspaceId is not a valid UUID: ${workspaceId}`)
  }

  const ctx: CorrelationContext = {
    ...getCorrelation(),
    workspaceId,
    ...correlationOverride,
  }

  return correlationStore.run(ctx, () =>
    rlsPrisma.$transaction(async (tx) => {
      // tx-local: scrubbed at commit/rollback; injection-safe bind param
      await tx.$executeRaw`SELECT set_config('app.workspace_id', ${workspaceId}::text, true)`
      // Ensure superadmin flag is explicitly cleared to prevent bleed
      await tx.$executeRaw`SELECT set_config('app.is_superadmin', 'false', true)`
      return fn(tx)
    }),
  )
}

// ---------------------------------------------------------------------------
// withSuperadmin — SUPERADMIN context for cron enumeration + system ops
// ---------------------------------------------------------------------------

/**
 * Runs `fn` inside an explicit Prisma transaction with `app.is_superadmin`
 * set to 'true' tx-locally.  Used by the cron outer enumeration (needs to
 * read all connections across workspaces) and by the DPDP §12 erasure path.
 *
 * BANNED for any non-system use (static gate: grep for withSuperadmin outside
 * cron fan-out and the erasure path).
 */
export function withSuperadmin<T>(
  fn: (tx: PrismaTx) => Promise<T>,
  correlationOverride?: Partial<CorrelationContext>,
): Promise<T> {
  const ctx: CorrelationContext = {
    ...getCorrelation(),
    workspaceId: null,
    ...correlationOverride,
  }

  return correlationStore.run(ctx, () =>
    rlsPrisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.is_superadmin', 'true', true)`
      // Explicitly clear workspace context so no workspace policy fires
      await tx.$executeRaw`SELECT set_config('app.workspace_id', '', true)`
      return fn(tx)
    }),
  )
}

// ---------------------------------------------------------------------------
// runContextualQuery — thin helper for one-shot scoped reads (no mutation)
// ---------------------------------------------------------------------------

/**
 * Convenience alias for withWorkspace — same semantics, different name for
 * call-sites that conceptually perform a single scoped read or write.
 * Both reads and writes are permitted; this is a full delegate to withWorkspace.
 * (Previously documented as "no mutation" — that was incorrect; doc corrected.)
 */
export function runInWorkspace<T>(
  workspaceId: string,
  fn: (tx: PrismaTx) => Promise<T>,
): Promise<T> {
  return withWorkspace(workspaceId, fn)
}
