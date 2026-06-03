/**
 * sync-scheduler.ts — Near-real-time ad-spend poll scheduler (S5).
 *
 * @paradigm io+sql (scheduled provider pull → deterministic SQL UPSERT; NO ML, NO LLM)
 *
 * WHY THIS EXISTS
 * ─────────────────────────────────────────────────────────────────────────────
 * Shopify is now real-time via webhooks (ingestion-service → Kafka → realtime-
 * facts-consumer). Meta and Google Ads APIs are pull-only: neither platform
 * supports push delivery of spend data. "Near-real-time" for ads therefore
 * means a scheduled periodic poll — this module provides that scheduler.
 *
 * Polling Shopify is an OPTIONAL reconciliation backstop (fill gaps left by
 * missed webhooks) and is NOT in the default vendor set. Add 'SHOPIFY' to
 * SYNC_POLL_VENDORS if you want reconciliation polling; keep it off to avoid
 * redundant syncs that duplicate the webhook path.
 *
 * HONEST CONSTRAINT — PROVIDER FETCH IS FOUNDER-GATED
 * ─────────────────────────────────────────────────────────────────────────────
 * The live provider fetch (LiveConnectorFetch in provider-fetch.ts) throws
 * "requires a real token" because live Meta/Google tokens have not been issued
 * yet — this is a Founder-gated step. Locally, every scheduled poll will
 * attempt the sync (enumerate connected connectors → call syncConnector) and
 * fail at the fetch step. That is EXPECTED behaviour; the failure is caught,
 * logged at WARN (not ERROR spam), and does not crash the gateway or block
 * other connectors. The deliverable is the scheduling mechanism + clean error
 * isolation + tests — not live ad data.
 *
 * RLS APPROACH — OPTION (a): workspace-enumeration
 * ─────────────────────────────────────────────────────────────────────────────
 * The scheduler runs outside any HTTP request — there is no JWT / user context.
 * Performing an UNSCOPED cross-tenant read against connector_connections would
 * break RLS (no app.workspace_id GUC set, FORCE RLS returns 0 rows or, with
 * permissive policies, leaks rows across tenants).
 *
 * We use approach (a): iterate a configured workspace set
 * (SYNC_POLL_WORKSPACES, comma-separated UUIDs), and for each workspace call
 *   withWorkspace(wsId, tx => SELECT … WHERE status='CONNECTED' AND vendor = ANY(…))
 * so the GUC is correctly set per-workspace and RLS is honoured exactly as in
 * every other workspace-scoped path.
 *
 * Extension point: the TODO comment below marks where a sanctioned
 * multi-tenant enumeration (e.g. a withSuperadmin read keyed on a known index)
 * would be added when the Founder adds more workspaces to the platform. For
 * now the env var is the minimal, audit-friendly mechanism.
 *
 * LIFECYCLE — mirrors realtime-facts-consumer.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * - startSyncScheduler(log) — called from main() ONLY when
 *   SYNC_SCHEDULER_ENABLED === 'true'. Does NOT block server boot.
 * - stopSyncScheduler()    — called on SIGTERM / server.onClose. Clears the
 *   interval and lets the current tick finish naturally.
 * - The tick is exported as runSchedulerTick(…) for direct unit-test invocation
 *   (no fake timer needed; the test calls the tick function directly).
 */

import type { PoolClient } from 'pg'
import { withWorkspace } from '@brain/core-connectors'
import { syncConnector } from '@brain/core-connectors'
import type { ConnectorVendor } from '@brain/core-connectors'

// ---------------------------------------------------------------------------
// Config helpers
// ---------------------------------------------------------------------------

/** Vendors to poll on each tick. Default: META + GOOGLE (Shopify is webhook-driven). */
function parsePollVendors(raw: string | undefined): ConnectorVendor[] {
  const defaults: ConnectorVendor[] = ['META', 'GOOGLE']
  if (!raw?.trim()) return defaults
  const candidates = raw
    .split(',')
    .map((s) => s.trim().toUpperCase())
    .filter(Boolean)
  const valid: ConnectorVendor[] = ['SHOPIFY', 'META', 'GOOGLE']
  return candidates.filter((v): v is ConnectorVendor => valid.includes(v as ConnectorVendor))
}

