/**
 * Ads integration routes.
 *
 * Ported verbatim from:
 *   app/api/integrations/ads/backfill/route.ts -> POST /backfill
 *
 * Auth pattern A (requireWorkspaceAdmin): requireAuth route middleware +
 * requireWorkspaceAdmin(req.auth!.userId, workspaceId).
 */
import { Router } from 'express'
import { prisma } from '@/lib/prisma'
import { requireWorkspaceAdmin } from '@/lib/integrations/helpers'
import { syncMetaAdsForConnection } from '@/lib/integrations/meta-sync'
import { syncGoogleAdsForConnection } from '@/lib/integrations/google-sync'
import { withWorkspace } from '@/lib/rls-prisma'
import { asyncHandler } from '../../utils/async-handler'
import { requireAuth } from '../../middleware/auth'
import { queryParam } from '../../utils/query'

export const adsIntegrationRouter: Router = Router()

/**
 * POST: Run 730-day (configurable) backfill for Meta Ads + Google Ads for a workspace.
 * Query:
 * - workspaceId (required)
 * - provider (optional): omit or `all` — Meta then Google (legacy). `meta` — Meta only. `google` — Google only.
 * Admin/Owner of the workspace only.
 */
adsIntegrationRouter.post(
  '/backfill',
  requireAuth,
  asyncHandler(async (req, res) => {
    const workspaceId = queryParam(req, 'workspaceId')
    if (!workspaceId) {
      return res.status(400).json(
        { error: 'Missing workspaceId query parameter' }
      )
    }

    const providerRaw = queryParam(req, 'provider')
    const provider =
      providerRaw === 'meta' || providerRaw === 'google' ? providerRaw : 'all'

    const auth = await requireWorkspaceAdmin(req.auth!.userId, workspaceId)
    if (auth.error) return res.status(auth.error.status).json(auth.error.body)

    const metaConn = await prisma.meta_ads_connections.findUnique({
      where: { workspace_id: workspaceId },
      select: { id: true, status: true },
    })
    const googleConn = await prisma.google_ads_connections.findUnique({
      where: { workspace_id: workspaceId },
      select: { id: true, status: true },
    })

    if (provider === 'meta') {
      if (!metaConn || metaConn.status !== 'CONNECTED') {
        return res.status(404).json(
          { error: 'No connected Meta Ads account for this workspace.' }
        )
      }
    } else if (provider === 'google') {
      if (!googleConn || googleConn.status !== 'CONNECTED') {
        return res.status(404).json(
          { error: 'No connected Google Ads account for this workspace.' }
        )
      }
    } else if (!metaConn && !googleConn) {
      return res.status(404).json(
        { error: 'No Meta or Google Ads connection for this workspace' }
      )
    }

    const results: { meta?: { rowsSynced: number }; google?: { rowsSynced: number }; error?: string } = {}

    const runMeta =
      provider === 'all' || provider === 'meta'
        ? metaConn?.status === 'CONNECTED'
        : false
    const runGoogle =
      provider === 'all' || provider === 'google'
        ? googleConn?.status === 'CONNECTED'
        : false

    if (runMeta && metaConn) {
      try {
        const metaResult = await withWorkspace(workspaceId, (tx) =>
          syncMetaAdsForConnection(metaConn.id, { backfill: true }, tx),
        )
        results.meta = { rowsSynced: metaResult.rowsSynced }
        if (process.env.NODE_ENV === 'development') {
          console.log(`[Ads backfill] Meta workspace ${workspaceId}: ${metaResult.rowsSynced} rows`)
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        if (process.env.NODE_ENV === 'development') {
          console.error('[Ads backfill] Meta failed:', msg)
        }
        results.error = `Meta: ${msg}`
      }
    }

    if (runGoogle && googleConn) {
      try {
        const googleResult = await withWorkspace(workspaceId, (tx) =>
          syncGoogleAdsForConnection(googleConn.id, { backfill: true }, tx),
        )
        results.google = { rowsSynced: googleResult.rowsSynced }
        if (process.env.NODE_ENV === 'development') {
          console.log(`[Ads backfill] Google workspace ${workspaceId}: ${googleResult.rowsSynced} rows`)
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        if (process.env.NODE_ENV === 'development') {
          console.error('[Ads backfill] Google failed:', msg)
        }
        results.error = results.error ? `${results.error}; Google: ${msg}` : `Google: ${msg}`
      }
    }

    return res.json({
      success: !results.error,
      workspaceId,
      provider,
      ...results,
    })
  })
)
