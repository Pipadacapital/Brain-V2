import { prisma } from '@/lib/prisma'
import { withWorkspace, withSuperadmin, getCorrelation } from '@/lib/rls-prisma'
import {
  fetchAdAccountInsights,
  fetchAdAccountAdInsights,
  fetchMetaAdAccountCurrency,
  fetchMetaTokenExpiry,
  type MetaInsightRow,
} from './meta'
import { Prisma } from '@prisma/client'
import {
  buildBackfillWindows,
  backfillStartDate,
  backfillEndDate,
  getBackfillDays,
  INCREMENTAL_SYNC_DAYS,
} from './ads-backfill'

// RLS-scoped transaction client type. Writes to meta_ads_daily_metrics and
// meta_ads_creative_daily (Group B — RLS-protected via connection FK) MUST use
// this client so the app.workspace_id set by withWorkspace() is in scope.
//
// WHY Prisma.TransactionClient: $transaction is overloaded; Parameters<> resolves
// to the batch-array overload and produces `never`. Prisma.TransactionClient is
// the canonical export: Omit<PrismaClient, ITXClientDenyList>.
type PrismaTx = Prisma.TransactionClient

// Chunk size for bulk INSERT...ON CONFLICT batches. Postgres caps parameters
// at 65535; daily_metrics has 15 cols → ~4300 rows max, creative_daily has 21
// cols → ~3100 rows max. 500 is well under both and round-trips Mumbai fast.
const UPSERT_CHUNK = 500

function chunked<T>(arr: T[], size: number): T[][] {
  if (arr.length <= size) return [arr]
  const out: T[][] = []
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size))
  return out
}

export type MetaSyncOptions = {
  /** Number of days to sync (incremental). Default 7. */
  days?: number
  /** If true, sync last 730 days (configurable) in 30-day chunks. */
  backfill?: boolean
}

/**
 * Syncs Meta Ads data for a single connection.
 *
 * @param tx - The RLS-scoped transaction client from withWorkspace(). All writes
 *   to meta_ads_daily_metrics, meta_ads_creative_daily, and meta_ads_connections
 *   (all Group B — RLS-protected) MUST go through this client.
 */
