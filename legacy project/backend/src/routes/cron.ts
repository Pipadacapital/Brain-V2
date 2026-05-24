/**
 * Cron sync routes.
 *
 * Ported verbatim from app/api/cron/sync-ads/route.ts.
 *
 * The original `x-cron-secret` header check is replaced by the
 * requireCronSecret route middleware.
 *
 * CF-C1-CRON-SCOPE-1.a: every cross-workspace fan-out is now session-scoped:
 *   - Outer enumeration: withSuperadmin (reads all connections across workspaces)
 *   - Per-connection sync: withWorkspace(c.workspaceId) sets the RLS context
 *   - proof-of-attempt logging: every CONNECTED connection logs ok/failed
 *   - per-connection try/catch: one failure does NOT skip others
 *
 * CF-SEC-5: correlation 4-tuple (requestId, traceId, workspaceId, userId)
 * is set on the cron tick's ALS context from the incoming cron-secret request.
 */
import { Router } from 'express'
import { syncAllMetaAds } from '@/lib/integrations/meta-sync'
import { syncAllGoogleAds } from '@/lib/integrations/google-sync'
import { syncAllShiprocket } from '@/lib/integrations/shiprocket-sync'
import { syncOrders, syncProducts, syncCustomers } from '@/lib/shopify/sync'
import {
  syncShopifyAnalyticsFromOrders,
  syncShopifySessionsFromShopifyQL,
} from '@/lib/shopify/analytics-sync'
import { prisma } from '@/lib/prisma'
import { withWorkspace, withSuperadmin, getCorrelation, correlationStore } from '@/lib/rls-prisma'
import { recomputeProductDailyAggregate } from '@/lib/products/daily-aggregate-recompute'
import { requireCronSecret } from '../middleware/cron-secret'
import { asyncHandler } from '../utils/async-handler'
import { randomUUID } from 'crypto'

export const cronRouter: Router = Router()

/**
 * Hourly cron: syncs Google Ads and Meta Ads for the last N days (upsert by date),
 * syncs all Shiprocket orders + shipments, and syncs Shopify products/orders/customers.
 *
 * Using 5 days for ads so we re-fetch recent days every run; Meta/Google often have
 * 24–48h reporting delay, so yesterday's data may appear late. A larger window ensures
 * we pick it up when it becomes available.
 *
 * Schedule: e.g. 0 * * * * curl -X POST -H "x-cron-secret: $CRON_SECRET" https://your-app.com/api/cron/sync-ads
 */
const CRON_SYNC_DAYS = 5

