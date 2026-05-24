/**
 * CF-SEC-1 fail-closed RLS probe (Track C).
 *
 * @paradigm sql (SQL/DDL + connection-handling; no ML, no LLM)
 *
 * RED-by-default GREEN predicate:
 *   GREEN iff (crossReadCount === 0 AND contextlessCount === 0) per table
 *
 * Every table starts at RED. Only transitions GREEN when:
 *   (i)  cross-workspace read = 0 (ALPHA's rows not visible in BETA's context)
 *   (ii) context-less query = 0 rows (fail-closed when no workspace GUC is set)
 *
 * Decision-Log writes: every probe run appends a row to audit_logs under
 * withSuperadmin (system-workspace sentinel, workspace_id = NULL) so the
 * transition record is tamper-evident (CF-SEC-1 + CF-C1-AUDITLOG-1.a).
 *
 * IMPORTANT: this probe runs at rollout STEP 4 (after ENABLE+CREATE policy,
 * before FORCE). Running before policies exist will trivially pass; that is
 * not a valid GREEN. The probe MUST run as a non-BYPASSRLS role for a
 * meaningful contextless check — _rawQuery enforces this at runtime.
 *
 * Production correctness corollary (CF-SEC-1):
 *   Brain's DIRECT_URL application role MUST have rolbypassrls=false.
 *   If the role has rolbypassrls=true, _rawQuery throws a hard error and the
 *   probe returns RED, correctly blocking FORCE until the misconfiguration
 *   is fixed. This is the enforcement point for the C5 hard gate.
 */

import { withWorkspace, withSuperadmin, getCorrelation, _rawQuery } from './workspace-context.js'
import type { PoolClient } from 'pg'

// ---------------------------------------------------------------------------
// Probe result types
// ---------------------------------------------------------------------------

export type ProbeTableVerdict = 'GREEN' | 'RED'

export interface ProbeTableResult {
  table: string
  crossReadCount: number     // MUST be 0 for GREEN
  contextlessCount: number   // MUST be 0 for GREEN
  alphaCount: number         // informational: rows visible in ALPHA context
  verdict: ProbeTableVerdict
  errorMessage?: string
}

export interface ProbeRunResult {
  runId: string
  ts: string
  overallVerdict: ProbeTableVerdict
  tableResults: ProbeTableResult[]
  correlationId: ReturnType<typeof getCorrelation>
}

// ---------------------------------------------------------------------------
// Injectable query runner — enables unit testing without a live DB.
// Production code uses the real workspace-context primitives.
// Tests inject a mock via _setProbeQueryRunner / _resetProbeQueryRunner.
// ---------------------------------------------------------------------------

export interface ProbeQueryRunner {
  /**
   * Run fn inside a workspace-scoped transaction (ALPHA or BETA workspace).
   * Returns the numeric count from the fn.
   */
  withWorkspace: (workspaceId: string, fn: (tx: PoolClient) => Promise<number>) => Promise<number>

  /**
   * Run a genuinely context-less query (no GUC set, no is_superadmin).
   * Must throw if the current role has rolbypassrls=true.
   */
  rawQuery: (text: string, params?: unknown[]) => Promise<{ rows: { count: string }[] }>

  /**
   * Run fn inside a superadmin-scoped transaction (for Decision-Log writes).
   */
  withSuperadmin: (fn: (tx: PoolClient) => Promise<void>) => Promise<void>
}

// Default production runner uses the real workspace-context primitives.
function makeDefaultRunner(): ProbeQueryRunner {
  return {
    withWorkspace: (wsId, fn) => withWorkspace(wsId, fn),
    rawQuery: (text, params) => _rawQuery<{ count: string }>(text, params),
    withSuperadmin: (fn) => withSuperadmin(fn),
  }
}

let _runner: ProbeQueryRunner | undefined

function getRunner(): ProbeQueryRunner {
  return _runner ?? makeDefaultRunner()
}

