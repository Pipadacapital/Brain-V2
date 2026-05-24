/**
 * Google Ads integration routes.
 *
 * Ported verbatim from:
 *   app/api/integrations/google/start/route.ts             -> GET  /start
 *   app/api/integrations/google/callback/route.ts          -> GET  /callback
 *   app/api/integrations/google/sync/route.ts              -> POST /sync
 *   app/api/integrations/google/disconnect/route.ts        -> POST /disconnect
 *   app/api/integrations/google/refresh-accounts/route.ts  -> POST /refresh-accounts
 *   app/api/integrations/google/select-customer/route.ts   -> POST /select-customer
 *   app/api/integrations/google/select-customers/route.ts  -> POST /select-customers
 */
import { Router } from 'express'
import { prisma } from '@/lib/prisma'
import { requireWorkspaceAdmin } from '@/lib/integrations/helpers'
import { generateState, createOAuthState, validateOAuthState } from '@/lib/integrations/oauth-state'
import {
  buildGoogleAuthUrl,
  exchangeGoogleCode,
  listAccessibleCustomers,
  listManagerChildAccounts,
  fetchGoogleUserEmail,
  fetchGoogleCustomerCurrency,
  refreshGoogleAccessToken,
} from '@/lib/integrations/google'
import { syncGoogleAdsForConnection } from '@/lib/integrations/google-sync'
import { withWorkspace } from '@/lib/rls-prisma'
import { asyncHandler } from '../../utils/async-handler'
import { requireAuth } from '../../middleware/auth'
import { queryParam } from '../../utils/query'
import { env } from '../../config/env'

export const googleIntegrationRouter: Router = Router()

googleIntegrationRouter.get(
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
      provider: 'GOOGLE',
      workspaceId,
      userId: auth.user.id,
      state,
    })

    const authUrl = buildGoogleAuthUrl(state)
    return res.json({ authUrl })
  })
)

googleIntegrationRouter.get(
  '/callback',
  asyncHandler(async (req, res) => {
    const code = queryParam(req, 'code')
    const state = queryParam(req, 'state')
    const errorParam = queryParam(req, 'error')

    if (errorParam) {
      return res.redirect(
        `${env.APP_URL}/?error=google_auth_denied&reason=${errorParam}`
      )
    }

    if (!code || !state) {
      return res.redirect(`${env.APP_URL}/?error=google_missing_params`)
    }

    const oauthRecord = await validateOAuthState(state, 'GOOGLE')
    if (!oauthRecord) {
      return res.redirect(`${env.APP_URL}/?error=google_invalid_state`)
    }

    const workspace = await prisma.workspace.findUnique({
      where: { id: oauthRecord.workspace_id },
      select: { slug: true, id: true },
    })

    if (!workspace) {
      return res.redirect(`${env.APP_URL}/?error=workspace_not_found`)
    }

    const developerToken = process.env.GOOGLE_ADS_DEVELOPER_TOKEN
    if (!developerToken) {
      await prisma.google_ads_connections.upsert({
        where: { workspace_id: workspace.id },
        create: {
          workspace_id: workspace.id,
          refresh_token: '',
          scopes: [],
          customer_ids: [],
          status: 'DISCONNECTED',
          last_sync_error: 'GOOGLE_ADS_DEVELOPER_TOKEN is not configured on the server.',
          updated_at: new Date(),
        },
        update: {
          status: 'DISCONNECTED',
          last_sync_error: 'GOOGLE_ADS_DEVELOPER_TOKEN is not configured on the server.',
        },
      })
      return res.redirect(
        `${env.APP_URL}/w/${workspace.slug}/dashboard?error=google_developer_token_missing`
      )
    }

    try {
      const { accessToken, refreshToken } = await exchangeGoogleCode(code)

      let customerIds: string[] = []
      let lastSyncError: string | null = null

      // Step 1: Try listAccessibleCustomers
      try {
        customerIds = await listAccessibleCustomers(accessToken)
      } catch (err) {
        lastSyncError = `listAccessibleCustomers failed: ${err instanceof Error ? err.message : String(err)}`
      }

      // Step 2: If empty and LOGIN_CUSTOMER_ID is set, try MCC child discovery
      const loginCustomerId = process.env.GOOGLE_ADS_LOGIN_CUSTOMER_ID || null
      if (customerIds.length === 0 && loginCustomerId) {
        try {
          customerIds = await listManagerChildAccounts(accessToken, loginCustomerId)
          if (customerIds.length > 0) lastSyncError = null
        } catch (err) {
          const mccErr = `MCC child listing failed: ${err instanceof Error ? err.message : String(err)}`
          lastSyncError = lastSyncError ? `${lastSyncError}; ${mccErr}` : mccErr
        }
      }

      if (customerIds.length === 0 && !lastSyncError) {
        lastSyncError = 'No Google Ads customers found. Check that the authorized Google account has access to at least one Google Ads customer.'
      }

      let googleEmail: string | null = null
      try {
        googleEmail = await fetchGoogleUserEmail(accessToken)
      } catch {
        // Non-critical
      }

      // Auto-select if exactly one customer
      const selectedCustomerId = customerIds.length === 1 ? customerIds[0] : null
      const currency =
        selectedCustomerId != null
          ? await fetchGoogleCustomerCurrency(accessToken, selectedCustomerId).catch(() => null)
          : null

      await prisma.google_ads_connections.upsert({
        where: { workspace_id: workspace.id },
        create: {
          workspace_id: workspace.id,
          refresh_token: refreshToken,
          scopes: ['https://www.googleapis.com/auth/adwords'],
          customer_ids: customerIds,
          selected_customer_id: selectedCustomerId,
          login_customer_id: loginCustomerId ?? null,
          google_email: googleEmail,
          currency: currency ?? 'USD',
          status: 'CONNECTED',
          last_sync_error: lastSyncError,
          updated_at: new Date(),
        },
        update: {
          refresh_token: refreshToken,
          scopes: ['https://www.googleapis.com/auth/adwords'],
          customer_ids: customerIds,
          selected_customer_id: selectedCustomerId,
          login_customer_id: loginCustomerId ?? null,
          google_email: googleEmail,
          currency: currency ?? 'USD',
          status: 'CONNECTED',
          last_sync_error: lastSyncError,
        },
      })

      return res.redirect(`${env.APP_URL}/w/${workspace.slug}/dashboard`)
    } catch (error) {
      console.error('Google OAuth callback error:', error)
      return res.redirect(
        `${env.APP_URL}/w/${workspace.slug}/dashboard?error=google_connection_failed`
      )
    }
  })
)

