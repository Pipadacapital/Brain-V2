// @paradigm: sql
// Shim — the ui slice now lives in @brain/state (spec: packages/state).
// Re-exports the EXACT original surface (named actions + default reducer) so existing import
// paths (`@/domain/store/ui-slice`, incl. `import uiReducer from ...`) keep working.
export * from '@brain/state/ui-slice';
export { default } from '@brain/state/ui-slice';
