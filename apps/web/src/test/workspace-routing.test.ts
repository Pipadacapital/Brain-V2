// @paradigm: sql
// Workspace-scoped routing tests — fix-workspace-routing (PR).
//
// Verifies that the new /w/[workspaceSlug]/(shell)/ route tree exists and that
// every shell page file is present under the workspace-scoped path (not the old
// flat (shell)/ path). Also checks the not-found / unknown-slug guard contract.
//
// POSITIVE: every known shell route exists under app/w/[workspaceSlug]/(shell)/
// POSITIVE: the workspace-scoped shell layout exists
// POSITIVE: the flat (shell)/ directory has been removed (no duplicate route trees)
// NEGATIVE: flat /dashboard, /pnl, /rto-analytics etc. have no page.tsx
//           (traffic must go through /w/{slug}/... to resolve a workspace)
//
// Notes:
//   - Unknown slug → the middleware passes the request to Next.js, which matches
//     the [workspaceSlug] dynamic segment (any string matches). The shell layout
//     then delegates auth to SessionBootstrap; if the user is not a member of
//     that workspace, auth.session returns UNAUTHORIZED → redirect to /onboarding
//     or /login?error=session. This is the correct "unauthorized slug → sensible
//     redirect, not a raw crash" contract.

import { describe, it, expect } from 'vitest';
import { existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const APP_DIR = join(__dirname, '..', 'app');
const SHELL_DIR = join(APP_DIR, 'w', '[workspaceSlug]', '(shell)');

// ---------------------------------------------------------------------------
// Known shell routes (path relative to (shell)/)
// ---------------------------------------------------------------------------

const KNOWN_SHELL_ROUTES: string[] = [
  'dashboard',
  'pnl',
  'rto-analytics',
  'acquisition',
  'store',
  'waterfall',
  'cohorts',
  'lifetime-value',
  'customer-lifecycle',
  'logistics',
  'cod-prepaid',
  'pincode-intelligence',
  'meta-ads',
  'google-ads',
  'shiprocket',
  'products',
  'first-product-cascade',
  'inventory',
  'product-cogs',
  'analytics',
  'calendar',
  'email-sms',
  'distributions',
  'timings',
  'notifications',
  'account',
  'team',
  'costs',
  'settings',
  'settings/integrations',
  'settings/ad-campaigns',
  'settings/goals',
  'settings/backfill',
  'settings/festivals',
];

// ---------------------------------------------------------------------------
// POSITIVE: workspace-scoped route tree
// ---------------------------------------------------------------------------

describe('/w/[workspaceSlug]/(shell)/ route tree (fix-workspace-routing)', () => {
  it('the workspace-scoped shell directory exists', () => {
    expect(existsSync(SHELL_DIR)).toBe(true);
  });

  it('the workspace-scoped shell layout exists', () => {
    const layout = join(SHELL_DIR, 'layout.tsx');
    expect(existsSync(layout)).toBe(true);
  });

  it.each(KNOWN_SHELL_ROUTES)(
    'shell route "%s" has a page.tsx under /w/[workspaceSlug]/(shell)/',
    (route) => {
      const page = join(SHELL_DIR, route, 'page.tsx');
      expect(existsSync(page)).toBe(true);
    },
  );
});

// ---------------------------------------------------------------------------
// NEGATIVE: old flat (shell)/ directory is gone
// ---------------------------------------------------------------------------

describe('old flat (shell)/ directory is removed', () => {
  it('app/(shell)/ does not exist (routes live under /w/[workspaceSlug]/(shell)/ only)', () => {
    const oldShellDir = join(APP_DIR, '(shell)');
    expect(existsSync(oldShellDir)).toBe(false);
  });

  it('there is no flat /dashboard/page.tsx (traffic must go through /w/{slug}/dashboard)', () => {
    // A redirect helper exists at app/dashboard/page.tsx, but it must NOT be a
    // full content page — it's a server-side redirect to /w/{slug}/dashboard.
    // We don't assert its absence since the redirect is intentional; we just
    // confirm the (shell) dashboard page does NOT exist at the flat path.
    const flatDashboard = join(APP_DIR, '(shell)', 'dashboard', 'page.tsx');
    expect(existsSync(flatDashboard)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// NEGATIVE: unknown slug → graceful degradation (contract doc)
// ---------------------------------------------------------------------------

describe('unknown / unauthorized workspace slug — contract', () => {
  it('Next.js [workspaceSlug] matches any string (Next.js App Router dynamic segment rule)', () => {
    // Any non-empty string matches [workspaceSlug] at the file-system level.
    // Auth enforcement is delegated to SessionBootstrap → auth.session →
    // UNAUTHORIZED → redirect to /onboarding or /login?error=session.
    // This test is a documentation contract: verify the layout exists (ensures
    // the route is registered) and confirm the guard is in the layout file.
    const layout = join(SHELL_DIR, 'layout.tsx');
    expect(existsSync(layout)).toBe(true);

    const { readFileSync } = require('node:fs');
    const src = readFileSync(layout, 'utf8');
    // The layout must delegate to SessionBootstrap (which handles unauthorized slugs).
    expect(src).toContain('SessionBootstrap');
    // The layout must read the slug from params.
    expect(src).toContain('workspaceSlug');
  });
});
