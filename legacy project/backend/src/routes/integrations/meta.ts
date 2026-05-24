/**
 * Meta Ads integration routes.
 *
 * Ported verbatim from:
 *   app/api/integrations/meta/start/route.ts            -> GET  /start
 *   app/api/integrations/meta/callback/route.ts         -> GET  /callback
 *   app/api/integrations/meta/sync/route.ts             -> POST /sync
 *   app/api/integrations/meta/disconnect/route.ts       -> POST /disconnect
 *   app/api/integrations/meta/select-accounts/route.ts  -> POST /select-accounts
 *   app/api/integrations/meta/select-account/route.ts   -> POST /select-account
 */
import { Router } from 'express'
import { prisma } from '@/lib/prisma'
import { requireWorkspaceAdmin } from '@/lib/integrations/helpers'
import { generateState, createOAuthState, validateOAuthState } from '@/lib/integrations/oauth-state'
import {
  buildMetaAuthUrl,
  exchangeMetaCode,
  exchangeForLongLivedToken,
  fetchMetaAdAccounts,
  fetchMetaAdAccountCurrency,
  fetchMetaUserId,
} from '@/lib/integrations/meta'
import { syncMetaAdsForConnection } from '@/lib/integrations/meta-sync'
import { withWorkspace } from '@/lib/rls-prisma'
import { asyncHandler } from '../../utils/async-handler'
import { requireAuth } from '../../middleware/auth'
import { queryParam } from '../../utils/query'
import { env } from '../../config/env'

export const metaIntegrationRouter: Router = Router()

metaIntegrationRouter.get(
  '/start',
  requireAuth,
  asyncHandler(async (req, res) => {
    const workspaceId = queryParam(req, 'workspaceId')
    if (!workspaceId) {
      return res.status(400).json({ error: 'Missing workspaceId' })
    }

    const auth = await requireWorkspaceAdmin(req.auth!.userId, workspaceId)
    if (auth.error) return res.status(auth.error.status).json(auth.error.body)

    const state = generateState()

    await createOAuthState({
      provider: 'META',
      workspaceId,
      userId: auth.user.id,
      state,
    })

    const authUrl = buildMetaAuthUrl(state)
    return res.json({ authUrl })
  })
)

metaIntegrationRouter.get(
  '/callback',
  asyncHandler(async (req, res) => {
    const code = queryParam(req, 'code')
    const state = queryParam(req, 'state')
    const errorParam = queryParam(req, 'error')

    if (errorParam) {
      return res.redirect(
        `${env.APP_URL}/?error=meta_auth_denied&reason=${errorParam}`
      )
    }

    if (!code || !state) {
      return res.redirect(`${env.APP_URL}/?error=meta_missing_params`)
    }

    const oauthRecord = await validateOAuthState(state, 'META')
    if (!oauthRecord) {
      return res.redirect(`${env.APP_URL}/?error=meta_invalid_state`)
    }

    const workspace = await prisma.workspace.findUnique({
      where: { id: oauthRecord.workspace_id },
      select: { slug: true, id: true },
    })

    if (!workspace) {
      return res.redirect(`${env.APP_URL}/?error=workspace_not_found`)
    }

    try {
      const { accessToken: shortToken } = await exchangeMetaCode(code)
      const { accessToken, expiresIn } = await exchangeForLongLivedToken(shortToken)

      const tokenExpiresAt = expiresIn
        ? new Date(Date.now() + expiresIn * 1000)
        : null

      // Fetch ad accounts and user ID (best effort)
      let adAccountIds: string[] = []
      let metaUserId: string | null = null
      let currency: string | null = null

      try {
        const accounts = await fetchMetaAdAccounts(accessToken)
        adAccountIds = accounts.map((a) => a.id)
        if (adAccountIds.length > 0) {
          currency = await fetchMetaAdAccountCurrency(accessToken, adAccountIds[0])
        }
      } catch {
        // Will show UI message to reconfigure
      }

      try {
        metaUserId = await fetchMetaUserId(accessToken)
      } catch {
        // Non-critical
      }

      const now = new Date()
      await prisma.meta_ads_connections.upsert({
        where: { workspace_id: workspace.id },
        create: {
          workspace_id: workspace.id,
          access_token: accessToken,
          token_expires_at: tokenExpiresAt,
          scopes: ['ads_management', 'ads_read', 'business_management', 'read_insights'],
          ad_account_ids: adAccountIds,
          currency: currency ?? 'USD',
          meta_user_id: metaUserId,
          status: 'CONNECTED',
          updated_at: now,
        },
        update: {
          access_token: accessToken,
          token_expires_at: tokenExpiresAt,
          scopes: ['ads_management', 'ads_read', 'business_management', 'read_insights'],
          ad_account_ids: adAccountIds,
          currency: currency ?? 'USD',
          meta_user_id: metaUserId,
          status: 'CONNECTED',
          last_sync_error: null,
          updated_at: now,
        },
      })

      return res.redirect(`${env.APP_URL}/w/${workspace.slug}/dashboard`)
    } catch (error) {
      console.error('Meta OAuth callback error:', error)
      return res.redirect(
        `${env.APP_URL}/w/${workspace.slug}/dashboard?error=meta_connection_failed`
      )
    }
  })
)

