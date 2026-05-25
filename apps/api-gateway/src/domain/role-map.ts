// @paradigm: sql
// Legacy → Brain role reconciliation (Slice A).
//
// Stage-1 reconciliation #1: legacy WorkspaceRole is 4-valued
// (OWNER/ADMIN/EDITOR/VIEWER); Brain BrainClaim is 5-valued
// (OWNER/ADMIN/MANAGER/ANALYST/VIEWER). The ONLY non-1:1 mapping is
// EDITOR → MANAGER. Do NOT invent a 6th role. The map is explicit + tested so
// slice C's DB-backed resolver cannot silently mis-grant.

import type { WorkspaceRoleString } from '@brain/core-auth';

export type LegacyWorkspaceRole = 'OWNER' | 'ADMIN' | 'EDITOR' | 'VIEWER';

const LEGACY_TO_BRAIN: Record<LegacyWorkspaceRole, WorkspaceRoleString> = {
  OWNER: 'OWNER',
  ADMIN: 'ADMIN',
  EDITOR: 'MANAGER', // the one non-identity mapping
  VIEWER: 'VIEWER',
};

/**
 * Map a legacy WorkspaceRole to the Brain WorkspaceRoleString.
 * @throws Error on an unknown legacy role (fail-closed — never default to a grant).
 */
export function legacyRoleToBrain(legacy: string): WorkspaceRoleString {
  const mapped = LEGACY_TO_BRAIN[legacy as LegacyWorkspaceRole];
  if (!mapped) {
    throw new Error(`Unknown legacy workspace role: ${legacy}`);
  }
  return mapped;
}