export async function syncMetaAdsForConnection(
  connectionId: string,
  options: MetaSyncOptions | number | undefined,
  tx: PrismaTx,
): Promise<{ rowsSynced: number }> {
  const connection = await tx.meta_ads_connections.findUnique({
    where: { id: connectionId },
  })

  if (!connection || connection.status !== 'CONNECTED') return { rowsSynced: 0 }

  let targetAccounts = connection.selected_ad_account_ids?.length
    ? connection.selected_ad_account_ids
    : connection.selected_ad_account_id
      ? [connection.selected_ad_account_id]
      : []

  if (targetAccounts.length === 0 && connection.ad_account_ids.length === 1) {
    targetAccounts = [connection.ad_account_ids[0]]
    // Write through tx — meta_ads_connections is Group B (RLS-protected).
    await tx.meta_ads_connections.update({
      where: { id: connection.id },
      data: {
        selected_ad_account_ids: targetAccounts,
        selected_ad_account_id: targetAccounts[0],
      },
    })
  }
  if (targetAccounts.length === 0) {
    // Write through tx — meta_ads_connections is Group B (RLS-protected).
    await tx.meta_ads_connections.update({
      where: { id: connection.id },
      data: { last_sync_error: 'Select accounts under manager to sync.' },
    })
    return { rowsSynced: 0 }
  }

  const currencyAccountId = targetAccounts[0]
  if (currencyAccountId) {
    try {
      const currency = await fetchMetaAdAccountCurrency(connection.access_token, currencyAccountId)
      if (currency) {
        // Write through tx — meta_ads_connections is Group B (RLS-protected).
        await tx.meta_ads_connections.update({
          where: { id: connection.id },
          data: { currency },
        })
      }
    } catch {
      // Non-blocking: metrics sync should continue even if account currency fetch fails.
    }
  }

  const opts: MetaSyncOptions =
    options == null ? { days: INCREMENTAL_SYNC_DAYS } : typeof options === 'number' ? { days: options } : options

  const windows: { since: string; until: string }[] = opts.backfill
    ? buildBackfillWindows(backfillStartDate(getBackfillDays()), backfillEndDate(), 30)
    : (() => {
        const end = new Date()
        end.setUTCHours(23, 59, 59, 999)
        const start = new Date(end)
        start.setUTCDate(start.getUTCDate() - (opts.days ?? INCREMENTAL_SYNC_DAYS) + 1)
        start.setUTCHours(0, 0, 0, 0)
        return [{ since: start.toISOString().slice(0, 10), until: end.toISOString().slice(0, 10) }]
      })()

  if (process.env.NODE_ENV === 'development' && windows.length > 1) {
    console.log(`[Meta Ads] Backfill ${windows.length} windows: ${windows[0].since}..${windows[windows.length - 1].until}`)
  }

  const errors: string[] = []
  let rowsSynced = 0

  for (const adAccountId of targetAccounts) {
    for (const { since: sinceStr, until: untilStr } of windows) {
      try {
        if (process.env.NODE_ENV === 'development') {
          console.log(`[Meta Ads] Fetching ${adAccountId} ${sinceStr}..${untilStr}`)
        }
        const rows: MetaInsightRow[] = await fetchAdAccountInsights(
          connection.access_token,
          adAccountId,
          sinceStr,
          untilStr
        )
        if (process.env.NODE_ENV === 'development' && rows.length > 0) {
          console.log(`[Meta Ads] ${adAccountId} ${sinceStr}..${untilStr}: ${rows.length} rows`)
        }
        // Bulk upsert in chunks: single round-trip per chunk instead of one per
        // row. Previously this loop was ~250ms × N rows = the whole 90s sync.
        for (const batch of chunked(rows, UPSERT_CHUNK)) {
          const tuples = batch.map((row) => {
            const dateOnly = row.date.slice(0, 10)
            return Prisma.sql`(
              ${connection.id}::uuid,
              ${adAccountId},
              ${row.campaignId},
              ${row.campaignName},
              ${row.adsetId},
              ${row.adsetName},
              ${dateOnly}::date,
              ${row.impressions},
              ${row.clicks},
              ${row.spend}::numeric,
              ${row.conversions},
              ${row.revenue}::numeric,
              ${row.ctr}::numeric,
              ${row.cpc}::numeric,
              ${row.cpm}::numeric,
              ${JSON.stringify(row.rawJson ?? null)}::jsonb
            )`
          })
          // Write through tx — meta_ads_daily_metrics is Group B (RLS-protected).
          await tx.$executeRaw`
            INSERT INTO meta_ads_daily_metrics (
              connection_id, ad_account_id, campaign_id, campaign_name,
              adset_id, adset_name, date, impressions, clicks, spend,
              conversions, revenue, ctr, cpc, cpm, raw_json
            ) VALUES ${Prisma.join(tuples)}
            ON CONFLICT (connection_id, ad_account_id, campaign_id, date)
            DO UPDATE SET
              campaign_name = EXCLUDED.campaign_name,
              adset_id = EXCLUDED.adset_id,
              adset_name = EXCLUDED.adset_name,
              impressions = EXCLUDED.impressions,
              clicks = EXCLUDED.clicks,
              spend = EXCLUDED.spend,
              conversions = EXCLUDED.conversions,
              revenue = EXCLUDED.revenue,
              ctr = EXCLUDED.ctr,
              cpc = EXCLUDED.cpc,
              cpm = EXCLUDED.cpm,
              raw_json = EXCLUDED.raw_json
          `
          rowsSynced += batch.length
        }
      } catch (err) {
        errors.push(`${adAccountId} ${sinceStr}..${untilStr}: ${err instanceof Error ? err.message : String(err)}`)
      }

      try {
        const adRows = await fetchAdAccountAdInsights(
          connection.access_token,
          adAccountId,
          sinceStr,
          untilStr
        )
        const validRows = adRows.filter((r) => !!r.adId)
        for (const batch of chunked(validRows, UPSERT_CHUNK)) {
          const tuples = batch.map((row) => Prisma.sql`(
            ${connection.id}::uuid,
            ${adAccountId},
            ${row.adId!},
            ${row.adName},
            ${row.campaignId},
            ${row.campaignName},
            ${row.adsetId},
            ${row.adsetName},
            ${row.date}::date,
            ${row.impressions},
            ${row.clicks},
            ${row.spend}::numeric,
            ${row.video3s},
            ${row.thruplay},
            ${row.avgWatchSec}::numeric,
            ${row.p25},
            ${row.p50},
            ${row.p75},
            ${row.p95},
            ${row.conversions},
            ${row.revenue}::numeric,
            ${JSON.stringify(row.rawJson ?? null)}::jsonb
          )`)
          try {
            // Write through tx — meta_ads_creative_daily is Group B (RLS-protected).
            await tx.$executeRaw`
              INSERT INTO meta_ads_creative_daily (
                connection_id, ad_account_id, ad_id, ad_name,
                campaign_id, campaign_name, adset_id, adset_name, date,
                impressions, clicks, spend,
                video_3s_views, video_thruplay, avg_watch_sec,
                video_p25, video_p50, video_p75, video_p95,
                conversions, revenue, raw_json
              ) VALUES ${Prisma.join(tuples)}
              ON CONFLICT (connection_id, ad_account_id, ad_id, date)
              DO UPDATE SET
                ad_name = EXCLUDED.ad_name,
                campaign_name = EXCLUDED.campaign_name,
                adset_id = EXCLUDED.adset_id,
                adset_name = EXCLUDED.adset_name,
                impressions = EXCLUDED.impressions,
                clicks = EXCLUDED.clicks,
                spend = EXCLUDED.spend,
                video_3s_views = EXCLUDED.video_3s_views,
                video_thruplay = EXCLUDED.video_thruplay,
                avg_watch_sec = EXCLUDED.avg_watch_sec,
                video_p25 = EXCLUDED.video_p25,
                video_p50 = EXCLUDED.video_p50,
                video_p75 = EXCLUDED.video_p75,
                video_p95 = EXCLUDED.video_p95,
                conversions = EXCLUDED.conversions,
                revenue = EXCLUDED.revenue,
                raw_json = EXCLUDED.raw_json
            `
            rowsSynced += batch.length
          } catch (batchErr) {
            errors.push(
              `Creative batch ${adAccountId} ${sinceStr}..${untilStr} (${batch.length} rows): ${batchErr instanceof Error ? batchErr.message : String(batchErr)}`
            )
          }
        }
      } catch (adErr) {
        errors.push(
          `Ad creative ${adAccountId} ${sinceStr}..${untilStr}: ${adErr instanceof Error ? adErr.message : String(adErr)}`
        )
      }
    }
  }

  // Refresh token_expires_at from Meta's /debug_token. Meta auto-extends
  // actively-used tokens, so the snapshot we stored at OAuth time drifts.
  // Best-effort: a failure here shouldn't fail the sync.
  let refreshedExpiry: Date | null = null
  try {
    refreshedExpiry = await fetchMetaTokenExpiry(connection.access_token)
  } catch {
    // ignore — keep existing token_expires_at
  }

  // Write through tx — meta_ads_connections is Group B (RLS-protected).
  await tx.meta_ads_connections.update({
    where: { id: connection.id },
    data: {
      last_sync_at: new Date(),
      last_sync_error: errors.length > 0 ? errors.join('; ') : null,
      ...(refreshedExpiry ? { token_expires_at: refreshedExpiry } : {}),
    },
  })
  return { rowsSynced }
}

