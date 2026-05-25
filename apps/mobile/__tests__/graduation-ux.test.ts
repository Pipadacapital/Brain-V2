/**
 * CF-C6-MB-GRADUATED-LABEL-1: Graduation UX state machine.
 *
 * Tests:
 *   POSITIVE: LOGGED_AS_VOTE → "Log Approval" (never "Approve & Execute").
 *   POSITIVE: QUEUED_FOR_EXECUTION → "Approved for Execution".
 *   POSITIVE: isExecutionQueued is false for LOGGED_AS_VOTE.
 *   POSITIVE: isExecutionQueued is true for QUEUED_FOR_EXECUTION.
 *   NEGATIVE: "Approve & Execute" MUST NOT appear in any label for LOGGED_AS_VOTE.
 *
 * GUARDRAIL: Day-1 all actions = LOGGED_AS_VOTE. No "auto-execute" implication.
 */

import { getGraduationLabels, getPreActionCta, PRE_ACTION_LABEL } from '../src/domain/graduation-ux.js';
import type { GraduationStatus } from '../src/domain/types.js';

describe('getGraduationLabels — server-driven graduation UX', () => {
  // -------------------------------------------------------------------------
  // POSITIVE: LOGGED_AS_VOTE (Day-1 default)
  // -------------------------------------------------------------------------
  it('LOGGED_AS_VOTE: primaryCta is "Log Approval" (not "Approve & Execute")', () => {
    const labels = getGraduationLabels('LOGGED_AS_VOTE');
    expect(labels.primaryCta).toBe('Log Approval');
    expect(labels.isExecutionQueued).toBe(false);
  });

  it('LOGGED_AS_VOTE: statusBadge is "Vote Logged"', () => {
    const labels = getGraduationLabels('LOGGED_AS_VOTE');
    expect(labels.statusBadge).toBe('Vote Logged');
  });

  it('LOGGED_AS_VOTE: statusDescription explains vote-not-execute semantics', () => {
    const labels = getGraduationLabels('LOGGED_AS_VOTE');
    // Must mention "approval" or "vote" — never "execute" alone.
    expect(labels.statusDescription.toLowerCase()).toContain('approval');
  });

  // -------------------------------------------------------------------------
  // NEGATIVE: "Approve & Execute" must never appear for LOGGED_AS_VOTE.
  // CF-C6-MB-GRADUATED-LABEL-1: graduation boundary violation.
  // -------------------------------------------------------------------------
  it('LOGGED_AS_VOTE: MUST NOT contain "Approve & Execute" in any label', () => {
    const labels = getGraduationLabels('LOGGED_AS_VOTE');
    const allLabels = [
      labels.primaryCta,
      labels.statusBadge,
      labels.statusDescription,
    ].join(' ');
    expect(allLabels).not.toContain('Approve & Execute');
    expect(allLabels).not.toContain('auto-execute');
    expect(allLabels).not.toContain('Auto-Execute');
  });

  // -------------------------------------------------------------------------
  // POSITIVE: QUEUED_FOR_EXECUTION
  // -------------------------------------------------------------------------
  it('QUEUED_FOR_EXECUTION: primaryCta is "Approved for Execution"', () => {
    const labels = getGraduationLabels('QUEUED_FOR_EXECUTION');
    expect(labels.primaryCta).toBe('Approved for Execution');
    expect(labels.isExecutionQueued).toBe(true);
  });

  it('QUEUED_FOR_EXECUTION: statusBadge is "Queued"', () => {
    const labels = getGraduationLabels('QUEUED_FOR_EXECUTION');
    expect(labels.statusBadge).toBe('Queued');
  });

  // -------------------------------------------------------------------------
  // POSITIVE: exhaustive — both statuses handled
  // -------------------------------------------------------------------------
  const ALL_STATUSES: GraduationStatus[] = ['LOGGED_AS_VOTE', 'QUEUED_FOR_EXECUTION'];
  for (const status of ALL_STATUSES) {
    it(`getGraduationLabels('${status}') returns non-empty labels`, () => {
      const labels = getGraduationLabels(status);
      expect(labels.primaryCta.length).toBeGreaterThan(0);
      expect(labels.statusBadge.length).toBeGreaterThan(0);
      expect(labels.statusDescription.length).toBeGreaterThan(0);
    });
  }
});

describe('getPreActionCta — pre-action CTA labels', () => {
  // -------------------------------------------------------------------------
  // POSITIVE: "Log Approval" — never "Approve & Execute" before status known.
  // -------------------------------------------------------------------------
  it('APPROVE pre-action label is "Log Approval"', () => {
    expect(getPreActionCta('APPROVE')).toBe('Log Approval');
  });

  it('APPROVE pre-action label is NOT "Approve & Execute"', () => {
    expect(getPreActionCta('APPROVE')).not.toBe('Approve & Execute');
    expect(getPreActionCta('APPROVE')).not.toContain('Execute');
  });

  it('REJECT pre-action label is "Reject"', () => {
    expect(getPreActionCta('REJECT')).toBe('Reject');
  });

  it('EDIT pre-action label is "Edit"', () => {
    expect(getPreActionCta('EDIT')).toBe('Edit');
  });

  // -------------------------------------------------------------------------
  // POSITIVE: PRE_ACTION_LABEL is consistent with getPreActionCta.
  // -------------------------------------------------------------------------
  it('PRE_ACTION_LABEL map is consistent with getPreActionCta()', () => {
    expect(PRE_ACTION_LABEL['APPROVE']).toBe(getPreActionCta('APPROVE'));
    expect(PRE_ACTION_LABEL['REJECT']).toBe(getPreActionCta('REJECT'));
    expect(PRE_ACTION_LABEL['EDIT']).toBe(getPreActionCta('EDIT'));
  });
});
