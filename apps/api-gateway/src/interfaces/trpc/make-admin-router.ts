// @paradigm: sql
// Thin tRPC router — platform-admin (SUPERADMIN) domain.
//
// The ONE cross-tenant surface in Brain. Every procedure here runs on `superadminProc`,
// which asserts `claim.systemRole === 'SUPERADMIN'` before any code runs — a normal USER
// (any workspace role, including OWNER) is FORBIDDEN. The underlying core-service
// use-cases run under withSuperadmin (sanctioned no-context cross-workspace reads); the
// authorization gate is HERE, at the wire, not in the data layer.
//
// CF-C6-RENDER-ONLY-1: zero arithmetic — counts/flags come straight from core-service.
// CF-S10-HONEST-STATE-1: workspace plan is null (Brain has no plan tier) — never faked.
//
// Sync console (legacy /admin/sync): connector cutover is HELD (no live ingestion
// fan-out exists), so this router exposes the cross-tenant CONNECTION DIRECTORY
// (admin.connections, read-only) but NO working sync-trigger mutation. The frontend
// renders the trigger buttons disabled with an honest "available after connector
// cutover" note — same posture as /settings/backfill. Adding the real fan-out is a
// post-cutover deliverable, not a stub.

import {
  listAllUsers,
  listAllWorkspaces,
  listAllConnections,
} from '@brain/core-admin';
import { router, superadminProc } from '../../application/trpc.js';

export function makeAdminRouter() {
  return router({
    /**
     * Every user in the system (Email/Name/Role/Workspaces/Joined). Superadmin only.
     * Mirrors legacy GET /api/admin/users.
     */
    users: superadminProc.query(async ({ ctx }) => {
      const users = await listAllUsers();
      return { users, total: users.length, requestId: ctx.requestId };
    }),

    /**
     * Every workspace in the system, with member + connector counts. Superadmin only.
     * Mirrors legacy GET /api/admin/workspaces. `plan` is null (no plan tier in Brain).
     */
    workspaces: superadminProc.query(async ({ ctx }) => {
      const workspaces = await listAllWorkspaces();
      return { workspaces, total: workspaces.length, requestId: ctx.requestId };
    }),

    /**
     * Every CONNECTED connector across all tenants, for the /admin/sync console's
     * per-vendor workspace lists. READ-ONLY — sync triggers stay disabled while
     * connector cutover is HELD. Superadmin only.
     */
    connections: superadminProc.query(async ({ ctx }) => {
      const connections = await listAllConnections();
      return { connections, total: connections.length, requestId: ctx.requestId };
    }),
  });
}