metaIntegrationRouter.post(
  '/sync',
  requireAuth,
  asyncHandler(async (req, res) => {
    let body: { workspaceId: string }
    try {
      body = req.body
    } catch {
      return res.status(400).json({ error: 'Invalid body' })
    }

    if (!body.workspaceId) {
      return res.status(400).json({ error: 'Missing workspaceId' })
    }

    const auth = await requireWorkspaceAdmin(req.auth!.userId, body.workspaceId)
    if (auth.error) return res.status(auth.error.status).json(auth.error.body)

    const connection = await prisma.meta_ads_connections.findUnique({
      where: { workspace_id: body.workspaceId },
      select: { id: true, status: true },
    })

    if (!connection || connection.status !== 'CONNECTED') {
      return res.status(404).json({ error: 'No active Meta Ads connection' })
    }

    // Fire-and-forget: a full sync can take 60-90s even after batching, which
    // exceeds typical browser/proxy timeouts and surfaces as "Sync failed" in
    // the UI. syncMetaAdsForConnection persists progress to
    // meta_ads_connections.{last_sync_at,last_sync_error}, which the
    // integrations page reads on reload — so 202 + reload is enough UX.
    void withWorkspace(body.workspaceId, (tx) =>
      syncMetaAdsForConnection(connection.id, undefined, tx),
    ).catch((error) => {
      console.error(`[Meta Ads] background sync failed for ${connection.id}:`, error)
      void prisma.meta_ads_connections
        .update({
          where: { id: connection.id },
          data: {
            last_sync_at: new Date(),
            last_sync_error: error instanceof Error ? error.message : String(error),
          },
        })
        .catch(() => {})
    })

    return res.status(202).json({ accepted: true })
  })
)

metaIntegrationRouter.post(
  '/disconnect',
  requireAuth,
  asyncHandler(async (req, res) => {
    let body: { workspaceId: string }
    try {
      body = req.body
    } catch {
      return res.status(400).json({ error: 'Invalid body' })
    }

    if (!body.workspaceId) {
      return res.status(400).json({ error: 'Missing workspaceId' })
    }

    const auth = await requireWorkspaceAdmin(req.auth!.userId, body.workspaceId)
    if (auth.error) return res.status(auth.error.status).json(auth.error.body)

    await prisma.meta_ads_connections.updateMany({
      where: { workspace_id: body.workspaceId, status: 'CONNECTED' },
      data: { status: 'DISCONNECTED', access_token: '', updated_at: new Date() },
    })

    return res.json({ success: true })
  })
)

metaIntegrationRouter.post(
  '/select-accounts',
  requireAuth,
  asyncHandler(async (req, res) => {
    const body = req.body
    const { workspaceId, selectedAdAccountIds } = body as {
      workspaceId?: string
      selectedAdAccountIds?: string[]
    }

    if (!workspaceId || !Array.isArray(selectedAdAccountIds) || selectedAdAccountIds.length === 0) {
      return res.status(400).json({
        error: 'workspaceId and selectedAdAccountIds[] are required',
      })
    }

    const result = await requireWorkspaceAdmin(req.auth!.userId, workspaceId)
    if (result.error) return res.status(result.error.status).json(result.error.body)

    const connection = await prisma.meta_ads_connections.findUnique({
      where: { workspace_id: workspaceId },
      select: { id: true, ad_account_ids: true, status: true },
    })

    if (!connection || connection.status !== 'CONNECTED') {
      return res.status(404).json({ error: 'No active Meta Ads connection found' })
    }

    const invalid = selectedAdAccountIds.filter((id) => !connection.ad_account_ids.includes(id))
    if (invalid.length > 0) {
      return res.status(400).json({
        error: `These account IDs are not available: ${invalid.join(', ')}`,
      })
    }

    await prisma.meta_ads_connections.update({
      where: { id: connection.id },
      data: {
        selected_ad_account_ids: selectedAdAccountIds,
        selected_ad_account_id: selectedAdAccountIds.length === 1 ? selectedAdAccountIds[0] : null,
        updated_at: new Date(),
      },
    })

    return res.json({ ok: true, selectedAdAccountIds })
  })
)

metaIntegrationRouter.post(
  '/select-account',
  requireAuth,
  asyncHandler(async (req, res) => {
    const body = req.body
    const { workspaceId, selectedAdAccountId } = body as {
      workspaceId?: string
      selectedAdAccountId?: string
    }

    if (!workspaceId || !selectedAdAccountId) {
      return res.status(400).json({
        error: 'workspaceId and selectedAdAccountId are required',
      })
    }

    const result = await requireWorkspaceAdmin(req.auth!.userId, workspaceId)
    if (result.error) return res.status(result.error.status).json(result.error.body)

    const connection = await prisma.meta_ads_connections.findUnique({
      where: { workspace_id: workspaceId },
      select: { id: true, ad_account_ids: true, status: true },
    })

    if (!connection || connection.status !== 'CONNECTED') {
      return res.status(404).json({ error: 'No active Meta Ads connection found' })
    }

    if (!connection.ad_account_ids.includes(selectedAdAccountId)) {
      return res.status(400).json({
        error: 'Selected ad account is not in the list of connected accounts',
      })
    }

    await prisma.meta_ads_connections.update({
      where: { id: connection.id },
      data: { selected_ad_account_id: selectedAdAccountId, updated_at: new Date() },
    })

    return res.json({ ok: true, selectedAdAccountId })
  })
)
