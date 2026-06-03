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
    // Client-side request timeout — fast failover. If CH is slow/unreachable the
    // read fails over to PG within this window instead of waiting out the 30s
    // server-side max_execution_time. Overridable via CLICKHOUSE_REQUEST_TIMEOUT_MS.
    request_timeout: Number(process.env.CLICKHOUSE_REQUEST_TIMEOUT_MS ?? 10000),
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

/** Add FINAL to fact-table references when missing (ReplacingMergeTree dedup).
 *  Exported for tests (P1-13) — this regex broke prod twice (FINAL-before-alias
 *  syntax error + un-decorated JOINs double-counting), so it carries a suite. */
export function decorateWithFinal(sql: string): string {
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

/**
 * Liveness probe for the ClickHouse plane — used by the gateway's /ready check.
 * Resolves true when CH answers, false on any error (never throws). Bounded by
 * the client request_timeout so a hung CH can't hang the readiness probe.
 */
export async function pingCh(): Promise<boolean> {
  try {
    const res = await client().ping()
    return res.success === true
  } catch {
    return false
  }
}

// ---------------------------------------------------------------------------
// Allowlist for chInsert — only the fact tables that the realtime-facts-consumer
// is authorised to write. This is a defence-in-depth guard against arbitrary
// table injection (e.g. a malformed Kafka envelope with a user-controlled table
// name).  shared-libs-6 fix.
// ---------------------------------------------------------------------------

/** Bare (unqualified) table names that chInsert is allowed to write to. */
const INSERT_ALLOWED_FACT_TABLES = new Set([
  'connector_order_facts',
  'connector_line_item_facts',
  'connector_ad_spend_facts',
  'connector_shipment_facts',
  'connector_refund_facts',
  'connector_logistics_order_facts',
  'connector_product_facts',
  'connector_variant_facts',
  'connector_ad_creative_facts',
  'connector_ad_funnel_facts',
  'connector_email_send_facts',
])

class ChInsertError extends Error {
  constructor(reason: string) {
    super(`ChInsertError: ${reason}`)
    this.name = 'ChInsertError'
  }
}

/**
 * Insert a batch of rows into a ClickHouse table. Uses JSONEachRow format so each
 * element of `rows` is a plain object matching the target table schema.
 *
 * This is the write companion to `chQuery` — used by the realtime-facts-consumer to
 * upsert Kafka-sourced facts into brain.connector_order_facts / line_item_facts.
 * ReplacingMergeTree(version) handles idempotency — a re-delivered message with a
 * higher `version` wins at the next OPTIMIZE / FINAL read.
 *
 * shared-libs-6 hardening:
 *   1. `table` must be in INSERT_ALLOWED_FACT_TABLES (bare or brain.-prefixed).
 *      Rejects arbitrary table names — defence against Kafka-envelope injection.
 *   2. Every row must contain a `workspace_id` key.
 *      Ensures tenant-scoped writes; rejects un-scoped inserts.
 *
 * @param table  Fully qualified table name, e.g. "brain.connector_order_facts"
 * @param rows   Array of plain objects (keys = column names, values = JS primitives)
 */
export async function chInsert(table: string, rows: Record<string, unknown>[]): Promise<void> {
  if (!rows.length) return

  // 1. Allowlist check — strip the optional `brain.` prefix before checking.
  const bareTable = table.startsWith('brain.') ? table.slice('brain.'.length) : table
  if (!INSERT_ALLOWED_FACT_TABLES.has(bareTable)) {
    throw new ChInsertError(
      `table "${table}" is not in the INSERT_ALLOWED_FACT_TABLES allowlist. ` +
      'Add it explicitly if this is a new fact table (shared-libs-6).',
    )
  }

  // 2. workspace_id column required on every row — no un-scoped writes.
  for (let i = 0; i < rows.length; i++) {
    if (!Object.prototype.hasOwnProperty.call(rows[i], 'workspace_id')) {
      throw new ChInsertError(
        `row[${i}] is missing workspace_id (table="${table}"). ` +
        'Every fact-table insert must carry workspace_id for tenant isolation (shared-libs-6).',
      )
    }
  }

  await client().insert({
    table,
    values: rows,
    format: 'JSONEachRow',
  })
}

export { ChInsertError }

/** Test-only: dispose the singleton client (for graceful shutdown / hot-reload). */
export async function _closeChClient(): Promise<void> {
  if (_client) {
    await _client.close()
    _client = null
  }
}

export { UnscopedClickHouseQueryError }
