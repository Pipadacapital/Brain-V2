/**
 * Shiprocket integration routes.
 *
 * Ported verbatim from:
 *   app/api/integrations/shiprocket/connect/route.ts          -> POST /connect, PATCH /connect
 *   app/api/integrations/shiprocket/sync/route.ts             -> POST /sync
 *   app/api/integrations/shiprocket/disconnect/route.ts       -> POST /disconnect
 *   app/api/integrations/shiprocket/refresh-channels/route.ts -> POST /refresh-channels
 *   app/api/integrations/shiprocket/select-channels/route.ts  -> POST /select-channels
 *
 * Auth pattern A (requireWorkspaceAdmin): requireAuth route middleware +
 * requireWorkspaceAdmin(req.auth!.userId, body.workspaceId).
 */
import { Router } from 'express'
import { prisma } from '@/lib/prisma'
import { requireWorkspaceAdmin } from '@/lib/integrations/helpers'
import { loginShiprocket } from '@/lib/integrations/shiprocket'
import {
  syncShiprocketForConnection,
  backfillShiprocketCourierNames,
  backfillShiprocketPincodes,
} from '@/lib/integrations/shiprocket-sync'
import { discoverChannels } from '@/lib/integrations/shiprocket-sync'
import { withWorkspace } from '@/lib/rls-prisma'
import { asyncHandler } from '../../utils/async-handler'
import { requireAuth } from '../../middleware/auth'

export const shiprocketIntegrationRouter: Router = Router()

shiprocketIntegrationRouter.post(
  '/connect',
  requireAuth,
  asyncHandler(async (req, res) => {
    let body: { workspaceId: string; email: string; password: string }
    body = req.body

    const { workspaceId, email, password } = body
    if (!workspaceId || !email || !password) {
      return res.status(400).json(
        { error: 'workspaceId, email, and password are required' }
      )
    }

    const auth = await requireWorkspaceAdmin(req.auth!.userId, workspaceId)
    if (auth.error) return res.status(auth.error.status).json(auth.error.body)

    try {
      const token = await loginShiprocket(email, password)

      await prisma.shiprocketConnection.upsert({
        where: { workspaceId },
        create: {
          workspaceId,
          email,
          password,
          accessToken: token,
          tokenObtainedAt: new Date(),
          status: 'CONNECTED',
        },
        update: {
          email,
          password,
          accessToken: token,
          tokenObtainedAt: new Date(),
          status: 'CONNECTED',
          lastSyncError: null,
        },
      })

      return res.json({ success: true })
    } catch (err) {
      return res.status(400).json(
        { error: err instanceof Error ? err.message : 'Shiprocket login failed' }
      )
    }
  })
)

shiprocketIntegrationRouter.patch(
  '/connect',
  requireAuth,
  asyncHandler(async (req, res) => {
    let body: {
      workspaceId: string
      shiprocketApiEmail?: string
      shiprocketApiPassword?: string
    }
    body = req.body

    const { workspaceId, shiprocketApiEmail, shiprocketApiPassword } = body
    if (!workspaceId || !shiprocketApiEmail || !shiprocketApiPassword) {
      return res.status(400).json(
        { error: 'workspaceId, shiprocketApiEmail, and shiprocketApiPassword are required' }
      )
    }

    const auth = await requireWorkspaceAdmin(req.auth!.userId, workspaceId)
    if (auth.error) return res.status(auth.error.status).json(auth.error.body)

    await prisma.shiprocketConnection.update({
      where: { workspaceId },
      data: {
        shiprocketApiEmail: shiprocketApiEmail.trim(),
        shiprocketApiPassword,
      },
    })

    return res.json({ success: true })
  })
)

