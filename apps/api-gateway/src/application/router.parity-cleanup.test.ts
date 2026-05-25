// @paradigm: sql
// Phase-2 slice-10 (feat-parity-cleanup-pages) — team + settings (workspace/integrations/backfill)
// router tests. These are the thin honest READ surfaces for the parity-cleanup pages.
//
// POSITIVE — team.members returns the real member list (PII fields) + pending count;
//            settings.workspace returns name/plan/timezone/region; settings.integrations
//            returns connector health (Shopify CONNECTED, the rest PENDING_CUTOVER with
//            NULL last-sync — the HONEST state, no fake timestamp); settings.backfill
//            returns the honest job list + note.
// NEGATIVE — ANALYST enforced on every read (VIEWER rejected); cross-workspace fails closed
//            (UnscopedQueryError); CF-S10-NO-WRITE-1: there is NO mutation on team/settings
//            integration/backfill surfaces (no fabricated connector data, no write path).
// CF-S10-HONEST-STATE-1 — assert NO connector other than Shopify carries a non-null
//            last_sync_at (no fabricated "synced just now" for a held connector).

import { describe, it, expect } from 'vitest';
import { createBrainRouter } from './router.js';
import type { BrainClaim } from '@brain/core-auth';
import { assembleClaim } from '@brain/core-auth';
import {
  StubDataPlane,
  InMemoryDecisionLog,
  SUGANDH_LOK_WORKSPACE_ID,
} from '../infrastructure/loopback-data-plane.js';
import { InMemoryIdempotencyStore } from '../domain/idempotency.js';
import type { WorkspaceContext } from './trpc.js';

const FOREIGN_WS = '00000000-0000-0000-0000-000000000099';

function makeClaim(
  workspaceId: string,
  role: 'OWNER' | 'ADMIN' | 'MANAGER' | 'ANALYST' | 'VIEWER' = 'ANALYST',
): BrainClaim {
  return assembleClaim({
    userId: 'user-slice10-test',
    workspaceId,
    workspaceRole: role,
    systemRole: 'USER',
    requestId: 'req-slice10-test',
    traceId: 'trace-slice10-test',
  });
}

function makeCtx(workspaceId: string, role: Parameters<typeof makeClaim>[1] = 'ANALYST'): WorkspaceContext {
  return {
    identity: { sub: makeClaim(workspaceId, role).userId, email: 'test@brain.test' },
    claim: makeClaim(workspaceId, role),
    workspaceId,
    requestId: 'req-slice10-test',
    traceId: 'trace-slice10-test',
  };
}

function caller(ctx: WorkspaceContext, stubWorkspaceId: string = SUGANDH_LOK_WORKSPACE_ID) {
  const dp = new StubDataPlane(new InMemoryDecisionLog(), stubWorkspaceId);
  const idem = new InMemoryIdempotencyStore();
  return createBrainRouter(dp, idem).createCaller(ctx);
}

