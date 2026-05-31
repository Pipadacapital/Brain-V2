// @paradigm: sql
// @brain/ui-mobile — Tamagui mobile UI primitives (spec: packages/ui-mobile).
// Counterpart to @brain/ui (web). The Morning Brief is the highest-quality surface in Brain
// and its primitives (Card, Stat, Sparkline, ActionRow, …) land here as the Expo app is built.
// Kept as a real workspace package so the spec's package inventory is satisfied and apps/mobile
// imports from a named package from day one.

/** Marker for the shared mobile-primitive surface. Real Tamagui components land here. */
export const UI_MOBILE_PACKAGE = '@brain/ui-mobile' as const;