/** Test-only: inject a mock runner (analogous to _setPoolForTest). */
export function _setProbeQueryRunner(runner: ProbeQueryRunner): void {
  _runner = runner
}

/** Test-only: reset to the production default. */
export function _resetProbeQueryRunner(): void {
  _runner = undefined
}

// ---------------------------------------------------------------------------
// Table classification — all 44 workspace-scoped tables + dual-policy tables
// Must cover the exact set the RLS DDL covers (CF-C1-FK-SCOPE-1.a).
// ---------------------------------------------------------------------------

type TableEntry =
  | { name: string; type: 'direct'; wsCol: string }
  | { name: string; type: 'fk'; parentTable: string; parentWsCol: string; joinCol: string }
  | {
      name: string; type: 'fk2hop'
      hop1Table: string; hop1JoinCol: string
      hop2Table: string; hop2JoinCol: string; hop2WsCol: string
    }
  | { name: string; type: 'dual'; wsCol: string }

// 22 Group-A direct-scoped tables
// 17 Group-B connId-FK 1-hop tables
// 1  Group-C orderId-FK 2-hop table
// 3  dual-policy tables (audit_logs, notifications, system_settings)
// Total: 43 per executable SQL (system_settings has superadmin-only policy, no wsCol)
export const PROBE_TABLES: TableEntry[] = [
  // Group A -- direct workspace_id
  { name: 'marketing_actions',                   type: 'direct', wsCol: 'workspace_id' },
  { name: 'workspace_festivals',                 type: 'direct', wsCol: 'workspace_id' },
  { name: 'workspace_metric_goals',              type: 'direct', wsCol: 'workspace_id' },
  { name: 'workspace_ad_campaign_classifications', type: 'direct', wsCol: 'workspace_id' },
  { name: 'ai_insights',                         type: 'direct', wsCol: 'workspace_id' },
  { name: 'workspace_ai_insights_cache',         type: 'direct', wsCol: 'workspace_id' },
  { name: 'workspace_cogs_settings',             type: 'direct', wsCol: 'workspace_id' },
  { name: 'workspace_members',                   type: 'direct', wsCol: 'workspace_id' },
  { name: 'invitations',                         type: 'direct', wsCol: 'workspace_id' },
  { name: 'workspace_costs',                     type: 'direct', wsCol: 'workspace_id' },
  { name: 'workspace_misc_expenses',             type: 'direct', wsCol: 'workspace_id' },
  { name: 'shopify_connections',                 type: 'direct', wsCol: 'workspace_id' },
  { name: 'product_lead_times',                  type: 'direct', wsCol: 'workspace_id' },
  { name: 'shiprocket_connections',              type: 'direct', wsCol: 'workspace_id' },
  { name: 'unicommerce_connections',             type: 'direct', wsCol: 'workspace_id' },
  { name: 'klaviyo_connections',                 type: 'direct', wsCol: 'workspace_id' },
  { name: 'email_performance',                   type: 'direct', wsCol: 'workspace_id' },
  { name: 'oauth_states',                        type: 'direct', wsCol: 'workspace_id' },
  { name: 'workspace_daily_metrics',             type: 'direct', wsCol: 'workspace_id' },
  { name: 'woocommerce_connections',             type: 'direct', wsCol: 'workspace_id' },
  { name: 'google_ads_connections',              type: 'direct', wsCol: 'workspace_id' },
  { name: 'meta_ads_connections',                type: 'direct', wsCol: 'workspace_id' },
  // Group B -- connId-FK 1-hop
  { name: 'product_daily_aggregates',   type: 'fk', parentTable: 'shopify_connections',    parentWsCol: 'workspace_id', joinCol: 'connection_id' },
  { name: 'shopify_analytics_daily',    type: 'fk', parentTable: 'shopify_connections',    parentWsCol: 'workspace_id', joinCol: 'connection_id' },
  { name: 'shopify_orders',             type: 'fk', parentTable: 'shopify_connections',    parentWsCol: 'workspace_id', joinCol: 'connection_id' },
  { name: 'shopify_line_items',         type: 'fk', parentTable: 'shopify_connections',    parentWsCol: 'workspace_id', joinCol: 'connection_id' },
  { name: 'shopify_products',           type: 'fk', parentTable: 'shopify_connections',    parentWsCol: 'workspace_id', joinCol: 'connection_id' },
  { name: 'shopify_variants',           type: 'fk', parentTable: 'shopify_connections',    parentWsCol: 'workspace_id', joinCol: 'connection_id' },
  { name: 'shopify_customers',          type: 'fk', parentTable: 'shopify_connections',    parentWsCol: 'workspace_id', joinCol: 'connection_id' },
  { name: 'unicommerce_products',       type: 'fk', parentTable: 'unicommerce_connections', parentWsCol: 'workspace_id', joinCol: 'connection_id' },
  { name: 'shiprocket_orders',          type: 'fk', parentTable: 'shiprocket_connections', parentWsCol: 'workspace_id', joinCol: 'connection_id' },
  { name: 'shiprocket_shipments',       type: 'fk', parentTable: 'shiprocket_connections', parentWsCol: 'workspace_id', joinCol: 'connection_id' },
  { name: 'google_ads_funnel_daily',    type: 'fk', parentTable: 'google_ads_connections', parentWsCol: 'workspace_id', joinCol: 'connection_id' },
  { name: 'google_ads_daily_metrics',   type: 'fk', parentTable: 'google_ads_connections', parentWsCol: 'workspace_id', joinCol: 'connection_id' },
  { name: 'meta_ads_creative_daily',    type: 'fk', parentTable: 'meta_ads_connections',   parentWsCol: 'workspace_id', joinCol: 'connection_id' },
  { name: 'meta_ads_daily_metrics',     type: 'fk', parentTable: 'meta_ads_connections',   parentWsCol: 'workspace_id', joinCol: 'connection_id' },
  { name: 'woocommerce_orders',         type: 'fk', parentTable: 'woocommerce_connections', parentWsCol: 'workspace_id', joinCol: 'connection_id' },
  { name: 'woocommerce_products',       type: 'fk', parentTable: 'woocommerce_connections', parentWsCol: 'workspace_id', joinCol: 'connection_id' },
  { name: 'shopify_refund_line_items',  type: 'fk', parentTable: 'shopify_connections',    parentWsCol: 'workspace_id', joinCol: 'connection_id' },
  // Group C -- orderId-FK 2-hop (woocommerce_line_items)
  {
    name: 'woocommerce_line_items',
    type: 'fk2hop',
    hop1Table: 'woocommerce_orders',    hop1JoinCol: 'order_id',
    hop2Table: 'woocommerce_connections', hop2JoinCol: 'connection_id', hop2WsCol: 'workspace_id',
  },
  // Dual-policy tables (workspace-scoped + superadmin-system-rows)
  { name: 'audit_logs',    type: 'dual', wsCol: 'workspace_id' },
  { name: 'notifications', type: 'dual', wsCol: 'workspace_id' },
  // system_settings is superadmin-only (no wsCol); probe uses contextless check only.
  { name: 'system_settings', type: 'direct', wsCol: 'id' }, // probed for contextless only; id never matches a UUID workspace
]

