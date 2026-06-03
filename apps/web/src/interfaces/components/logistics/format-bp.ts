// @paradigm: sql
// format-bp — G3 formatter consolidation (Wave C).
// All formatters re-exported from the ONE canonical home: @brain/lib-formatters.
// Wave A (shared-libs-5) already fixed the negative-sign off-by-one and switched
// to ROUND (toFixed(0)) for the fractional part.
// This file is kept for import-path compatibility; direct imports of @brain/lib-formatters
// are preferred for new code.

export {
  formatBpPercent,
  formatScore,
} from '@brain/lib-formatters';
