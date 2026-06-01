/**
 * @brain/lib-clickhouse-ts — the Node-side analog of pylibs/brain_clickhouse.
 *
 * @paradigm sql (deterministic; no LLM)
 *
 * Single TS entry point to the local ClickHouse OLAP store. Enforces the same
 * three contracts the Python gateway does (per docs/data-architecture-plan-v2.md §4.3):
 *
 *   1. workspace_id is bound as a PARAMETER — never string-interpolated.
 *   2. The SQL's predicates MUST reference workspace_id (lint-time + defensive
 *      runtime check). A workspace-less query throws — never silently scans all.
 *   3. Fact-table reads are decorated with FINAL so ReplacingMergeTree(version)
 *      returns the latest row per unique key.
 *
 * This is local-dev only — production uses the canonical Python analytics-service
 * gateway over gRPC. Identical contract, identical numbers; the local TS copy is
 * deleted at the Phase-2-canon split (Founder note Q6, v2 §10).
 */

import { createClient, type ClickHouseClient } from '@clickhouse/client'

// ---------------------------------------------------------------------------
// Client (singleton, lazy)
// ---------------------------------------------------------------------------

let _client: ClickHouseClient | null = null

function client(): ClickHouseClient {
  if (_client) return _client
  _client = createClient({
    url: process.env.CLICKHOUSE_URL ?? 'http://localhost:8123',
    username: process.env.CLICKHOUSE_USER ?? 'brain_app',
    password: process.env.CLICKHOUSE_PASSWORD ?? 'brain_app_pw',
    database: process.env.CLICKHOUSE_DATABASE ?? 'brain',
    application: 'brain-local-dev',
    // BigInts must survive the wire so integer minor units don't get clipped to JS Number.
    clickhouse_settings: {
      output_format_json_quote_64bit_integers: 1,
      // Dashboard-read query timeout (canon: max_execution_time=30s) — caps the
      // blast radius of a pathological/unbounded read so one query can't pin CH.
      max_execution_time: 30,
    },
  })
  return _client
}

// Fact tables that should be decorated with FINAL on read (ReplacingMergeTree).
const FACT_TABLES = new Set([
  'connector_order_facts',
  'connector_line_item_facts',
  'connector_product_facts',
  'connector_variant_facts',
  'connector_ad_spend_facts',
  'connector_ad_creative_facts',
  'connector_ad_funnel_facts',
  'connector_shipment_facts',
  'connector_refund_facts',
  'connector_logistics_order_facts',
  'connector_email_send_facts',
  'workspace_daily_metrics_legacy',
  'shopify_analytics_daily',
  'product_daily_aggregates',
])

// ---------------------------------------------------------------------------
// Contract enforcement
// ---------------------------------------------------------------------------

class UnscopedClickHouseQueryError extends Error {
  constructor(reason: string) {
    super(`UnscopedClickHouseQueryError: ${reason}`)
    this.name = 'UnscopedClickHouseQueryError'
  }
}

/** Lint-time-ish check that the SQL references workspace_id as a predicate. */
function assertScoped(sql: string): void {
  // Allow either `workspace_id = {workspace_id:String}` (named-param) or `... = $1`.
  // A bare `workspace_id` without an = predicate is rejected.
  if (!/workspace_id\s*=\s*[\{$:]/.test(sql)) {
    throw new UnscopedClickHouseQueryError(
      'SQL must filter on workspace_id (e.g. "WHERE workspace_id = {workspace_id:String}")',
    )
  }
}

/** Add FINAL to fact-table references when missing (ReplacingMergeTree dedup). */
function decorateWithFinal(sql: string): string {
  // Walk the FACT_TABLES set; insert FINAL after `FROM brain.<table>` or `FROM <table>`
  // when no `FINAL` already follows. Conservative — only matches the literal table name.
  let out = sql
  for (const t of FACT_TABLES) {
    const re = new RegExp(`(\\bFROM\\s+(?:brain\\.)?${t})(?!\\s+FINAL)\\b`, 'gi')
    out = out.replace(re, '$1 FINAL')
  }
  return out
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface ChQueryOpts {
  workspaceId: string
  params?: Record<string, unknown>
  /** Skip FINAL decoration (e.g. when reading the legacy_aggregates tables that are
      compacted offline). Default false. */
  skipFinal?: boolean
}

/**
 * Run a scoped, fact-aware SELECT against the local ClickHouse OLAP plane.
 * Returns rows of `T` (caller asserts shape). BigInt-safe — CH returns 64-bit ints
 * as strings via the json_quote_64bit_integers setting; cast at the call site.
 */
export async function chQuery<T = Record<string, unknown>>(
  sql: string,
  opts: ChQueryOpts,
): Promise<T[]> {
  if (!opts.workspaceId) {
    throw new UnscopedClickHouseQueryError('workspaceId is required')
  }
  assertScoped(sql)
  const finalSql = opts.skipFinal === true ? sql : decorateWithFinal(sql)

  const result = await client().query({
    query: finalSql,
    query_params: { workspace_id: opts.workspaceId, ...(opts.params ?? {}) },
    format: 'JSONEachRow',
  })
  return result.json<T>()
}

/** Test-only: dispose the singleton client (for graceful shutdown / hot-reload). */
export async function _closeChClient(): Promise<void> {
  if (_client) {
    await _client.close()
    _client = null
  }
}

export { UnscopedClickHouseQueryError }
