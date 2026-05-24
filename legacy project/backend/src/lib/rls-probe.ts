/**
 * CF-SEC-1 fail-closed RLS probe (Track 1a-D).
 *
 * Paradigm: sql-ddl-and-connection-handling
 *
 * This probe implements the GREEN predicate from §4c of the architecture plan.
 * It runs on rlsPrisma (:5432) — the same client path that RLS-scoped app
 * traffic uses — so it exercises the real isolation boundary.
 *
 * RED-by-default: the rls_probe_verdict gauge starts at 0 (RED) per table.
 * It only transitions GREEN when every table passes:
 *   (i)  cross-workspace read = 0 (ALPHA's key not visible in BETA's context)
 *   (ii) context-less query = 0 rows (fail-closed when no context is set)
 *
 * Decision-Log writes: every probe run appends a row to audit_logs under
 * withSuperadmin so the transition record is tamper-evident (CF-SEC-1).
 *
 * IMPORTANT: This probe runs at rollout STEP 4 (after ENABLE+CREATE policy,
 * before FORCE). Do NOT run it before policies exist (it will trivially pass).
 */

import { rlsPrisma, withWorkspace, withSuperadmin, getCorrelation } from './rls-prisma'
import type { PrismaClient } from '@prisma/client'

// -----------------------------------------------------------------------
// Probe result types
// -----------------------------------------------------------------------

export type ProbeTableVerdict = 'GREEN' | 'RED'

