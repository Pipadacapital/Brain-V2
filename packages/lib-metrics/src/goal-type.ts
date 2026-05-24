// @paradigm: sql
// Resolves Child-0 A1 #8: goalType money|ratio split.
// Design-only this child — the WorkspaceMetricGoal.goalType column migration is in the runbook skeleton, NOT applied.

/**
 * GoalType discriminates between money goals (stored as BIGINT minor units + currency_code)
 * and ratio goals (stored as INT32 basis points).
 *
 * "money" → goalValue is BIGINT minor units (MU), e.g. 100_00000n (₹1,00,000 in paise).
 * "ratio" → goalValue is INT32 basis points, e.g. 2333 (23.33%).
 *
 * This resolves the Child-0 open question A1 #8 (goalType split).
 * The future WorkspaceMetricGoal.goalType enum column migration is documented in the
 * runbook skeleton — it is NOT applied this child (CF-C2-NO-LIVE-1).
 */
export type GoalType = 'money' | 'ratio';

/**
 * Type-safe goalValue discriminated union.
 * "money" carries minorUnits (bigint) + currencyCode.
 * "ratio" carries basisPoints (number, INT32).
 */
export type GoalValue =
  | { readonly goalType: 'money'; readonly minorUnits: bigint; readonly currencyCode: string }
  | { readonly goalType: 'ratio'; readonly basisPoints: number };
