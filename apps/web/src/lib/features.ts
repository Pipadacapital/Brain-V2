// Feature gating helpers for the Brain web app.
// Ported from legacy frontend/lib/features.ts — kept in sync.

export type FeatureKey =
  | 'pnl'
  | 'waterfall'
  | 'products'
  | 'first_product_cascade'
  | 'lifetime_value'
  | 'cohorts'
  | 'customer_lifecycle'
  | 'acquisition'
  | 'timings'
  | 'distributions'
  | 'inventory'
  | 'store_analytics'
  | 'meta_ads'
  | 'google_ads'
  | 'shiprocket'
  | 'logistics'
  | 'rto_analytics'
  | 'cod_prepaid'
  | 'pincode_intelligence'
  | 'email_sms'
  | 'calendar'
  | 'ai'
  | 'ai_insights'
  | 'goals'
  | 'festivals'
  | 'ad_campaigns'

export type WorkspaceRole = 'OWNER' | 'ADMIN' | 'MANAGER' | 'ANALYST' | 'VIEWER'

// Role hierarchy — higher number = more access.
const ROLE_LEVEL: Record<WorkspaceRole, number> = {
  OWNER: 5,
  ADMIN: 4,
  MANAGER: 3,
  ANALYST: 2,
  VIEWER: 1,
}

// Check if a role meets or exceeds the required level.
export function hasRole(
  userRole: WorkspaceRole | string | null | undefined,
  requiredRole: WorkspaceRole,
): boolean {
  if (!userRole) return false
  const level = ROLE_LEVEL[userRole as WorkspaceRole]
  if (level === undefined) return false
  return level >= ROLE_LEVEL[requiredRole]
}

// Named permission checks — clear at call-sites.
export const can = {
  viewSettings: (role: WorkspaceRole | string | null | undefined) =>
    hasRole(role, 'ANALYST'),
  manageIntegrations: (role: WorkspaceRole | string | null | undefined) =>
    hasRole(role, 'ADMIN'),
  changeSettings: (role: WorkspaceRole | string | null | undefined) =>
    hasRole(role, 'ADMIN'),
}

// Default: a feature is enabled when not explicitly set to false.
export function isFeatureEnabled(
  features: Record<string, boolean> | null | undefined,
  key: FeatureKey,
): boolean {
  if (!features) return true
  const val = features[key]
  if (typeof val === 'boolean') return val
  return true // not mentioned = enabled
}
