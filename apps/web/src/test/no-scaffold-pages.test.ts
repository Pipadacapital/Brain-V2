// @paradigm: sql
// Phase-2 slice-10 (feat-parity-cleanup-pages) — CF-S10-NO-SCAFFOLD-1.
// The Founder's literal bar: NO dead stubs. Every page under the app shell must be a
// real, runnable page — none may import the ScaffoldPage placeholder. This is a
// COMMITTED structural test (not a one-time grep) so a regression (a new scaffolded
// page) fails CI immediately (persona C5).
//
// CF-S10-HONEST-STATE-1 (structural companion): the honest-state affordance component
// (ConnectorPending) exists, so connector-live tiles render the truth, not a number.

import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
// src/test → src/app/w/[workspaceSlug]/(shell)
// All shell routes live under the workspace-scoped URL tree since the routing
// fix that introduced /w/[workspaceSlug]/(shell)/* (PR: fix-workspace-routing).
const SHELL_DIR = join(__dirname, '..', 'app', 'w', '[workspaceSlug]', '(shell)');

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else if (entry.endsWith('.tsx') || entry.endsWith('.ts')) out.push(full);
  }
  return out;
}

describe('CF-S10-NO-SCAFFOLD-1 (no dead stubs in the shell)', () => {
  it('the shell directory exists', () => {
    expect(existsSync(SHELL_DIR)).toBe(true);
  });

  it('no (shell) page imports ScaffoldPage', () => {
    const files = walk(SHELL_DIR);
    const offenders = files.filter((f) => /ScaffoldPage/.test(readFileSync(f, 'utf8')));
    expect(offenders).toEqual([]);
  });

  it('no (shell) file renders the "Coming in Phase 2" stub text', () => {
    const files = walk(SHELL_DIR);
    const offenders = files.filter((f) => /Coming in Phase 2/.test(readFileSync(f, 'utf8')));
    expect(offenders).toEqual([]);
  });

  it('the honest-state affordance component (ConnectorPending) exists', () => {
    const comp = join(__dirname, '..', 'interfaces', 'components', 'shared', 'connector-pending.tsx');
    expect(existsSync(comp)).toBe(true);
    expect(readFileSync(comp, 'utf8')).toContain('connector-pending');
  });
});
