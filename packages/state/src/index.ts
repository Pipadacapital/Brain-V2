// @paradigm: sql
// @brain/state — shared Redux slices for web + mobile (spec: packages/state).
// The store assembly + typed hooks are app-specific (they bind the app's RootState), so each
// app composes these slices into its own configureStore. This barrel re-exports the named
// actions + the reducers (as sessionReducer / uiReducer); the raw slice modules are also
// importable via the ./session-slice and ./ui-slice subpaths.

export { setSession, clearSession } from './session-slice.js';
export { default as sessionReducer } from './session-slice.js';

export { openDrillDrawer, closeDrillDrawer, setWorkspaceSwitcherOpen } from './ui-slice.js';
export { default as uiReducer } from './ui-slice.js';
