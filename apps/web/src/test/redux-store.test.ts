// @paradigm: sql
// Tests for Redux store slices.
// CF-C6-NEW-LAYER-1: verifies the store has ONLY ui + session slices.

import { describe, it, expect, beforeEach } from 'vitest';
import { configureStore } from '@reduxjs/toolkit';
import { store, type RootState } from '@/domain/store/store';
import uiReducerImport, {
  openDrillDrawer,
  closeDrillDrawer,
  setWorkspaceSwitcherOpen,
} from '@/domain/store/ui-slice';
import sessionReducerImport, {
  setSession,
  clearSession,
} from '@/domain/store/session-slice';

function makeLocalStore() {
  return configureStore({
    reducer: { ui: uiReducerImport, session: sessionReducerImport },
  });
}

describe('Redux store — slice isolation (CF-C6-NEW-LAYER-1)', () => {
  it('store has exactly ui + session keys — no extra slices', () => {
    const state = store.getState();
    const keys = Object.keys(state);
    expect(keys).toHaveLength(2);
    expect(keys).toContain('ui');
    expect(keys).toContain('session');
  });
});

describe('ui-slice', () => {
  let localStore: ReturnType<typeof makeLocalStore>;

  beforeEach(() => {
    localStore = makeLocalStore();
  });

  it('openDrillDrawer sets drawer open with definitionId', () => {
    localStore.dispatch(openDrillDrawer({
      definitionId: 'net_revenue_mu',
      date_start: '2026-04-01',
      date_end: '2026-04-30',
    }));
    const state = localStore.getState() as RootState;
    expect(state.ui.drillDrawer.open).toBe(true);
    expect(state.ui.drillDrawer.definitionId).toBe('net_revenue_mu');
  });

  it('closeDrillDrawer clears all drawer state', () => {
    localStore.dispatch(openDrillDrawer({
      definitionId: 'cm2_mu',
      date_start: '2026-04-01',
      date_end: '2026-04-30',
    }));
    localStore.dispatch(closeDrillDrawer());
    const state = localStore.getState() as RootState;
    expect(state.ui.drillDrawer.open).toBe(false);
    expect(state.ui.drillDrawer.definitionId).toBeNull();
  });

  it('setWorkspaceSwitcherOpen sets boolean correctly', () => {
    localStore.dispatch(setWorkspaceSwitcherOpen(true));
    expect((localStore.getState() as RootState).ui.workspaceSwitcherOpen).toBe(true);
    localStore.dispatch(setWorkspaceSwitcherOpen(false));
    expect((localStore.getState() as RootState).ui.workspaceSwitcherOpen).toBe(false);
  });
});

describe('session-slice', () => {
  let localStore: ReturnType<typeof makeLocalStore>;

  beforeEach(() => {
    localStore = makeLocalStore();
  });

  it('setSession marks authenticated and stores workspace info', () => {
    localStore.dispatch(setSession({
      userId: 'user-uuid',
      workspaceId: 'ws-uuid',
      workspaceRole: 'ANALYST',
    }));
    const state = localStore.getState() as RootState;
    expect(state.session.isAuthenticated).toBe(true);
    expect(state.session.workspaceId).toBe('ws-uuid');
    expect(state.session.workspaceRole).toBe('ANALYST');
  });

  it('clearSession resets all fields', () => {
    localStore.dispatch(setSession({
      userId: 'user-uuid',
      workspaceId: 'ws-uuid',
      workspaceRole: 'MANAGER',
    }));
    localStore.dispatch(clearSession());
    const state = localStore.getState() as RootState;
    expect(state.session.isAuthenticated).toBe(false);
    expect(state.session.userId).toBeNull();
    expect(state.session.workspaceId).toBeNull();
  });

  it('negative: bigint values must NOT be stored in Redux (CF-C6-BIGINT-JSON-1)', () => {
    // BigInt in Redux causes serialization errors / breaks cross-tab sync.
    // This test proves session state has no bigint fields.
    localStore.dispatch(setSession({
      userId: '00000000-0000-0000-0000-000000000099',
      workspaceId: '00000000-0000-0000-0000-000000000001',
      workspaceRole: 'OWNER',
    }));
    const state = localStore.getState() as RootState;
    for (const [_key, value] of Object.entries(state.session)) {
      expect(typeof value === 'bigint').toBe(false);
    }
  });
});