// ---------------------------------------------------------------------------
// Single-table probe (injectable runner for unit testability)
// ---------------------------------------------------------------------------

async function probeTable(
  entry: TableEntry,
  alphaWorkspaceId: string,
  betaWorkspaceId: string,
  runner: ProbeQueryRunner,
): Promise<ProbeTableResult> {
  const table = entry.name

  try {
    // (i) ALPHA context: count rows (informational)
    const alphaRows = await runner.withWorkspace(alphaWorkspaceId, async (tx) => {
      const result = await tx.query<{ count: string }>(
        `SELECT COUNT(*) AS count FROM "${table}"`,
      )
      return Number(result.rows[0]?.count ?? 0)
    })

    // (ii) Cross-read: count ALPHA-owned rows visible in BETA's context.
    // Non-overlapping seeds: if RLS is correct, BETA sees 0 of ALPHA's rows.
    const crossReadCount = await runner.withWorkspace(betaWorkspaceId, async (tx: PoolClient) => {
      if (entry.type === 'direct' || entry.type === 'dual') {
        const result = await tx.query<{ count: string }>(
          `SELECT COUNT(*) AS count FROM "${table}" WHERE "${entry.wsCol}" = $1::uuid`,
          [alphaWorkspaceId],
        )
        return Number(result.rows[0]?.count ?? 0)
      }
      if (entry.type === 'fk') {
        const result = await tx.query<{ count: string }>(
          `SELECT COUNT(*) AS count FROM "${table}" t
           JOIN "${entry.parentTable}" p ON p.id = t."${entry.joinCol}"
           WHERE p."${entry.parentWsCol}" = $1::uuid`,
          [alphaWorkspaceId],
        )
        return Number(result.rows[0]?.count ?? 0)
      }
      if (entry.type === 'fk2hop') {
        const result = await tx.query<{ count: string }>(
          `SELECT COUNT(*) AS count FROM "${table}" t
           JOIN "${entry.hop1Table}" h1 ON h1.id = t."${entry.hop1JoinCol}"
           JOIN "${entry.hop2Table}" h2 ON h2.id = h1."${entry.hop2JoinCol}"
           WHERE h2."${entry.hop2WsCol}" = $1::uuid`,
          [alphaWorkspaceId],
        )
        return Number(result.rows[0]?.count ?? 0)
      }
      return 0
    })

    // (iii) Context-less: must return 0 once FORCE is applied (fail-closed).
    // Uses _rawQuery: a genuinely bare connection with NO GUC set and NO
    // is_superadmin flag. _rawQuery asserts at runtime that the current role
    // is NOT rolbypassrls=true (production correctness corollary).
    //
    // Pre-FORCE: without FORCE, the table owner can still read -> count > 0 -> RED.
    //   This correctly BLOCKS FORCE at runbook STEP 4 (probe must be GREEN first).
    // Post-FORCE: owner is subject to RLS; no GUC set -> 0 rows -> GREEN.
    //
    // If the role has rolbypassrls=true, rawQuery throws -> probe returns RED,
    // correctly blocking FORCE until the production misconfiguration is fixed.
    let contextlessCount: number
    try {
      const ctxlessResult = await runner.rawQuery(
        `SELECT COUNT(*) AS count FROM "${table}"`,
      )
      contextlessCount = Number(ctxlessResult.rows[0]?.count ?? 0)
    } catch (err) {
      // rawQuery throws if rolbypassrls=true (production misconfiguration) OR
      // on any DB error. Either way this is a hard RED -- cannot verify fail-closed.
      const message = err instanceof Error ? err.message : String(err)
      return {
        table,
        crossReadCount: -1,
        contextlessCount: -1,
        alphaCount: alphaRows,
        verdict: 'RED',
        errorMessage: `[contextless-probe] ${message}`,
      }
    }

    // Mutation testing target: the && below -- flip to || must fail a test.
    // F5 fix: this predicate is exercised by the live-predicate unit test in
    // probe-verdict.test.ts which calls probeTable via the injectable runner.
    const verdict: ProbeTableVerdict =
      crossReadCount === 0 && contextlessCount === 0 ? 'GREEN' : 'RED'

    return { table, crossReadCount, contextlessCount, alphaCount: alphaRows, verdict }
  } catch (err) {
    return {
      table,
      crossReadCount: -1,
      contextlessCount: -1,
      alphaCount: -1,
      verdict: 'RED',
      errorMessage: err instanceof Error ? err.message : String(err),
    }
  }
}