shiprocketIntegrationRouter.post(
  '/sync',
  requireAuth,
  asyncHandler(async (req, res) => {
    let body: { workspaceId: string }
    body = req.body

    if (!body.workspaceId) {
      return res.status(400).json({ error: 'Missing workspaceId' })
    }

    const auth = await requireWorkspaceAdmin(req.auth!.userId, body.workspaceId)
    if (auth.error) return res.status(auth.error.status).json(auth.error.body)

    const connection = await prisma.shiprocketConnection.findUnique({
      where: { workspaceId: body.workspaceId },
      select: { id: true, status: true },
    })

    if (!connection || connection.status !== 'CONNECTED') {
      return res.status(404).json(
        { error: 'No active Shiprocket connection' }
      )
    }

    const encode = (data: object) => JSON.stringify(data) + '\n'

    res.setHeader('Content-Type', 'application/x-ndjson')
    res.setHeader('Cache-Control', 'no-cache')
    res.setHeader('X-Accel-Buffering', 'no')

    try {
      res.write(
        encode({
          stage: 'syncing',
          message: 'Syncing shipments from Shiprocket...',
          progress: 10,
        })
      )

      const syncResult = await withWorkspace(body.workspaceId, (tx) =>
        syncShiprocketForConnection(connection.id, undefined, tx),
      )

      res.write(
        encode({
          stage: 'syncing_done',
          message: `Synced ${(syncResult as { newShipments?: number } | undefined)?.newShipments ?? 0} new shipments`,
          progress: 35,
        })
      )

      res.write(
        encode({
          stage: 'courier',
          message: 'Enriching courier data...',
          progress: 40,
        })
      )

      let courierResult = null
      try {
        courierResult = await backfillShiprocketCourierNames(connection.id)
      } catch (e) {
        console.warn('[sync] courier backfill failed:', e)
      }

      res.write(
        encode({
          stage: 'courier_done',
          message: `Courier data enriched${
            courierResult?.updatedFromTracking
              ? ` (${courierResult.updatedFromTracking} resolved)`
              : ''
          }`,
          progress: 70,
        })
      )

      res.write(
        encode({
          stage: 'pincode',
          message: 'Enriching pincode data...',
          progress: 75,
        })
      )

      let pincodeResult = null
      try {
        pincodeResult = await backfillShiprocketPincodes(connection.id)
      } catch (e) {
        console.warn('[sync] pincode backfill failed:', e)
      }

      res.write(
        encode({
          stage: 'pincode_done',
          message: 'Pincode data enriched',
          progress: 95,
        })
      )

      res.write(
        encode({
          stage: 'done',
          message: 'Sync complete',
          progress: 100,
          sync: syncResult,
          courierBackfill: courierResult,
          pincodeBackfill: pincodeResult,
        })
      )
    } catch (error) {
      res.write(
        encode({
          stage: 'error',
          message: error instanceof Error ? error.message : 'Sync failed',
          progress: 0,
        })
      )
    } finally {
      res.end()
    }
  })
)

shiprocketIntegrationRouter.post(
  '/disconnect',
  requireAuth,
  asyncHandler(async (req, res) => {
    let body: { workspaceId: string }
    body = req.body

    if (!body.workspaceId) {
      return res.status(400).json({ error: 'Missing workspaceId' })
    }

    const auth = await requireWorkspaceAdmin(req.auth!.userId, body.workspaceId)
    if (auth.error) return res.status(auth.error.status).json(auth.error.body)

    await prisma.shiprocketConnection.updateMany({
      where: { workspaceId: body.workspaceId, status: 'CONNECTED' },
      data: {
        status: 'DISCONNECTED',
        accessToken: null,
        password: '',
      },
    })

    return res.json({ success: true })
  })
)

shiprocketIntegrationRouter.post(
  '/refresh-channels',
  requireAuth,
  asyncHandler(async (req, res) => {
    let body: { workspaceId: string }
    body = req.body

    if (!body.workspaceId) {
      return res.status(400).json({ error: 'Missing workspaceId' })
    }

    const auth = await requireWorkspaceAdmin(req.auth!.userId, body.workspaceId)
    if (auth.error) return res.status(auth.error.status).json(auth.error.body)

    const connection = await prisma.shiprocketConnection.findUnique({
      where: { workspaceId: body.workspaceId },
      select: { id: true, status: true },
    })

    if (!connection || connection.status !== 'CONNECTED') {
      return res.status(404).json(
        { error: 'No active Shiprocket connection' }
      )
    }

    try {
      const channels = await discoverChannels(connection.id)
      const updated = await prisma.shiprocketConnection.findUnique({
        where: { id: connection.id },
        select: { channels: true, selectedChannelIds: true },
      })
      return res.json({
        ok: true,
        channels,
        selectedChannelIds: updated?.selectedChannelIds ?? [],
      })
    } catch (error) {
      return res.status(500).json(
        { error: error instanceof Error ? error.message : 'Failed to fetch channels' }
      )
    }
  })
)

shiprocketIntegrationRouter.post(
  '/select-channels',
  requireAuth,
  asyncHandler(async (req, res) => {
    let body: { workspaceId: string; selectedChannelIds: string[] }
    body = req.body

    if (!body.workspaceId || !Array.isArray(body.selectedChannelIds)) {
      return res.status(400).json(
        { error: 'Missing workspaceId or selectedChannelIds' }
      )
    }

    const auth = await requireWorkspaceAdmin(req.auth!.userId, body.workspaceId)
    if (auth.error) return res.status(auth.error.status).json(auth.error.body)

    const connection = await prisma.shiprocketConnection.findUnique({
      where: { workspaceId: body.workspaceId },
      select: { id: true, status: true, channels: true },
    })

    if (!connection || connection.status !== 'CONNECTED') {
      return res.status(404).json(
        { error: 'No active Shiprocket connection' }
      )
    }

    const knownIds = new Set<string>()
    if (Array.isArray(connection.channels)) {
      for (const ch of connection.channels as Array<{ id: unknown }>) {
        if (ch?.id != null) knownIds.add(String(ch.id))
      }
    }

    const invalid = body.selectedChannelIds.filter((id) => !knownIds.has(id))
    if (invalid.length > 0) {
      return res.status(400).json(
        { error: `Unknown channel IDs: ${invalid.join(', ')}` }
      )
    }

    await prisma.shiprocketConnection.update({
      where: { id: connection.id },
      data: { selectedChannelIds: body.selectedChannelIds },
    })

    return res.json({ ok: true, selectedChannelIds: body.selectedChannelIds })
  })
)