/** Workspace UUIDs to poll. Default: local Sugandhlok dev workspace. */
function parsePollWorkspaces(raw: string | undefined): string[] {
  const SUGANDHLOK_WS = 'f165da80-e6d5-4c58-9aff-ec654b873bd7'
  if (!raw?.trim()) return [SUGANDHLOK_WS]
  return raw
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean)
}

/** Interval between ticks in ms. Default: 30 minutes. */
function parsePollIntervalMs(raw: string | undefined): number {
  const DEFAULT = 1_800_000 // 30 minutes
  if (!raw?.trim()) return DEFAULT
  const n = parseInt(raw, 10)
  return Number.isFinite(n) && n > 0 ? n : DEFAULT
}

// ---------------------------------------------------------------------------
// Logger type (minimal Pino-compatible interface — matches realtime-facts-consumer)
// ---------------------------------------------------------------------------

type SchedulerLogger = {
  info(msg: string, obj?: object): void
  warn(obj: object, msg: string): void
  error(obj: object, msg: string): void
}

// ---------------------------------------------------------------------------
// Tick deps (injectable for tests)
// ---------------------------------------------------------------------------

export interface SchedulerDeps {
  /** Read CONNECTED connector_connections for a workspace+vendor list.
   *  Defaults to a withWorkspace-scoped PG query. Overrideable in tests. */
  readConnectedVendors: (
    workspaceId: string,
    vendors: ConnectorVendor[],
  ) => Promise<ConnectorVendor[]>

  /** Sync one (workspace, vendor) pair. Defaults to syncConnector. Overrideable in tests. */
  doSync: typeof syncConnector
}

/** Build the default (production) deps. */
function defaultSchedulerDeps(): SchedulerDeps {
  return {
    async readConnectedVendors(workspaceId, vendors) {
      const rows = await withWorkspace(workspaceId, async (tx: PoolClient) => {
        const res = await tx.query<{ vendor: string }>(
          `SELECT vendor FROM connector_connections
            WHERE status = 'CONNECTED' AND vendor = ANY($1)`,
          [vendors],
        )
        return res.rows
      })
      return rows
        .map((r) => r.vendor.toUpperCase() as ConnectorVendor)
        .filter((v): v is ConnectorVendor =>
          ['SHOPIFY', 'META', 'GOOGLE'].includes(v),
        )
    },
    doSync: syncConnector,
  }
}

// ---------------------------------------------------------------------------
// Single tick — exported for direct test invocation (no fake timer required)
// ---------------------------------------------------------------------------

/**
 * One scheduler tick: for each configured workspace, enumerate CONNECTED vendors
 * and call syncConnector per pair. Errors from a single connector are isolated
 * (caught, logged at warn) — one bad connector never stops the others or crashes
 * the gateway.
 *
 * @param log       Pino-compatible logger
 * @param workspaces Workspace UUIDs to iterate (from env)
 * @param vendors    Vendor subset to check (from env)
 * @param deps       Injectable deps (defaults to real DB + real syncConnector)
 */