googleIntegrationRouter.post(
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

    const required = [
      'GOOGLE_ADS_CLIENT_ID',
      'GOOGLE_ADS_CLIENT_SECRET',
      'GOOGLE_ADS_REDIRECT_URI',
      'GOOGLE_ADS_DEVELOPER_TOKEN',
    ] as const
    const missing = required.filter((k) => !process.env[k])
    if (missing.length > 0) {
      return res.status(503).json({
        error: 'Google Ads is not configured. Add these to .env: ' + missing.join(', '),
      })
    }

    const connection = await prisma.google_ads_connections.findUnique({
      where: { workspace_id: body.workspaceId },
      select: { id: true, status: true },
    })

    if (!connection || connection.status !== 'CONNECTED') {
      return res.status(404).json({ error: 'No active Google Ads connection' })
    }

    try {
      await withWorkspace(body.workspaceId, (tx) =>
        syncGoogleAdsForConnection(connection.id, undefined, tx),
      )
      return res.json({ success: true })
    } catch (error) {
      return res
        .status(500)
        .json({ error: error instanceof Error ? error.message : 'Sync failed' })
    }
  })
)

googleIntegrationRouter.post(
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

    await prisma.google_ads_connections.updateMany({
      where: { workspace_id: body.workspaceId, status: 'CONNECTED' },
      data: { status: 'DISCONNECTED', refresh_token: '' },
    })

    return res.json({ success: true })
  })
)

