// @paradigm: sql
// UI state slice — drawer + workspace switcher + date range visibility.
// CF-C6-NEW-LAYER-1: Redux Toolkit ONLY. Zero Zustand.

import { createSlice, type PayloadAction } from '@reduxjs/toolkit';

interface UiState {
  drillDrawer: {
    open: boolean;
    definitionId: string | null;
    date_start: string | null;
    date_end: string | null;
  };
  workspaceSwitcherOpen: boolean;
}

const initialState: UiState = {
  drillDrawer: {
    open: false,
    definitionId: null,
    date_start: null,
    date_end: null,
  },
  workspaceSwitcherOpen: false,
};

export const uiSlice = createSlice({
  name: 'ui',
  initialState,
  reducers: {
    openDrillDrawer(
      state,
      action: PayloadAction<{ definitionId: string; date_start: string; date_end: string }>,
    ) {
      state.drillDrawer.open = true;
      state.drillDrawer.definitionId = action.payload.definitionId;
      state.drillDrawer.date_start = action.payload.date_start;
      state.drillDrawer.date_end = action.payload.date_end;
    },
    closeDrillDrawer(state) {
      state.drillDrawer.open = false;
      state.drillDrawer.definitionId = null;
      state.drillDrawer.date_start = null;
      state.drillDrawer.date_end = null;
    },
    setWorkspaceSwitcherOpen(state, action: PayloadAction<boolean>) {
      state.workspaceSwitcherOpen = action.payload;
    },
  },
});

export const { openDrillDrawer, closeDrillDrawer, setWorkspaceSwitcherOpen } = uiSlice.actions;
export default uiSlice.reducer;