export type SyncAllMetaAdsResult = {
  connectionId: string
  workspaceId: string
  workspaceName: string
  status: 'ok' | 'failed'
  error?: string
  /** Number of daily metric rows fetched and upserted (no duplicates; existing rows updated). */
  rowsSynced?: number
}

export async function syncAllMetaAds(
  days = INCREMENTAL_SYNC_DAYS,
  options?: { backfill?: boolean }
): Promise<{
  synced: number
  failed: number
  results: SyncAllMetaAdsResult[]
}> {
  // CF-C1-CRON-SCOPE-1.a: outer enumeration under SUPERADMIN context.
  const connections = await withSuperadmin(async (tx) => {
    return tx.$queryRaw<Array<{ id: string; workspace_id: string; name: string | null }>>`
      SELECT mac.id, mac.workspace_id, w.name
      FROM meta_ads_connections mac
      JOIN workspaces w ON w.id = mac.workspace_id
      WHERE mac.status = 'CONNECTED'
    `
  })

  const results: SyncAllMetaAdsResult[] = []
  const syncOpts = options?.backfill ? { backfill: true } : { days }
  const totalConnected = connections.length
  let attempted = 0

  for (const c of connections) {
    const correlation4 = getCorrelation()
    attempted++
    try {
      // CF-C1-CRON-SCOPE-1.a: per-connection unit in withWorkspace. Pass tx so
      // inner writes go through the RLS-scoped client, not the bare :6543 singleton.
      const { rowsSynced } = await withWorkspace(c.workspace_id, async (tx) => {
        return syncMetaAdsForConnection(c.id, syncOpts, tx)
      })
      results.push({
        connectionId: c.id,
        workspaceId: c.workspace_id,
        workspaceName: c.name ?? 'Unknown',
        status: 'ok',
        rowsSynced,
      })
      console.info(JSON.stringify({
        msg: 'cron.sync.attempted',
        connector: 'meta_ads',
        connectionId: c.id,
        workspaceId: c.workspace_id,
        status: 'ok',
        rowsSynced,
        requestId: correlation4.requestId,
        traceId: correlation4.traceId,
      }))
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      console.error(JSON.stringify({
        msg: 'cron.sync.attempted',
        connector: 'meta_ads',
        connectionId: c.id,
        workspaceId: c.workspace_id,
        status: 'failed',
        error: message,
        requestId: correlation4.requestId,
        traceId: correlation4.traceId,
      }))
      results.push({
        connectionId: c.id,
        workspaceId: c.workspace_id,
        workspaceName: c.name ?? 'Unknown',
        status: 'failed',
        error: message,
      })
    }
  }

  if (attempted < totalConnected) {
    console.error(JSON.stringify({
      msg: 'cron.sync.alarm.silent_skip',
      connector: 'meta_ads',
      attempted,
      totalConnected,
    }))
  }

  return {
    synced: results.filter((r) => r.status === 'ok').length,
    failed: results.filter((r) => r.status === 'failed').length,
    results,
  }
}
