/**
 * Platform-admin (SUPERADMIN) barrel.
 *
 * v1 internal contract path: @brain/core-admin
 * The gateway imports these cross-tenant read use-cases in-process (Phase-0) and
 * calls them ONLY from `superadminProc` procedures — the systemRole gate is the
 * gateway's, not this module's. core-service owns the data.
 */

export {
  listAllUsers,
  listAllWorkspaces,
  listAllConnections,
  type DbRunners,
  type AdminUserRow,
  type AdminWorkspaceRow,
  type AdminConnectionRow,
} from './admin-use-cases.js'
