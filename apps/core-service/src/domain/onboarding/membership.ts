/**
 * Onboarding / membership domain — pure types + validation (Slice C).
 *
 * @paradigm sql (deterministic validation + role mapping; no ML, no LLM)
 *
 * Owns the Brain-native onboarding/membership domain rules:
 *   - slug normalization + validation (lowercase alnum + single hyphens)
 *   - the legacy→Brain workspace-role map (EDITOR → MANAGER; the rest 1:1)
 *   - the shapes the application use-cases read/write
 *
 * Boundary (canon): core-service owns orgs/workspaces/users/roles. The gateway is
 * a thin pass-through that calls these use-cases with the VERIFIED sub + email from
 * the JWT claim — it carries NO business logic of its own.
 */

import type { WorkspaceRoleString, SystemRoleString } from '../auth/brain-claim.js'

// ---------------------------------------------------------------------------
// Slug normalization + validation
// ---------------------------------------------------------------------------

/**
 * Normalize a raw slug: trim + lowercase. (Does NOT mutate interior characters —
 * validation rejects anything illegal so the user gets a clear error rather than a
 * silently-rewritten slug.)
 */
export function normalizeSlug(raw: string): string {
  return raw.trim().toLowerCase()
}

/**
 * Valid slug: starts and ends with [a-z0-9], interior may contain [a-z0-9-].
 * No leading/trailing/double hyphen-only edge cases (a single interior hyphen run
 * is allowed; the regex permits consecutive hyphens which Postgres' UNIQUE handles
 * fine — we keep parity with the legacy rule which allowed them).
 *
 * Mirrors the legacy onboarding regex: /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/
 */
const SLUG_REGEX = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/

export function isValidSlug(slug: string): boolean {
  return SLUG_REGEX.test(slug)
}

// ---------------------------------------------------------------------------
// Legacy → Brain workspace-role map (Stage-1 reconciliation #1)
// ---------------------------------------------------------------------------

/**
 * The directive binds: invitation role mapping EDITOR → MANAGER, rest 1:1.
 * The legacy schema.prisma WorkspaceRole is ALREADY 5-valued
 * (OWNER/ADMIN/MANAGER/ANALYST/VIEWER) and has no EDITOR — but older legacy
 * invitation data MAY still carry the historical 'EDITOR' value, so the map
 * accepts it and folds it to MANAGER. Any 5-role Brain value passes through 1:1.
 * Unknown → throws (fail-closed; never silently default to a grant).
 */
const LEGACY_TO_BRAIN_ROLE: Record<string, WorkspaceRoleString> = {
  OWNER: 'OWNER',
  ADMIN: 'ADMIN',
  MANAGER: 'MANAGER',
  ANALYST: 'ANALYST',
  VIEWER: 'VIEWER',
  EDITOR: 'MANAGER', // historical legacy value → Brain MANAGER
}

export function mapInvitationRole(role: string): WorkspaceRoleString {
  const mapped = LEGACY_TO_BRAIN_ROLE[role]
  if (!mapped) {
    throw new Error(`Unknown invitation role: ${role}`)
  }
  return mapped
}

// ---------------------------------------------------------------------------
// Use-case input/output shapes
// ---------------------------------------------------------------------------

export interface VerifiedIdentity {
  /** Supabase auth user UUID — the verified JWT `sub`. */
  sub: string
  /** Email from the verified JWT (the ONLY PII besides full_name we persist). */
  email: string
  /** Optional display name (from Supabase user_metadata, captured at onboarding). */
  fullName?: string | null
}

export interface OnboardingInput {
  identity: VerifiedIdentity
  /** Profile step. */
  fullName: string
  jobRole: string
  /** Brand step. */
  brandName: string
  slug: string
  industry: string
  monthlyRevenue: string
  /** Platform step — store handle only; the LIVE connect is deferred to slice D. */
  platform: 'SHOPIFY' | 'WOOCOMMERCE'
  storeHandle?: string | null
}

export interface ResolvedMembership {
  workspaceId: string
  workspaceRole: WorkspaceRoleString
  systemRole: SystemRoleString
}

export interface WorkspaceSummary {
  workspaceId: string
  slug: string
  name: string
  role: WorkspaceRoleString
}