cronRouter.post(
  '/sync-ads',
  requireCronSecret,
  asyncHandler(async (req, res) => {
    // CF-SEC-5: seed correlation context for the cron tick
    const requestId = (typeof req.headers['x-request-id'] === 'string' ? req.headers['x-request-id'] : null) ?? randomUUID()
    const traceId = (typeof req.headers['x-trace-id'] === 'string' ? req.headers['x-trace-id'] : null) ?? requestId

    return correlationStore.run(
      { requestId, traceId, workspaceId: null, userId: null },
      async () => {
        const results: Record<string, string> = {}

        try {
          await syncAllMetaAds(CRON_SYNC_DAYS)
          results.meta = 'ok'
        } catch (err) {
          results.meta = err instanceof Error ? err.message : 'failed'
        }

        try {
          await syncAllGoogleAds(CRON_SYNC_DAYS)
          results.google = 'ok'
        } catch (err) {
          results.google = err instanceof Error ? err.message : 'failed'
        }

        try {
          await syncAllShiprocket({ days: 1 })
          results.shiprocket = 'ok'
        } catch (err) {
          results.shiprocket = err instanceof Error ? err.message : 'failed'
        }

        try {
          // CF-C1-CRON-SCOPE-1.a: Shopify outer enumeration under SUPERADMIN context.
          // ShopifyConnection is Group A — after FORCE RLS, an unscoped findMany
          // would return 0 rows. withSuperadmin lets the cron enumerate all connections.
          const connections = await withSuperadmin(async (tx) => {
            return tx.$queryRaw<Array<{ id: string; workspaceId: string }>>`
              SELECT id, workspace_id as "workspaceId"
              FROM shopify_connections
              WHERE status = 'CONNECTED' AND access_token IS NOT NULL
            `
          })

          const totalConnected = connections.length
          let attempted = 0

          for (const c of connections) {
            const correlation4 = getCorrelation()
            attempted++
            try {
              const today = new Date()
              const to = today.toISOString().slice(0, 10)
              const fromDate = new Date(today)
              fromDate.setDate(fromDate.getDate() - (CRON_SYNC_DAYS - 1))
              const from = fromDate.toISOString().slice(0, 10)

              // CF-C1-CRON-SCOPE-1.a: per-connection sync runs inside withWorkspace.
              // The tx handle is the RLS-scoped client; writes to Group A tables
              // (shopify_connections) must use tx, not the bare prisma singleton.
              await withWorkspace(c.workspaceId, async (tx) => {
                await Promise.all([
                  syncOrders(c.id),
                  syncProducts(c.id),
                  syncCustomers(c.id),
                ])
                const { daysUpserted } = await syncShopifyAnalyticsFromOrders(c.id, from, to)

                try {
                  await recomputeProductDailyAggregate(
                    prisma,
                    c.id,
                    new Date(`${from}T00:00:00.000Z`),
                    new Date(`${to}T23:59:59.999Z`),
                  )
                } catch {
                  // Best-effort; aggregates can be re-computed on the next cron tick.
                }
                try {
                  await syncShopifySessionsFromShopifyQL(c.id, from, to)
                } catch {
                  // Sessions/conversion optional
                }
                // Update lastSyncAt via tx — shopify_connections is Group A
                // (RLS-protected). After FORCE RLS, the bare prisma singleton has
                // no app.workspace_id and this write would be rejected by WITH CHECK.
                await tx.shopifyConnection.update({
                  where: { id: c.id },
                  data: { lastSyncAt: new Date() },
                })

                if (process.env.NODE_ENV === 'development') {
                  const [latestOrder, latestAnalytics] = await Promise.all([
                    prisma.shopifyOrder.findFirst({ where: { connectionId: c.id }, orderBy: { processedAt: 'desc' }, select: { processedAt: true } }),
                    prisma.shopifyAnalyticsDaily.findFirst({ where: { connectionId: c.id }, orderBy: { date: 'desc' }, select: { date: true } }),
                  ])
                  console.log('[cron/sync-ads] Shopify sync diagnostic', {
                    connectionId: c.id,
                    analyticsRowsWritten: daysUpserted,
                    latestShopifyOrderDate: latestOrder?.processedAt?.toISOString().slice(0, 10) ?? null,
                    latestShopifyAnalyticsDailyDate: latestAnalytics?.date?.toISOString().slice(0, 10) ?? null,
                  })
                }
              })

              // proof-of-attempt: ok
              console.info(JSON.stringify({
                msg: 'cron.sync.attempted',
                connector: 'shopify',
                connectionId: c.id,
                workspaceId: c.workspaceId,
                status: 'ok',
                requestId: correlation4.requestId,
                traceId: correlation4.traceId,
              }))
            } catch (err) {
              // proof-of-attempt: failed — continues to next connection
              const message = err instanceof Error ? err.message : String(err)
              console.error(JSON.stringify({
                msg: 'cron.sync.attempted',
                connector: 'shopify',
                connectionId: c.id,
                workspaceId: c.workspaceId,
                status: 'failed',
                error: message,
                requestId: correlation4.requestId,
                traceId: correlation4.traceId,
              }))
            }
          }

          if (attempted < totalConnected) {
            console.error(JSON.stringify({
              msg: 'cron.sync.alarm.silent_skip',
              connector: 'shopify',
              attempted,
              totalConnected,
            }))
          }

          results.shopify = 'ok'
        } catch (err) {
          results.shopify = err instanceof Error ? err.message : 'failed'
        }

        return res.json({ results })
      },
    )
  }),
)

