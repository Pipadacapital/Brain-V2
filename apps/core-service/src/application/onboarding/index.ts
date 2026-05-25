/**
 * Onboarding / membership application barrel (Slice C).
 *
 * v1 internal contract path: @brain/core-onboarding
 * The gateway imports these use-cases in-process (Phase-0) and calls them with the
 * VERIFIED sub + email from the JWT claim. core-service owns the business logic.
 */

export {
  ensureUser,
  resolveMembership,
  listWorkspaces,
  completeOnboarding,
  acceptInvitation,
  OnboardingError,
  type DbRunners,
  type AcceptInvitationResult,
} from './onboarding-use-cases.js'

export {
  isValidSlug,
  normalizeSlug,
  mapInvitationRole,
  type OnboardingInput,
  type ResolvedMembership,
  type VerifiedIdentity,
  type WorkspaceSummary,
} from '../../domain/onboarding/membership.js'