// ---------------------------------------------------------------------------
// Full probe run (injectable runner for unit testability)
// ---------------------------------------------------------------------------

export async function runRlsProbe(opts: {
  alphaWorkspaceId: string
  betaWorkspaceId: string
  runId?: string
  _runnerOverride?: ProbeQueryRunner
}): Promise<ProbeRunResult> {
  const { alphaWorkspaceId, betaWorkspaceId } = opts
  const runner = opts._runnerOverride ?? getRunner()
  const runId = opts.runId ?? `probe-${Date.now()}`
  const ts = new Date().toISOString()
  const correlationId = getCorrelation()

  const tableResults: ProbeTableResult[] = []

  // Sequential per-table to avoid connection contention during rollout.
  for (const entry of PROBE_TABLES) {
    const result = await probeTable(entry, alphaWorkspaceId, betaWorkspaceId, runner)
    tableResults.push(result)
  }

  const overallVerdict: ProbeTableVerdict = tableResults.every(
    (r) => r.verdict === 'GREEN',
  )
    ? 'GREEN'
    : 'RED'

  const run: ProbeRunResult = { runId, ts, overallVerdict, tableResults, correlationId }

  // Decision-Log write -- failure must NOT suppress the probe verdict.
  await writeProbeDecisionLog(run, runner)

  return run
}

