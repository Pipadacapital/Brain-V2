// @paradigm: sql
// Session slice — active workspace + user identity from the auth.session procedure.
// CF-C6-NEW-LAYER-1: Redux Toolkit ONLY. Zero Zustand.
// CF-C6-PII-CLIENT-1: userId stored in Redux for correlation only;
//   never logged or sent to Sentry breadcrumbs.

import { createSlice, type PayloadAction } from '@reduxjs/toolkit';

interface SessionState {
  userId: string | null;
  workspaceId: string | null;
  workspaceRole: string | null;
  isAuthenticated: boolean;
}

const initialState: SessionState = {
  userId: null,
  workspaceId: null,
  workspaceRole: null,
  isAuthenticated: false,
};

export const sessionSlice = createSlice({
  name: 'session',
  initialState,
  reducers: {
    setSession(
      state,
      action: PayloadAction<{
        userId: string;
        workspaceId: string;
        workspaceRole: string;
      }>,
    ) {
      state.userId = action.payload.userId;
      state.workspaceId = action.payload.workspaceId;
      state.workspaceRole = action.payload.workspaceRole;
      state.isAuthenticated = true;
    },
    clearSession(state) {
      state.userId = null;
      state.workspaceId = null;
      state.workspaceRole = null;
      state.isAuthenticated = false;
    },
  },
});

export const { setSession, clearSession } = sessionSlice.actions;
export default sessionSlice.reducer;