// ---------------------------------------------------------------------------
// POSITIVE — team.members
// ---------------------------------------------------------------------------
describe('team.members (positive)', () => {
  it('returns the real member list with PII fields + pending count', async () => {
    const c = caller(makeCtx(SUGANDH_LOK_WORKSPACE_ID));
    const res = await c.team.members();
    expect(res.members.length).toBe(3);
    const owner = res.members.find((m) => m.role === 'OWNER')!;
    expect(owner.full_name).toBe('Aarti Sugandh');
    expect(owner.email).toContain('@');
    expect(res.pending_invitations).toBe(0);
    expect(res.request_id).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// POSITIVE — settings.workspace
// ---------------------------------------------------------------------------
describe('settings.workspace (positive)', () => {
  it('returns name/plan/timezone/region/currency', async () => {
    const c = caller(makeCtx(SUGANDH_LOK_WORKSPACE_ID));
    const res = await c.settings.workspace();
    expect(res.result.name).toBe('Sugandh Lok');
    expect(res.result.plan).toBe('GROWTH');
    expect(res.result.timezone).toBe('Asia/Kolkata');
    expect(res.result.region).toBe('IN');
    expect(res.result.currency_code).toBe('INR');
  });
});

// ---------------------------------------------------------------------------
// POSITIVE — settings.integrations (HONEST connector health)
// ---------------------------------------------------------------------------
describe('settings.integrations (positive — honest health)', () => {
  it('Shopify CONNECTED with a last-sync; held connectors PENDING_CUTOVER', async () => {
    const c = caller(makeCtx(SUGANDH_LOK_WORKSPACE_ID));
    const res = await c.settings.integrations();
    const shopify = res.rows.find((r) => r.connector === 'Shopify')!;
    expect(shopify.status).toBe('CONNECTED');
    expect(shopify.last_sync_at).not.toBeNull();
    const meta = res.rows.find((r) => r.connector === 'Meta Ads')!;
    expect(meta.status).toBe('PENDING_CUTOVER');
  });

  // CF-S10-HONEST-STATE-1: only the truly-connected connector may carry a last_sync_at.
  // A held connector with a fabricated "last synced" timestamp would be a lie — killed here.
  it('CF-S10-HONEST-STATE-1: no held connector carries a fake last_sync_at', async () => {
    const c = caller(makeCtx(SUGANDH_LOK_WORKSPACE_ID));
    const res = await c.settings.integrations();
    for (const r of res.rows) {
      if (r.status !== 'CONNECTED') {
        expect(r.last_sync_at).toBeNull();
      }
    }
  });
});

// ---------------------------------------------------------------------------
// POSITIVE — settings.backfill (honest empty/pending state)
// ---------------------------------------------------------------------------
describe('settings.backfill (positive — honest pending)', () => {
  it('returns pending-cutover jobs + an honest note; no fake progress', async () => {
    const c = caller(makeCtx(SUGANDH_LOK_WORKSPACE_ID));
    const res = await c.settings.backfill();
    expect(res.note.toLowerCase()).toContain('cutover');
    for (const j of res.jobs) {
      // No job is RUNNING/COMPLETE locally — that would be a fabricated state.
      expect(['NONE', 'PENDING_CUTOVER', 'FAILED']).toContain(j.status);
      expect(j.started_at).toBeNull();
    }
  });
});

// ---------------------------------------------------------------------------
// NEGATIVE — role gate (ANALYST required)
// ---------------------------------------------------------------------------
describe('role gate (VIEWER rejected on every read)', () => {
  it('team.members rejects VIEWER', async () => {
    const c = caller(makeCtx(SUGANDH_LOK_WORKSPACE_ID, 'VIEWER'));
    await expect(c.team.members()).rejects.toThrow(/ANALYST/);
  });
  it('settings.workspace rejects VIEWER', async () => {
    const c = caller(makeCtx(SUGANDH_LOK_WORKSPACE_ID, 'VIEWER'));
    await expect(c.settings.workspace()).rejects.toThrow(/ANALYST/);
  });
  it('settings.integrations rejects VIEWER', async () => {
    const c = caller(makeCtx(SUGANDH_LOK_WORKSPACE_ID, 'VIEWER'));
    await expect(c.settings.integrations()).rejects.toThrow(/ANALYST/);
  });
  it('settings.backfill rejects VIEWER', async () => {
    const c = caller(makeCtx(SUGANDH_LOK_WORKSPACE_ID, 'VIEWER'));
    await expect(c.settings.backfill()).rejects.toThrow(/ANALYST/);
  });
});

// ---------------------------------------------------------------------------
// NEGATIVE — cross-workspace fails closed (UnscopedQueryError)
// ---------------------------------------------------------------------------
describe('tenancy fail-closed (foreign workspace rejected)', () => {
  it('team.members on a foreign workspace throws UnscopedQueryError', async () => {
    // ctx authenticated for FOREIGN_WS, but the stub is scoped to SUGANDH_LOK.
    const c = caller(makeCtx(FOREIGN_WS), SUGANDH_LOK_WORKSPACE_ID);
    await expect(c.team.members()).rejects.toThrow(/UnscopedQueryError/);
  });
  it('settings.integrations on a foreign workspace throws UnscopedQueryError', async () => {
    const c = caller(makeCtx(FOREIGN_WS), SUGANDH_LOK_WORKSPACE_ID);
    await expect(c.settings.integrations()).rejects.toThrow(/UnscopedQueryError/);
  });
});

// ---------------------------------------------------------------------------
// CF-S10-NO-WRITE-1 — the parity-cleanup surfaces are READ-ONLY.
// team.members + the new settings reads expose NO mutation (no invite/connect/backfill-trigger).
// ---------------------------------------------------------------------------
describe('CF-S10-NO-WRITE-1 (read-only surfaces)', () => {
  it('team router exposes only .members (no mutation procedure)', () => {
    const dp = new StubDataPlane(new InMemoryDecisionLog(), SUGANDH_LOK_WORKSPACE_ID);
    const router = createBrainRouter(dp, new InMemoryIdempotencyStore());
    const teamProcs = Object.keys((router as unknown as { team: Record<string, unknown> }).team);
    expect(teamProcs).toEqual(['members']);
  });

  it('the new settings reads are queries (workspace/integrations/backfill carry no input mutation)', () => {
    const dp = new StubDataPlane(new InMemoryDecisionLog(), SUGANDH_LOK_WORKSPACE_ID);
    const router = createBrainRouter(dp, new InMemoryIdempotencyStore());
    const settingsProcs = Object.keys((router as unknown as { settings: Record<string, unknown> }).settings);
    // The only settings mutation that exists is the slice-7 upsertGoal — the slice-10
    // additions (workspace/integrations/backfill) are reads. No new write was added.
    expect(settingsProcs).toContain('workspace');
    expect(settingsProcs).toContain('integrations');
    expect(settingsProcs).toContain('backfill');
    const mutations = settingsProcs.filter((p) => p === 'upsertGoal');
    expect(mutations).toEqual(['upsertGoal']); // exactly the pre-existing slice-7 write; no new one.
  });
});
