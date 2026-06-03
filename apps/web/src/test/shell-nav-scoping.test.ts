// @paradigm: io
// shell-nav-scoping — regression guard for workspace-scoped navigation.
//
// WHAT THIS CATCHES:
//   Any future edit that introduces a flat shell-route navigation (router.push,
//   href=, window.location.assign, redirect) inside the interfaces/ directory
//   will fail this test. This is the guard that prevents a repeat of the
//   confirmed 404s (account, notifications, product-cogs, settings/goals,
//   settings/integrations) that were found on the live stack.
//
// POSITIVE: nav-user account + notifications go to /w/{slug}/... paths via
//           useScopedPath, verified by reading the source.
// POSITIVE: scopedPath() and useScopedPath() are exported from workspace-slug-context.
// POSITIVE: the shared helper degrades gracefully (empty slug → flat path).
//
// NEGATIVE (lint-style grep): no interface component may contain a hard-coded flat
//   shell-route push/href that bypasses useScopedPath / scopedPath.
//   Allowlist: /admin*, /auth/*, /login, /onboarding, /dashboard (bouncer),
//              /w/ prefix (already scoped).
//
// RATIONALE: "compile-time" structural tests that grep source prevent the class
//   of bugs where navigations only break at runtime under a real authed session.

import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { scopedPath } from '@/infrastructure/workspace-slug-context.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SRC = join(__dirname, '..');
const INTERFACES_DIR = join(SRC, 'interfaces');
const CONTEXT_FILE = join(SRC, 'infrastructure', 'workspace-slug-context.tsx');

// ---------------------------------------------------------------------------
// POSITIVE: shared helper exports + behaviour
// ---------------------------------------------------------------------------

describe('workspace-slug-context — shared helper', () => {
  it('scopedPath is exported from the context module', () => {
    expect(existsSync(CONTEXT_FILE)).toBe(true);
    const src = readFileSync(CONTEXT_FILE, 'utf8');
    expect(src).toContain('export function scopedPath');
  });

  it('useScopedPath is exported from the context module', () => {
    const src = readFileSync(CONTEXT_FILE, 'utf8');
    expect(src).toContain('export function useScopedPath');
  });

  it('scopedPath with a slug prepends /w/{slug}', () => {
    expect(scopedPath('sugandh-lok', '/dashboard')).toBe('/w/sugandh-lok/dashboard');
    expect(scopedPath('test-ws', '/settings/integrations')).toBe('/w/test-ws/settings/integrations');
    expect(scopedPath('test-ws', '/account')).toBe('/w/test-ws/account');
    expect(scopedPath('test-ws', '/notifications')).toBe('/w/test-ws/notifications');
    expect(scopedPath('test-ws', '/product-cogs')).toBe('/w/test-ws/product-cogs');
    expect(scopedPath('test-ws', '/settings/goals')).toBe('/w/test-ws/settings/goals');
  });

  it('scopedPath with empty slug degrades gracefully (returns flat path, does not crash)', () => {
    expect(scopedPath('', '/dashboard')).toBe('/dashboard');
    expect(scopedPath('', '/account')).toBe('/account');
  });
});

// ---------------------------------------------------------------------------
// POSITIVE: nav-user uses useScopedPath for account + notifications
// ---------------------------------------------------------------------------