export interface ProbeTableResult {
  table: string
  crossReadCount: number     // MUST be 0
  contextlessCount: number   // MUST be 0
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

// -----------------------------------------------------------------------
// Table list — all Group A/B/C + AuditLog tables that must be covered
// -----------------------------------------------------------------------

// Each entry: [tableName (as Prisma $queryRaw literal), workspaceColumn, connectionTable?, connectionWorkspaceCol?]
// We test using COUNT(*) — no PII exposed.
type TableEntry =
  | { name: string; type: 'direct'; wsCol: string }
  | { name: string; type: 'fk'; parentTable: string; parentWsCol: string; joinCol: string }
  | { name: string; type: 'fk2hop'; hop1Table: string; hop1JoinCol: string; hop2Table: string; hop2JoinCol: string; hop2WsCol: string }
  | { name: string; type: 'dual'; wsCol: string }

const PROBE_TABLES: TableEntry[] = [
  // Group A
  { name: 'marketing_actions', type: 'direct', wsCol: 'workspace_id' },
  { name: 'workspace_festivals', type: 'direct', wsCol: 'workspace_id' },
  { name: 'workspace_metric_goals', type: 'direct', wsCol: 'workspace_id' },
  { name: 'workspace_ad_campaign_classifications', type: 'direct', wsCol: 'workspace_id' },
  { name: 'ai_insights', type: 'direct', wsCol: 'workspace_id' },
  { name: 'workspace_ai_insights_cache', type: 'direct', wsCol: 'workspace_id' },
  { name: 'workspace_cogs_settings', type: 'direct', wsCol: 'workspace_id' },
  { name: 'workspace_members', type: 'direct', wsCol: 'workspace_id' },
  { name: 'invitations', type: 'direct', wsCol: 'workspace_id' },
  { name: 'workspace_costs', type: 'direct', wsCol: 'workspace_id' },
  { name: 'workspace_misc_expenses', type: 'direct', wsCol: 'workspace_id' },
  { name: 'shopify_connections', type: 'direct', wsCol: 'workspace_id' },
  { name: 'product_lead_times', type: 'direct', wsCol: 'workspace_id' },
  { name: 'shiprocket_connections', type: 'direct', wsCol: 'workspace_id' },
  { name: 'unicommerce_connections', type: 'direct', wsCol: 'workspace_id' },
  { name: 'klaviyo_connections', type: 'direct', wsCol: 'workspace_id' },
  { name: 'email_performance', type: 'direct', wsCol: 'workspace_id' },
  { name: 'oauth_states', type: 'direct', wsCol: 'workspace_id' },
  { name: 'workspace_daily_metrics', type: 'direct', wsCol: 'workspace_id' },
  { name: 'woocommerce_connections', type: 'direct', wsCol: 'workspace_id' },
  { name: 'google_ads_connections', type: 'direct', wsCol: 'workspace_id' },
  { name: 'meta_ads_connections', type: 'direct', wsCol: 'workspace_id' },
  // Group B
  { name: 'product_daily_aggregates', type: 'fk', parentTable: 'shopify_connections', parentWsCol: 'workspace_id', joinCol: 'connection_id' },
  { name: 'shopify_analytics_daily', type: 'fk', parentTable: 'shopify_connections', parentWsCol: 'workspace_id', joinCol: 'connection_id' },
  { name: 'shopify_orders', type: 'fk', parentTable: 'shopify_connections', parentWsCol: 'workspace_id', joinCol: 'connection_id' },
  { name: 'shopify_line_items', type: 'fk', parentTable: 'shopify_connections', parentWsCol: 'workspace_id', joinCol: 'connection_id' },
  { name: 'shopify_products', type: 'fk', parentTable: 'shopify_connections', parentWsCol: 'workspace_id', joinCol: 'connection_id' },
  { name: 'shopify_variants', type: 'fk', parentTable: 'shopify_connections', parentWsCol: 'workspace_id', joinCol: 'connection_id' },
  { name: 'shopify_customers', type: 'fk', parentTable: 'shopify_connections', parentWsCol: 'workspace_id', joinCol: 'connection_id' },
  { name: 'unicommerce_products', type: 'fk', parentTable: 'unicommerce_connections', parentWsCol: 'workspace_id', joinCol: 'connection_id' },
  { name: 'shiprocket_orders', type: 'fk', parentTable: 'shiprocket_connections', parentWsCol: 'workspace_id', joinCol: 'connection_id' },
  { name: 'shiprocket_shipments', type: 'fk', parentTable: 'shiprocket_connections', parentWsCol: 'workspace_id', joinCol: 'connection_id' },
  { name: 'google_ads_funnel_daily', type: 'fk', parentTable: 'google_ads_connections', parentWsCol: 'workspace_id', joinCol: 'connection_id' },
  { name: 'google_ads_daily_metrics', type: 'fk', parentTable: 'google_ads_connections', parentWsCol: 'workspace_id', joinCol: 'connection_id' },
  { name: 'meta_ads_creative_daily', type: 'fk', parentTable: 'meta_ads_connections', parentWsCol: 'workspace_id', joinCol: 'connection_id' },
  { name: 'meta_ads_daily_metrics', type: 'fk', parentTable: 'meta_ads_connections', parentWsCol: 'workspace_id', joinCol: 'connection_id' },
  { name: 'woocommerce_orders', type: 'fk', parentTable: 'woocommerce_connections', parentWsCol: 'workspace_id', joinCol: 'connection_id' },
  { name: 'woocommerce_products', type: 'fk', parentTable: 'woocommerce_connections', parentWsCol: 'workspace_id', joinCol: 'connection_id' },
  { name: 'shopify_refund_line_items', type: 'fk', parentTable: 'shopify_connections', parentWsCol: 'workspace_id', joinCol: 'connection_id' },
  // Group C
  { name: 'woocommerce_line_items', type: 'fk2hop',
    hop1Table: 'woocommerce_orders', hop1JoinCol: 'order_id',
    hop2Table: 'woocommerce_connections', hop2JoinCol: 'connection_id', hop2WsCol: 'workspace_id' },
  // AuditLog — dual-policy: tenant rows scoped by workspace_id
  { name: 'audit_logs', type: 'dual', wsCol: 'workspace_id' },
]

// -----------------------------------------------------------------------
// Single-table probe
// -----------------------------------------------------------------------

async function probeTable(
  entry: TableEntry,
  alphaWorkspaceId: string,
  betaWorkspaceId: string,
): Promise<ProbeTableResult> {
  const table = entry.name

  try {
    // (i) ALPHA context: count rows (informational)
    const alphaRows = await withWorkspace(alphaWorkspaceId, async (tx) => {
      const result = await tx.$queryRawUnsafe<[{ count: bigint }]>(
        `SELECT COUNT(*) AS count FROM ${table}`,
      )
      return Number(result[0]?.count ?? 0)
    })

    // (ii) BETA context: count rows that would only belong to ALPHA.
    // We use COUNT(*) in BETA's context — if RLS is correct, BETA sees only
    // BETA's rows. If alphaRows > 0, we specifically check BETA sees none of
    // the total (since test workspaces are seeded with non-overlapping data).
    // Predicate: cross_read_count = rows visible to BETA that ALPHA "owns"
    // = COUNT(*) in BETA where the workspace association is alpha.
    const crossReadCount = await withWorkspace(betaWorkspaceId, async (tx) => {
      // Use a subquery to count rows that, by the policy predicate, are ALPHA-owned.
      // For direct tables: count where workspace_id = alpha. For FK tables: count
      // where the parent's workspace_id = alpha. This proves BETA cannot see them.
      if (entry.type === 'direct' || entry.type === 'dual') {
        const result = await tx.$queryRawUnsafe<[{ count: bigint }]>(
          `SELECT COUNT(*) AS count FROM ${table} WHERE ${entry.wsCol} = $1::uuid`,
          alphaWorkspaceId,
        )
        return Number(result[0]?.count ?? 0)
      }
      if (entry.type === 'fk') {
        const result = await tx.$queryRawUnsafe<[{ count: bigint }]>(
          `SELECT COUNT(*) AS count FROM ${table} t
           JOIN ${entry.parentTable} p ON p.id = t.${entry.joinCol}
           WHERE p.${entry.parentWsCol} = $1::uuid`,
          alphaWorkspaceId,
        )
        return Number(result[0]?.count ?? 0)
      }
      if (entry.type === 'fk2hop') {
        const result = await tx.$queryRawUnsafe<[{ count: bigint }]>(
          `SELECT COUNT(*) AS count FROM ${table} t
           JOIN ${entry.hop1Table} h1 ON h1.id = t.${entry.hop1JoinCol}
           JOIN ${entry.hop2Table} h2 ON h2.id = h1.${entry.hop2JoinCol}
           WHERE h2.${entry.hop2WsCol} = $1::uuid`,
          alphaWorkspaceId,
        )
        return Number(result[0]?.count ?? 0)
      }
      return 0
    })

    // (iii) Context-less: must return 0 (fail-closed) after FORCE RLS is applied.
    //
    // M2 (Shreya / deploy-mechanics note): this check runs on bare rlsPrisma with no
    // workspace context. Before FORCE (runbook STEP 4), the postgres owner role bypasses
    // RLS, so this count returns the FULL table count — the probe correctly returns RED,
    // which blocks FORCE (the intended behavior). After FORCE (runbook STEP 6 re-run),
    // the owner is subject to RLS and context-less returns 0 → GREEN predicate satisfied.
    // Conclusion: the probe must run as (a) a non-owner role that is already subject to
    // RLS at STEP 4 for a meaningful GREEN pre-FORCE check, OR (b) after FORCE at STEP 6.
    // At STEP 4, this check is expected to be RED for the owner; that is correct and
    // intentional — it prevents premature FORCE. Tanvi to confirm the probe role at deploy.
    const contextlessCount = await rlsPrisma.$queryRawUnsafe<[{ count: bigint }]>(
      `SELECT COUNT(*) AS count FROM ${table}`,
    ).then((r) => Number(r[0]?.count ?? 0))

    const verdict: ProbeTableVerdict =
      crossReadCount === 0 && contextlessCount === 0 ? 'GREEN' : 'RED'

    return {
      table,
      crossReadCount,
      contextlessCount,
      alphaCount: alphaRows,
      verdict,
    }
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

// -----------------------------------------------------------------------
// Full probe run
// -----------------------------------------------------------------------

export async function runRlsProbe(opts: {
  alphaWorkspaceId: string
  betaWorkspaceId: string
  runId?: string
}): Promise<ProbeRunResult> {
  const { alphaWorkspaceId, betaWorkspaceId } = opts
  const runId = opts.runId ?? `probe-${Date.now()}`
  const ts = new Date().toISOString()
  const correlationId = getCorrelation()

  const tableResults: ProbeTableResult[] = []

  // Run per-table probes sequentially to avoid connection contention during deploy
  for (const entry of PROBE_TABLES) {
    const result = await probeTable(entry, alphaWorkspaceId, betaWorkspaceId)
    tableResults.push(result)
  }

  const overallVerdict: ProbeTableVerdict = tableResults.every(
    (r) => r.verdict === 'GREEN',
  )
    ? 'GREEN'
    : 'RED'

  const run: ProbeRunResult = {
    runId,
    ts,
    overallVerdict,
    tableResults,
    correlationId,
  }

  // Decision-Log write: append to audit_logs under SUPERADMIN context
  // (audit_logs itself is RLS-protected — use withSuperadmin to write system rows)
  await writeProbeDecisionLog(run)

  return run
}

// -----------------------------------------------------------------------
// Decision-Log write (CF-SEC-1 + CF-C1-AUDITLOG-1.a)
// -----------------------------------------------------------------------

async function writeProbeDecisionLog(run: ProbeRunResult): Promise<void> {
  try {
    await withSuperadmin(async (tx) => {
      // Write to audit_logs as a system event (workspace_id = null)
      // userId = a synthetic probe-system UUID so the NOT NULL constraint holds.
      // We use a well-known probe system user ID (must exist in the users table
      // or be relaxed — in test environments, use the SUPERADMIN user id).
      await tx.$executeRaw`
        INSERT INTO audit_logs (id, workspace_id, user_id, action, entity_type, entity_id, metadata, created_at)
        VALUES (
          gen_random_uuid(),
          NULL,
          '00000000-0000-0000-0000-000000000001'::uuid,
          'rls.probe.transition',
          'rls_probe',
          ${run.runId}::text,
          ${JSON.stringify({
            verdict: run.overallVerdict,
            runId: run.runId,
            ts: run.ts,
            correlationId: run.correlationId,
            tableCount: run.tableResults.length,
            redTables: run.tableResults
              .filter((r) => r.verdict === 'RED')
              .map((r) => r.table),
          })}::jsonb,
          NOW()
        )
      `
    })
  } catch (err) {
    // Decision-Log write failure must NOT suppress the probe result;
    // log it and continue so the probe verdict is still returned.
    console.error('[rls-probe] Failed to write Decision-Log entry:', err)
  }
}

// -----------------------------------------------------------------------
// Format probe result for stdout (used by rollout runbook)
// -----------------------------------------------------------------------

export function formatProbeResult(run: ProbeRunResult): string {
  const lines: string[] = [
    `RLS PROBE ${run.ts} run=${run.runId} VERDICT=${run.overallVerdict}`,
    `Correlation: requestId=${run.correlationId.requestId} workspaceId=${run.correlationId.workspaceId ?? 'unset'}`,
    '',
    'Table Results:',
  ]
  for (const r of run.tableResults) {
    const icon = r.verdict === 'GREEN' ? 'OK' : 'FAIL'
    lines.push(
      `  [${icon}] ${r.table.padEnd(45)} alpha=${r.alphaCount} cross=${r.crossReadCount} ctxless=${r.contextlessCount}${r.errorMessage ? ` ERROR: ${r.errorMessage}` : ''}`,
    )
  }
  if (run.overallVerdict === 'RED') {
    lines.push('')
    lines.push('FAILED TABLES (cross_read or contextless != 0):')
    for (const r of run.tableResults.filter((t) => t.verdict === 'RED')) {
      lines.push(`  - ${r.table}`)
    }
  }
  return lines.join('\n')
}