googleIntegrationRouter.post(
  '/refresh-accounts',
  requireAuth,
  asyncHandler(async (req, res) => {
    const body = req.body
    const { workspaceId } = body as { workspaceId?: string }

    if (!workspaceId) {
      return res.status(400).json({ error: 'workspaceId is required' })
    }

    const result = await requireWorkspaceAdmin(req.auth!.userId, workspaceId)
    if (result.error) return res.status(result.error.status).json(result.error.body)

    const connection = await prisma.google_ads_connections.findUnique({
      where: { workspace_id: workspaceId },
    })

    if (!connection || connection.status !== 'CONNECTED') {
      return res.status(404).json({ error: 'No active Google Ads connection found' })
    }

    if (!process.env.GOOGLE_ADS_DEVELOPER_TOKEN) {
      return res.status(500).json({ error: 'GOOGLE_ADS_DEVELOPER_TOKEN is not configured' })
    }

    try {
      const { accessToken } = await refreshGoogleAccessToken(connection.refresh_token)

      let customerIds: string[] = []
      let lastSyncError: string | null = null

      try {
        customerIds = await listAccessibleCustomers(accessToken)
      } catch (err) {
        lastSyncError = `listAccessibleCustomers: ${err instanceof Error ? err.message : String(err)}`
      }

      const loginCustomerId = process.env.GOOGLE_ADS_LOGIN_CUSTOMER_ID || null
      if (customerIds.length === 0 && loginCustomerId) {
        try {
          customerIds = await listManagerChildAccounts(accessToken, loginCustomerId)
          if (customerIds.length > 0) lastSyncError = null
        } catch (err) {
          const mccErr = `MCC child listing: ${err instanceof Error ? err.message : String(err)}`
          lastSyncError = lastSyncError ? `${lastSyncError}; ${mccErr}` : mccErr
        }
      }

      if (customerIds.length === 0 && !lastSyncError) {
        lastSyncError = 'No Google Ads customers found. Check account permissions.'
      }

      // Keep current selection if still valid, otherwise auto-select if exactly one
      let selectedCustomerId = connection.selected_customer_id
      if (selectedCustomerId && !customerIds.includes(selectedCustomerId)) {
        selectedCustomerId = null
      }
      if (!selectedCustomerId && customerIds.length === 1) {
        selectedCustomerId = customerIds[0]
      }

      await prisma.google_ads_connections.update({
        where: { id: connection.id },
        data: {
          customer_ids: customerIds,
          selected_customer_id: selectedCustomerId,
          login_customer_id: loginCustomerId,
          last_sync_error: lastSyncError,
        },
      })

      return res.json({ ok: true, customerIds, selectedCustomerId, lastSyncError })
    } catch (err) {
      return res
        .status(500)
        .json({ error: err instanceof Error ? err.message : 'Failed to refresh accounts' })
    }
  })
)

googleIntegrationRouter.post(
  '/select-customer',
  requireAuth,
  asyncHandler(async (req, res) => {
    const body = req.body
    const { workspaceId, selectedCustomerId } = body as {
      workspaceId?: string
      selectedCustomerId?: string
    }

    if (!workspaceId || !selectedCustomerId) {
      return res.status(400).json({
        error: 'workspaceId and selectedCustomerId are required',
      })
    }

    const result = await requireWorkspaceAdmin(req.auth!.userId, workspaceId)
    if (result.error) return res.status(result.error.status).json(result.error.body)

    const connection = await prisma.google_ads_connections.findUnique({
      where: { workspace_id: workspaceId },
      select: { id: true, customer_ids: true, status: true },
    })

    if (!connection || connection.status !== 'CONNECTED') {
      return res.status(404).json({ error: 'No active Google Ads connection found' })
    }

    if (!connection.customer_ids.includes(selectedCustomerId)) {
      return res.status(400).json({
        error: 'Selected customer ID is not in the list of connected customers',
      })
    }

    await prisma.google_ads_connections.update({
      where: { id: connection.id },
      data: { selected_customer_id: selectedCustomerId },
    })

    return res.json({ ok: true, selectedCustomerId })
  })
)

googleIntegrationRouter.post(
  '/select-customers',
  requireAuth,
  asyncHandler(async (req, res) => {
    const body = req.body
    const { workspaceId, selectedCustomerIds } = body as {
      workspaceId?: string
      selectedCustomerIds?: string[]
    }

    if (!workspaceId || !Array.isArray(selectedCustomerIds) || selectedCustomerIds.length === 0) {
      return res.status(400).json({
        error: 'workspaceId and selectedCustomerIds[] are required',
      })
    }

    const result = await requireWorkspaceAdmin(req.auth!.userId, workspaceId)
    if (result.error) return res.status(result.error.status).json(result.error.body)

    const connection = await prisma.google_ads_connections.findUnique({
      where: { workspace_id: workspaceId },
      select: { id: true, customer_ids: true, status: true },
    })

    if (!connection || connection.status !== 'CONNECTED') {
      return res.status(404).json({ error: 'No active Google Ads connection found' })
    }

    const invalid = selectedCustomerIds.filter((id) => !connection.customer_ids.includes(id))
    if (invalid.length > 0) {
      return res.status(400).json({
        error: `These customer IDs are not available: ${invalid.join(', ')}`,
      })
    }

    await prisma.google_ads_connections.update({
      where: { id: connection.id },
      data: {
        selected_customer_ids: selectedCustomerIds,
        selected_customer_id: selectedCustomerIds.length === 1 ? selectedCustomerIds[0] : null,
      },
    })

    return res.json({ ok: true, selectedCustomerIds })
  })
)
