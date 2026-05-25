// @paradigm: sql
// Redux store — ui + session slices ONLY.
// CF-C6-NEW-LAYER-1: NO new global state mechanism beyond Redux + nuqs + TanStack + react-hook-form.

import { configureStore } from '@reduxjs/toolkit';
import uiReducer from './ui-slice.js';
import sessionReducer from './session-slice.js';

export const store = configureStore({
  reducer: {
    ui: uiReducer,
    session: sessionReducer,
  },
  middleware: (getDefaultMiddleware) =>
    getDefaultMiddleware({
      serializableCheck: {
        // BigInt values should NOT reach Redux. They stay in TanStack Query cache.
        // This warning helps catch accidental bigint-in-Redux bugs.
        ignoredPaths: [],
      },
    }),
});

export type RootState = ReturnType<typeof store.getState>;
export type AppDispatch = typeof store.dispatch;
