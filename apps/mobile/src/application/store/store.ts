// @paradigm: sql
// Redux store with redux-persist for the Morning Brief stale-but-labeled posture.
// CF-C6-MB-OFFLINE-SLO-1: the brief + fetchedAt are persisted so the offline path
// always has content to show — never a blank screen in the 07:00-09:00 IST window.
//
// CF-C6-PII-CLIENT-1: redux-persist uses AsyncStorage (not SecureStore).
//   Only the Morning Brief (non-sensitive AI recommendations) is persisted here.
//   Tokens are in expo-secure-store (see auth-store.ts). Never put tokens in Redux.
//
// CF-C6-NEW-LAYER-1: Redux Toolkit. Zero Zustand.

import { configureStore } from '@reduxjs/toolkit';
import { persistReducer, persistStore } from 'redux-persist';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { TypedUseSelectorHook } from 'react-redux';
import { useDispatch, useSelector } from 'react-redux';
import morningBriefReducer from './morning-brief-slice.js';

const morningBriefPersistConfig = {
  key: 'morning-brief',
  storage: AsyncStorage,
  // Persist brief + fetchedAt for the stale-but-labeled offline posture.
  // Do NOT persist responses (they contain idempotency keys — short-lived).
  // Do NOT persist isFetching / fetchError (transient).
  whitelist: ['brief', 'fetchedAt'],
};

const persistedMorningBriefReducer = persistReducer(
  morningBriefPersistConfig,
  morningBriefReducer,
);

export const store = configureStore({
  reducer: {
    morningBrief: persistedMorningBriefReducer,
  },
  middleware: (getDefaultMiddleware) =>
    getDefaultMiddleware({
      serializableCheck: {
        // redux-persist actions contain non-serializable Date values.
        ignoredActions: [
          'persist/PERSIST',
          'persist/REHYDRATE',
          'persist/PAUSE',
          'persist/PURGE',
          'persist/REGISTER',
          'persist/FLUSH',
        ],
      },
    }),
});

export const persistor = persistStore(store);

export type RootState = ReturnType<typeof store.getState>;
export type AppDispatch = typeof store.dispatch;

/** Typed Redux hooks — use these instead of the plain react-redux versions. */
export const useAppDispatch: () => AppDispatch = useDispatch;
export const useAppSelector: TypedUseSelectorHook<RootState> = useSelector;
