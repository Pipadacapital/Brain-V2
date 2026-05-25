// @paradigm: sql
// CF-C6-MB-GRADUATED-LABEL-1: Graduation UX state machine.
//
// The approve button MUST distinguish:
//   LOGGED_AS_VOTE → "Log Approval" / "Support This Action"
//     (recommendation-only; no execution queued)
//   QUEUED_FOR_EXECUTION → "Approved for Execution"
//     (execution has been queued)
//
// Day-1: server always returns LOGGED_AS_VOTE (per architecture plan + Vikram stub).
// The client NEVER infers graduation state — it renders the server's status verbatim.
//
// INVARIANT: never say "Approve & Execute" unless status = QUEUED_FOR_EXECUTION.
// A non-graduated action showing "Approve & Execute" implies auto-execute — BOUNCE.

import type { GraduationStatus } from './types.js';

/** The label to show on the primary CTA for an insight. */
export interface GraduationLabels {
  primaryCta: string;
  statusBadge: string;
  statusDescription: string;
  /** True if the action has been dispatched to an executor. */
  isExecutionQueued: boolean;
}

/**
 * getGraduationLabels — derive display strings from server-provided status.
 *
 * CF-C6-MB-GRADUATED-LABEL-1: all labels are driven by the server `status` field.
 * The client NEVER computes graduation from local state.
 *
 * @param status - server-driven GraduationStatus from submitResponse
 */
export function getGraduationLabels(status: GraduationStatus): GraduationLabels {
  switch (status) {
    case 'LOGGED_AS_VOTE':
      return {
        primaryCta: 'Log Approval',
        statusBadge: 'Vote Logged',
        statusDescription: 'Your approval has been recorded. Brain will queue this action once it\'s confirmed safe to execute automatically.',
        isExecutionQueued: false,
      };
    case 'QUEUED_FOR_EXECUTION':
      return {
        primaryCta: 'Approved for Execution',
        statusBadge: 'Queued',
        statusDescription: 'This action has been queued for automatic execution.',
        isExecutionQueued: true,
      };
    default: {
      // TypeScript exhaustive check — future statuses go here.
      const _exhaustive: never = status;
      return {
        primaryCta: 'Log Approval',
        statusBadge: 'Vote Logged',
        statusDescription: 'Your approval has been recorded.',
        isExecutionQueued: false,
      };
    }
  }
}

/** Label for the primary CTA BEFORE the user has tapped (action not yet initiated). */
export const PRE_ACTION_LABEL: Record<'APPROVE' | 'REJECT' | 'EDIT', string> = {
  APPROVE: 'Log Approval',
  REJECT: 'Reject',
  EDIT: 'Edit',
};

/**
 * getPreActionCta — label for CTAs before user responds.
 * "Log Approval" NOT "Approve & Execute" — Day-1 all = LOGGED_AS_VOTE.
 * CF-C6-MB-GRADUATED-LABEL-1.
 */
export function getPreActionCta(kind: 'APPROVE' | 'REJECT' | 'EDIT'): string {
  return PRE_ACTION_LABEL[kind];
}