export async function runSchedulerTick(
  log: SchedulerLogger,
  workspaces: string[],
  vendors: ConnectorVendor[],
  deps: SchedulerDeps = defaultSchedulerDeps(),
): Promise<void> {
  let attempted = 0
  let succeeded = 0
  let failed = 0

  for (const workspaceId of workspaces) {
    // Enumerate CONNECTED vendors for this workspace under RLS (option a).
    let connectedVendors: ConnectorVendor[]
    try {
      connectedVendors = await deps.readConnectedVendors(workspaceId, vendors)
    } catch (err) {
      // If the workspace enumeration itself fails (e.g. no PG connection at boot)
      // log and skip — do NOT kill the tick for other workspaces.
      log.warn(
        { err, workspace_id: workspaceId },
        'sync-scheduler: failed to read connected vendors for workspace — skipping',
      )
      continue
    }

    for (const vendor of connectedVendors) {
      attempted++
      try {
        // NOTE: the live provider fetch (provider-fetch.ts LiveConnectorFetch)
        // is Founder-gated and throws "requires a real token" until live
        // Meta/Google tokens are issued. syncConnector handles this cleanly:
        // it catches the error, writes last_sync_error to the DB, and returns
        // { status: 'error', error: '...' }. We treat any non-'synced' status
        // as an expected partial failure and log at WARN, not ERROR.
        const result = await deps.doSync({ vendor, workspaceId })

        if (result.status === 'synced') {
          succeeded++
          log.info(
            `sync-scheduler: scheduled poll succeeded workspace=${workspaceId} vendor=${vendor} orders=${result.ordersSynced} ads=${result.adRowsSynced}`,
          )
        } else if (result.status === 'not_connected') {
          // Race: the connection was disconnected between enumeration and sync.
          // Not a failure — just outdated enumeration.
          log.warn(
            { workspace_id: workspaceId, vendor },
            'sync-scheduler: vendor not connected at sync time (disconnected mid-tick?) — skipped',
          )
          attempted--  // Don't count this as a real attempt; no work was tried
        } else {
          // status === 'error' — most likely the Founder-gated live fetch stub.
          failed++
          log.warn(
            {
              workspace_id: workspaceId,
              vendor,
              error: result.error,
            },
            'sync-scheduler: scheduled poll; live provider fetch is Founder-gated — sync returned error (expected until tokens issued)',
          )
        }
      } catch (err) {
        // syncConnector should not throw (it catches internally), but if it does
        // (unexpected infrastructure failure) we isolate here.
        failed++
        log.warn(
          { err, workspace_id: workspaceId, vendor },
          'sync-scheduler: scheduled poll; uncaught error from syncConnector — isolated (others continue)',
        )
      }
    }
  }

  log.info(
    `sync-scheduler: tick complete — attempted=${attempted} succeeded=${succeeded} failed=${failed}`,
  )
}

// ---------------------------------------------------------------------------
// Scheduler lifecycle
// ---------------------------------------------------------------------------

let _intervalHandle: ReturnType<typeof setInterval> | null = null

/**
 * Start the ad-spend poll scheduler. Called from main() ONLY when
 * SYNC_SCHEDULER_ENABLED === 'true'. Fires the first tick after one full
 * interval (not immediately on boot) so the server settles before touching the
 * DB. Does NOT block server boot.
 *
 * Vendors: SYNC_POLL_VENDORS (default: META,GOOGLE)
 *   Shopify is webhook-driven; adding SHOPIFY here enables optional reconciliation
 *   polling as a backstop for missed webhooks — off by default.
 *
 * Workspaces: SYNC_POLL_WORKSPACES (default: Sugandhlok dev UUID)
 *   TODO(multi-tenant): when the platform has multiple workspaces, replace this
 *   with a withSuperadmin-scoped enumeration of all workspace IDs from the
 *   workspaces table, keyed by an index, so no UUID enumeration is needed in env.
 *   Until then, the env list is the minimal RLS-safe mechanism.
 */
export function startSyncScheduler(
  log: SchedulerLogger,
  deps?: SchedulerDeps,
): void {
  if (_intervalHandle) {
    log.warn({}, 'sync-scheduler: startSyncScheduler called but scheduler already running — ignoring')
    return
  }

  const intervalMs = parsePollIntervalMs(process.env['SYNC_POLL_INTERVAL_MS'])
  const vendors = parsePollVendors(process.env['SYNC_POLL_VENDORS'])
  const workspaces = parsePollWorkspaces(process.env['SYNC_POLL_WORKSPACES'])

  log.info(
    `sync-scheduler: ENABLED — interval=${intervalMs}ms vendors=[${vendors.join(',')}] workspaces=${workspaces.length} (Shopify is webhook-driven; polling Shopify is optional reconciliation only)`,
  )

  _intervalHandle = setInterval(() => {
    // Fire-and-forget per tick; errors are fully isolated inside runSchedulerTick.
    void runSchedulerTick(log, workspaces, vendors, deps).catch((err) => {
      // Belt-and-suspenders: runSchedulerTick does not throw, but guard anyway.
      log.error({ err }, 'sync-scheduler: unexpected tick error (scheduler continues)')
    })
  }, intervalMs)

  // setInterval ref does not prevent process exit — no unref needed since
  // we drive shutdown explicitly via stopSyncScheduler().
}

/**
 * Gracefully stop the scheduler — called on SIGTERM / server.onClose.
 * Safe to call even if startSyncScheduler was never called.
 * Does NOT await in-flight ticks — they are allowed to complete naturally.
 */
export function stopSyncScheduler(): void {
  if (_intervalHandle) {
    clearInterval(_intervalHandle)
    _intervalHandle = null
  }
}