/**
 * Standalone refresher for `product_daily_aggregates`. Defaults to the last
 * 7 days if no `days` query param is given. Safe to run every 15-30 minutes
 * to catch any webhook updates the rolling sync-ads job missed.
 *
 *   curl -X POST -H "x-cron-secret: $CRON_SECRET" \
 *     "https://your-app.com/api/cron/recompute-product-daily-aggregates?days=7"
 */
cronRouter.post(
  '/recompute-product-daily-aggregates',
  requireCronSecret,
  asyncHandler(async (req, res) => {
    // CF-SEC-5: seed correlation context
    const requestId = (typeof req.headers['x-request-id'] === 'string' ? req.headers['x-request-id'] : null) ?? randomUUID()
    const traceId = (typeof req.headers['x-trace-id'] === 'string' ? req.headers['x-trace-id'] : null) ?? requestId

    return correlationStore.run(
      { requestId, traceId, workspaceId: null, userId: null },
      async () => {
        const daysParam = typeof req.query.days === 'string' ? parseInt(req.query.days, 10) : NaN
        const days = Number.isFinite(daysParam) && daysParam > 0 ? Math.min(daysParam, 730) : 7
        const toDate = new Date()
        const fromDate = new Date(toDate)
        fromDate.setUTCDate(fromDate.getUTCDate() - (days - 1))
        fromDate.setUTCHours(0, 0, 0, 0)
        toDate.setUTCHours(23, 59, 59, 999)

        // CF-C1-CRON-SCOPE-1.a: outer enumeration under SUPERADMIN context.
        const connections = await withSuperadmin(async (tx) => {
          return tx.$queryRaw<Array<{ id: string; shopDomain: string; workspaceId: string }>>`
            SELECT id, shop_domain as "shopDomain", workspace_id as "workspaceId"
            FROM shopify_connections
            WHERE status = 'CONNECTED'
          `
        })

        const results: Array<{ connectionId: string; shopDomain: string; inserted: number }> = []
        const totalConnected = connections.length
        let attempted = 0

        for (const c of connections) {
          const correlation4 = getCorrelation()
          attempted++
          try {
            // Per-connection recompute wrapped in withWorkspace so RLS context is set.
            // recomputeProductDailyAggregate uses bare prisma (product_daily_aggregates
            // writes are not yet migrated to the RLS path — tracked for Child 3).
            const { inserted } = await withWorkspace(c.workspaceId, async (_tx) => {
              return recomputeProductDailyAggregate(prisma, c.id, fromDate, toDate)
            })
            results.push({ connectionId: c.id, shopDomain: c.shopDomain, inserted })
            console.info(JSON.stringify({
              msg: 'cron.sync.attempted',
              connector: 'shopify_recompute',
              connectionId: c.id,
              workspaceId: c.workspaceId,
              status: 'ok',
              inserted,
              requestId: correlation4.requestId,
              traceId: correlation4.traceId,
            }))
          } catch (err) {
            const message = err instanceof Error ? err.message : String(err)
            results.push({ connectionId: c.id, shopDomain: c.shopDomain, inserted: -1 })
            console.error(JSON.stringify({
              msg: 'cron.sync.attempted',
              connector: 'shopify_recompute',
              connectionId: c.id,
              workspaceId: c.workspaceId,
              status: 'failed',
              error: message,
              requestId: correlation4.requestId,
              traceId: correlation4.traceId,
            }))
          }
        }

        if (attempted < totalConnected) {
          console.error(JSON.stringify({
            msg: 'cron.sync.alarm.silent_skip',
            connector: 'shopify_recompute',
            attempted,
            totalConnected,
          }))
        }

        return res.json({ days, results })
      },
    )
  }),
)
