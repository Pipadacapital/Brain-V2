// @paradigm: sql
// format-ratio — G3 formatter consolidation (Wave C).
// All formatters re-exported from the ONE canonical home: @brain/lib-formatters.
// Wave A (shared-libs-5) already fixed the negative-sign off-by-one and switched
// to ROUND (toFixed(0)) for the fractional part.
// This file is kept for import-path compatibility; direct imports of @brain/lib-formatters
// are preferred for new code.

export {
  formatBpMultiple,
  formatX100Multiple,
  formatBpPercent,
} from '@brain/lib-formatters';