// ---------------------------------------------------------------------------
// Decision-Log write (CF-SEC-1 + CF-C1-AUDITLOG-1.a)
// ---------------------------------------------------------------------------

async function writeProbeDecisionLog(
  run: ProbeRunResult,
  runner: ProbeQueryRunner,
): Promise<void> {
  try {
    await runner.withSuperadmin(async (tx: PoolClient) => {
      // Write to audit_logs as a system event (workspace_id = NULL).
      // System-workspace sentinel: userId = well-known probe-system UUID
      // (must exist in users table or constraint relaxed for probe role).
      await tx.query(
        `INSERT INTO audit_logs
           (id, workspace_id, user_id, action, entity_type, entity_id, metadata, created_at)
         VALUES
           (gen_random_uuid(), NULL, $1::uuid, $2, $3, $4, $5::jsonb, NOW())`,
        [
          '00000000-0000-0000-0000-000000000001',
          'rls.probe.transition',
          'rls_probe',
          run.runId,
          JSON.stringify({
            verdict: run.overallVerdict,
            runId: run.runId,
            ts: run.ts,
            correlationId: run.correlationId,
            tableCount: run.tableResults.length,
            redTables: run.tableResults
              .filter((r) => r.verdict === 'RED')
              .map((r) => r.table),
          }),
        ],
      )
    })
  } catch (err) {
    // Log but do not re-throw -- probe verdict is more important than the log write.
    console.error('[rls-probe] Failed to write Decision-Log entry:', err)
  }
}

// ---------------------------------------------------------------------------
// Format probe result for stdout (runbook STEP 4 + STEP 6 output)
// ---------------------------------------------------------------------------

export function formatProbeResult(run: ProbeRunResult): string {
  const lines: string[] = [
    `RLS PROBE ${run.ts} run=${run.runId} VERDICT=${run.overallVerdict}`,
    `Correlation: requestId=${run.correlationId.requestId} workspaceId=${run.correlationId.workspaceId ?? 'unset'}`,
    '',
    'Table Results:',
  ]
  for (const r of run.tableResults) {
    const icon = r.verdict === 'GREEN' ? 'OK  ' : 'FAIL'
    lines.push(
      `  [${icon}] ${r.table.padEnd(47)} alpha=${r.alphaCount} cross=${r.crossReadCount} ctxless=${r.contextlessCount}${r.errorMessage ? ` ERROR: ${r.errorMessage}` : ''}`,
    )
  }
  if (run.overallVerdict === 'RED') {
    lines.push('')
    lines.push('FAILED TABLES (cross_read != 0 or contextless != 0):')
    for (const r of run.tableResults.filter((t) => t.verdict === 'RED')) {
      lines.push(`  - ${r.table}`)
    }
  }
  return lines.join('\n')
}
