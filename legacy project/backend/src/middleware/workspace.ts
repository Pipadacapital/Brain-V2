import { prisma } from '../lib/prisma'
import { assembleClaim, type BrainClaim, type WorkspaceRoleString, type SystemRoleString } from '../lib/brain-claim'
import { correlationStore, type CorrelationContext } from '../lib/rls-prisma'
import { asyncHandler } from '../utils/async-handler'
import { badRequest, forbidden, notFound, unauthorized } from '../utils/http-error'
import { randomUUID } from 'crypto'

/**
 * Workspace middleware — resolves the workspace from the `:slug` route param
 * and validates that the authenticated user is a member.
 *
 * Must run after `requireAuth`. Attaches:
 *   req.workspace  — { id, slug, features }
 *   req.membership — { role }
 *   req.claim      — Brain claim (userId, workspaceId, workspaceRole,
 *                    workspaceRoleLevel, systemRole, requestId, traceId)
 *                    CF-SEC-5: also seeds the AsyncLocalStorage 4-tuple.
 *
 * The two DB lookups run concurrently (Promise.all, unchanged from original).
 * Workspace + User tables are Group D (no RLS) so they correctly use the
 * singleton `prisma` client on :6543.
 *
 * Track 1a-B: route handlers migrated to withWorkspace use req.claim.workspaceId
 * so layers 1 (JWT auth) → 2 (membership gate) → 3 (RLS context) are coherent.
 */
export const requireWorkspace = asyncHandler(async (req, _res, next) => {
  if (!req.auth) {
    throw unauthorized('Not authenticated')
  }

  // Express 5 types route params as `string | string[]`; we only ever expect a string.
  const slug = typeof req.params.slug === 'string' ? req.params.slug : undefined
  if (!slug) {
    throw badRequest('Workspace slug is required')
  }

  // Run both lookups concurrently — they share the same `slug` predicate, so we
  // avoid a second 300ms+ round-trip to a remote DB. The membership query uses
  // the `workspace` relation to filter by slug without needing workspace.id.
  // Workspace + WorkspaceMember are Group D / non-RLS — use the singleton client.
  const [workspace, memberRow] = await Promise.all([
    prisma.workspace.findUnique({
      where: { slug },
      select: { id: true, slug: true, features: true },
    }),
    prisma.workspaceMember.findFirst({
      where: { userId: req.auth.userId, workspace: { slug } },
      select: {
        role: true,
        user: { select: { systemRole: true } },
      },
    }),
  ])

  if (!workspace) {
    throw notFound('Workspace not found')
  }
  if (!memberRow) {
    throw forbidden('You do not have access to this workspace')
  }

  req.workspace = {
    id: workspace.id,
    slug: workspace.slug,
    features: (workspace.features as Record<string, boolean> | null) ?? null,
  }
  req.membership = { role: memberRow.role }

  // Assemble and attach the Brain claim (1b).
  // requestId: use x-request-id if the gateway set it, otherwise generate.
  const requestId =
    (typeof req.headers['x-request-id'] === 'string'
      ? req.headers['x-request-id']
      : null) ?? randomUUID()
  const traceId =
    (typeof req.headers['x-trace-id'] === 'string'
      ? req.headers['x-trace-id']
      : null) ?? requestId

  const claim = assembleClaim({
    userId: req.auth.userId,
    workspaceId: workspace.id,
    workspaceRole: memberRow.role as WorkspaceRoleString,
    systemRole: (memberRow.user?.systemRole ?? 'USER') as SystemRoleString,
    requestId,
    traceId,
  })
  req.claim = claim

  // CF-SEC-5: seed the correlation 4-tuple into AsyncLocalStorage so that
  // withWorkspace/withSuperadmin and structured log calls carry it automatically.
  const ctx: CorrelationContext = {
    requestId,
    traceId,
    workspaceId: workspace.id,
    userId: req.auth.userId,
  }

  // Run the rest of the middleware chain inside the correlation context.
  await correlationStore.run(ctx, () => Promise.resolve(next()))
})

// Re-export BrainClaim for route files.
export type { BrainClaim }
