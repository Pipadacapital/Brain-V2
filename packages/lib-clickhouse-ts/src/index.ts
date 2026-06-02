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

// SQL keywords that can immediately follow a table reference — used to avoid
// mistaking them for a table alias when deciding where FINAL goes.
const POST_TABLE_KEYWORDS =
  'ON|USING|WHERE|GROUP|ORDER|LIMIT|HAVING|PREWHERE|SETTINGS|FORMAT|UNION|JOIN|LEFT|RIGHT|INNER|FULL|CROSS|ANY|ALL|SEMI|ANTI|ASOF|GLOBAL|ARRAY|SAMPLE|FINAL'

/** Add FINAL to fact-table references when missing (ReplacingMergeTree dedup). */
function decorateWithFinal(sql: string): string {
  // Decorate BOTH `FROM` and `JOIN` references to fact tables (a JOINed RMT
  // table needs FINAL too, else it reads un-merged duplicate versions — e.g.
  // order_facts JOINed without FINAL doubled new-customer revenue).
  //
  // FINAL must go AFTER the table's optional alias: ClickHouse parses
  // `FROM t AS o FINAL` and `FROM t o FINAL`, but `FROM t FINAL AS o` is a
  // SYNTAX_ERROR. We match the table ref + an optional alias (an identifier
  // that is NOT `AS` or a SQL keyword, so `JOIN t ON ...` / `FROM t WHERE ...`
  // don't swallow ON/WHERE), then use a function replacer to append FINAL only
  // when it is not already present (idempotent).
  const tableAlt = [...FACT_TABLES].join('|')
  const re = new RegExp(
    `\\b(?:FROM|JOIN)\\s+(?:brain\\.)?(?:${tableAlt})\\b` + // FROM/JOIN [brain.]table
      `(?:\\s+(?:AS\\s+)?(?!(?:AS|${POST_TABLE_KEYWORDS})\\b)[A-Za-z_]\\w*)?`, // optional alias
    'gi',
  )
  return sql.replace(re, (match, offset: number, str: string) => {
    // Idempotent: if FINAL already follows this table reference, leave it.
    if (/^\s+FINAL\b/i.test(str.slice(offset + match.length))) return match
    return `${match} FINAL`
  })
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
