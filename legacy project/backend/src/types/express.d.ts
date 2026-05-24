import type { WorkspaceRole } from '@prisma/client'
import type { BrainClaim } from '../lib/brain-claim'

/**
 * Augments Express's `Request` with the context our middleware attaches:
 *
 *  - `auth`       — set by `requireAuth` after verifying the Supabase JWT
 *  - `workspace`  — set by `requireWorkspace` after resolving the slug
 *  - `membership` — set by `requireWorkspace` after validating membership
 *  - `claim`      — Brain claim (1b): userId, workspaceId, workspaceRole,
 *                   workspaceRoleLevel, systemRole, requestId, traceId
 *                   CF-SEC-5: also seeds the AsyncLocalStorage correlation 4-tuple
 *
 * Handlers that run behind the matching middleware can rely on these being
 * present. Use a non-null assertion (`req.auth!`) inside such handlers.
 */
declare global {
  namespace Express {
    interface Request {
      auth?: {
        /** Supabase user id — matches `users.id` in the database. */
        userId: string
        email: string | null
        /** The raw Bearer token, kept for forwarding to downstream services. */
        token: string
      }
      workspace?: {
        id: string
        slug: string
        features: Record<string, boolean> | null
      }
      membership?: {
        role: WorkspaceRole
      }
      /** Brain claim — assembled by requireWorkspace after membership resolution. */
      claim?: BrainClaim
    }
  }
}

export {}
