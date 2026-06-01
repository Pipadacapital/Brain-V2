// @paradigm: sql
// Shim — the session slice now lives in @brain/state (spec: packages/state).
// Re-exports the EXACT original surface (named actions + default reducer) so existing import
// paths (`@/domain/store/session-slice`, incl. `import sessionReducer from ...`) keep working.
export * from '@brain/state/session-slice';
export { default } from '@brain/state/session-slice';
