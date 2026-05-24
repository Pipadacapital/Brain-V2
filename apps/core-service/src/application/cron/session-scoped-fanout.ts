/**
 * Brain-native cron session-scoped fan-out pattern (Track D).
 *
 * @paradigm sql (connection-handling; no ML, no LLM)
 *
 * Re-expresses the proven legacy cron session-scoping (mined from legacy
 * routes/cron.ts + integrations/*-sync.ts) Brain-native.
 *
 * CF-C1-CRON-SCOPE-1.a requirements:
 *   - outer enumeration under withSuperadmin (reads all CONNECTED connections
 *     across all workspaces; post-FORCE, a bare findMany would return 0 rows)
 *   - per-connection work under withWorkspace(c.workspaceId)
 *   - per-connection try/catch (one failure does not skip others)
 *   - proof-of-attempt log (cron.sync.attempted) with the correlation 4-tuple
 *   - silent_skip alarm when attempted < totalConnected
 *
 * This is a library function — not wired to a live endpoint this child.
 * The future ingestion runtime (Child-3) and core runtime will call
 * scheduledFanout() for each sync type.
 *
 * NO live connector calls are made here. This module exports the PATTERN;
 * Child-3 supplies the concrete doWork implementations per connector.
 */

import { withSuperadmin, withWorkspace, getCorrelation } from '../../infrastructure/db/workspace-context.js'
import type { PoolClient } from 'pg'

// ---------------------------------------------------------------------------
// Connection record shape — the minimal surface area this pattern needs.
// Child-3 will supply the full connector-specific type; we use a structural
// minimum here so the pattern is consumable without a full ORM.
// ---------------------------------------------------------------------------

export interface ConnectedRecord {
  id: string
  workspaceId: string
  [key: string]: unknown
}

export interface FanoutOptions<TConn extends ConnectedRecord> {
  /** Human-readable name for logs (e.g. 'shopify', 'shiprocket') */
  syncName: string
  /**
   * Enumerate all CONNECTED records under SUPERADMIN context.
   * MUST NOT use a bare (non-withSuperadmin) query — after FORCE that returns 0.
   */
  listConnected: (tx: PoolClient) => Promise<TConn[]>
  /**
   * Do the per-connection sync work under the connection's workspaceId context.
   * Called inside withWorkspace(conn.workspaceId) — session-scoped per connection.
   */
  doWork: (conn: TConn, tx: PoolClient) => Promise<void>
  /**
   * Optional logger — defaults to console. Replace in production with structured
   * logger that accepts the correlation 4-tuple.
   */
  log?: (event: FanoutLogEvent) => void
}

export interface FanoutLogEvent {
  event: string
  syncName: string
  connectionId?: string
  workspaceId?: string
  status?: 'ok' | 'failed'
  error?: string
  attempted?: number
  totalConnected?: number
  correlation: ReturnType<typeof getCorrelation>
}

function defaultLog(event: FanoutLogEvent): void {
  console.log(JSON.stringify({ ...event, ts: new Date().toISOString() }))
}

// ---------------------------------------------------------------------------
// scheduledFanout — the reusable fan-out shape
// ---------------------------------------------------------------------------

/**
 * Outer enumeration under withSuperadmin; per-connection work under withWorkspace.
 * Returns a summary of attempted / failed counts.
 *
 * CF-C1-CRON-SCOPE-1.a: per-connection try/catch + proof-of-attempt logging.
 */
export async function scheduledFanout<TConn extends ConnectedRecord>(
  opts: FanoutOptions<TConn>,
): Promise<{ totalConnected: number; attempted: number; failed: number }> {
  const log = opts.log ?? defaultLog
  const correlation = getCorrelation()

  // Outer enumeration — SUPERADMIN sees all workspace rows (post-FORCE safe).
  // BANNED: a bare (non-superadmin) pool query would return 0 rows post-FORCE.
  let connections: TConn[] = []
  await withSuperadmin(async (tx) => {
    connections = await opts.listConnected(tx)
  })

  const totalConnected = connections.length
  let attempted = 0
  let failed = 0

  // Per-connection work — each gets its own workspace session.
  for (const conn of connections) {
    attempted++
    try {
      await withWorkspace(conn.workspaceId, async (tx) => {
        await opts.doWork(conn, tx)
      })
      log({
        event: 'cron.sync.attempted',
        syncName: opts.syncName,
        connectionId: conn.id,
        workspaceId: conn.workspaceId,
        status: 'ok',
        attempted,
        totalConnected,
        correlation,
      })
    } catch (err) {
      // Per-connection failure must NOT abort the rest of the fan-out.
      failed++
      log({
        event: 'cron.sync.attempted',
        syncName: opts.syncName,
        connectionId: conn.id,
        workspaceId: conn.workspaceId,
        status: 'failed',
        error: err instanceof Error ? err.message : String(err),
        attempted,
        totalConnected,
        correlation,
      })
    }
  }

  // Silent-skip alarm: if a connection was enumerated but never attempted,
  // that indicates a bug in the fan-out logic (should not happen here, but
  // guards against future refactors that break the loop).
  if (attempted < totalConnected) {
    log({
      event: 'cron.sync.alarm.silent_skip',
      syncName: opts.syncName,
      attempted,
      totalConnected,
      correlation,
    })
  }

  return { totalConnected, attempted, failed }
}