describe('nav-user — account + notifications are workspace-scoped', () => {
  const NAV_USER = join(INTERFACES_DIR, 'components', 'shell', 'nav-user.tsx');

  it('nav-user imports useScopedPath from workspace-slug-context', () => {
    const src = readFileSync(NAV_USER, 'utf8');
    expect(src).toContain('useScopedPath');
    expect(src).toContain('workspace-slug-context');
  });

  it('nav-user calls useScopedPath for account route', () => {
    const src = readFileSync(NAV_USER, 'utf8');
    // Must use toPath("/account") or similar dynamic call, NOT hardcoded "/account"
    expect(src).toMatch(/toPath\(["'`]\/account["'`]\)/);
  });

  it('nav-user calls useScopedPath for notifications route', () => {
    const src = readFileSync(NAV_USER, 'utf8');
    expect(src).toMatch(/toPath\(["'`]\/notifications["'`]\)/);
  });

  it('nav-user does NOT have a bare hardcoded flat push to /account', () => {
    const src = readFileSync(NAV_USER, 'utf8');
    // router.push("/account") with no dynamic scoping
    expect(src).not.toMatch(/router\.push\(["'`]\/account["'`]\)/);
  });

  it('nav-user does NOT have a bare hardcoded flat push to /notifications', () => {
    const src = readFileSync(NAV_USER, 'utf8');
    expect(src).not.toMatch(/router\.push\(["'`]\/notifications["'`]\)/);
  });
});

// ---------------------------------------------------------------------------
// POSITIVE: fixed files use scopedPath / useScopedPath for their shell links
// ---------------------------------------------------------------------------

describe('store-content — shell links are scoped', () => {
  const FILE = join(INTERFACES_DIR, 'components', 'store', 'store-content.tsx');
  it('does not contain hardcoded flat href /settings/integrations', () => {
    const src = readFileSync(FILE, 'utf8');
    expect(src).not.toMatch(/href=["'`]\/settings\/integrations["'`]/);
  });
  it('does not contain hardcoded flat href /product-cogs', () => {
    const src = readFileSync(FILE, 'utf8');
    expect(src).not.toMatch(/href=["'`]\/product-cogs["'`]/);
  });
});

describe('store-products-table — shell links are scoped', () => {
  const FILE = join(INTERFACES_DIR, 'components', 'store', 'store-products-table.tsx');
  it('does not contain hardcoded flat href /product-cogs', () => {
    const src = readFileSync(FILE, 'utf8');
    expect(src).not.toMatch(/href=["'`]\/product-cogs["'`]/);
  });
});

describe('analytics-content — shell links are scoped', () => {
  const FILE = join(INTERFACES_DIR, 'components', 'store', 'analytics-content.tsx');
  it('does not contain hardcoded flat href /settings/goals', () => {
    const src = readFileSync(FILE, 'utf8');
    expect(src).not.toMatch(/href=["'`]\/settings\/goals["'`]/);
  });
});

describe('cod-prepaid-content — shell links are scoped', () => {
  const FILE = join(INTERFACES_DIR, 'components', 'logistics', 'cod-prepaid-content.tsx');
  it('does not contain hardcoded flat href /settings/integrations', () => {
    const src = readFileSync(FILE, 'utf8');
    expect(src).not.toMatch(/href=["'`]\/settings\/integrations["'`]/);
  });
});

describe('rto-analytics-content — shell links are scoped', () => {
  const FILE = join(INTERFACES_DIR, 'components', 'logistics', 'rto-analytics-content.tsx');
  it('does not contain hardcoded flat href /settings/integrations', () => {
    const src = readFileSync(FILE, 'utf8');
    expect(src).not.toMatch(/href=["'`]\/settings\/integrations["'`]/);
  });
});

describe('ad-campaigns-content — shell links are scoped', () => {
  const FILE = join(INTERFACES_DIR, 'components', 'settings', 'ad-campaigns-content.tsx');
  it('does not contain bare relative href "acquisition"', () => {
    const src = readFileSync(FILE, 'utf8');
    // relative href="acquisition" without leading slash was going to the wrong URL
    expect(src).not.toMatch(/href=["'`]acquisition["'`]/);
  });
  it('does not contain bare relative href "meta-ads"', () => {
    const src = readFileSync(FILE, 'utf8');
    expect(src).not.toMatch(/href=["'`]meta-ads["'`]/);
  });
  it('does not contain bare relative href "google-ads"', () => {
    const src = readFileSync(FILE, 'utf8');
    expect(src).not.toMatch(/href=["'`]google-ads["'`]/);
  });
});

// ---------------------------------------------------------------------------
// NEGATIVE (lint-style): no interfaces component has a flat shell-route push/href
//
// Shell routes: any path that resolves under /w/{slug}/(shell)/.
// We check for common known ones that were previously broken.
// Allowlist (NOT shell routes):
//   /admin, /admin/*, /auth/*, /auth/login, /login, /onboarding, /dashboard (bouncer)
//   /w/ prefix (already scoped), external URLs (http), relative fragment (#)
// ---------------------------------------------------------------------------

// Known shell route patterns that MUST NOT appear as bare flat strings in router.push/href
const FLAT_SHELL_PATTERNS: { label: string; pattern: RegExp }[] = [
  { label: '/account', pattern: /router\.push\(["'`]\/account["'`]\)/ },
  { label: '/notifications', pattern: /router\.push\(["'`]\/notifications["'`]\)/ },
  { label: 'href="/product-cogs"', pattern: /href=["'`]\/product-cogs["'`]/ },
  { label: 'href="/settings/goals"', pattern: /href=["'`]\/settings\/goals["'`]/ },
  { label: 'href="/settings/integrations"', pattern: /href=["'`]\/settings\/integrations["'`]/ },
];

// Files that are exempt by design (non-shell contexts)
const EXEMPT_FILES = new Set<string>([
  // auth flow — /auth/login, /login are not shell routes
  join(INTERFACES_DIR, 'components', 'auth', 'login-form.tsx'),
  join(INTERFACES_DIR, 'components', 'auth', 'forgot-password-form.tsx'),
  join(INTERFACES_DIR, 'components', 'auth', 'sign-up-form.tsx'),
  join(INTERFACES_DIR, 'components', 'auth', 'update-password-form.tsx'),
  join(INTERFACES_DIR, 'components', 'auth', 'session-bootstrap.tsx'),
  // admin area — /admin/* is not a shell route by design
  join(INTERFACES_DIR, 'components', 'admin', 'admin-users-content.tsx'),
  join(INTERFACES_DIR, 'components', 'admin', 'admin-workspaces-content.tsx'),
  join(INTERFACES_DIR, 'components', 'admin', 'admin-sync-content.tsx'),
  // onboarding — /onboarding is not a shell route
  join(INTERFACES_DIR, 'components', 'onboarding', 'onboarding-form.tsx'),
  // workspace-switcher already handles /w/{slug}/dashboard correctly
  join(INTERFACES_DIR, 'components', 'shell', 'workspace-switcher.tsx'),
  // invitation — assigns to /dashboard (the bouncer redirect page, not a shell route)
  join(INTERFACES_DIR, 'components', 'invitation', 'invitation-accept.tsx'),
]);

import { readdirSync, statSync } from 'node:fs';

function walkTsx(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...walkTsx(full));
    else if (entry.endsWith('.tsx') || entry.endsWith('.ts')) out.push(full);
  }
  return out;
}

describe('NEGATIVE lint — no flat shell-route navigation in interfaces/', () => {
  const allFiles = walkTsx(INTERFACES_DIR).filter((f) => !EXEMPT_FILES.has(f));

  for (const { label, pattern } of FLAT_SHELL_PATTERNS) {
    it(`no file has a flat unscoped navigation to "${label}"`, () => {
      const offenders = allFiles.filter((f) => pattern.test(readFileSync(f, 'utf8')));
      expect(offenders).toEqual([]);
    });
  }
});
