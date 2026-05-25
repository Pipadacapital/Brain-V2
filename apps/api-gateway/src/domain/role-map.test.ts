// @paradigm: sql
// Slice A — legacy→Brain role map (reconciliation #1).

import { describe, it, expect } from 'vitest';
import { legacyRoleToBrain } from './role-map.js';

describe('legacyRoleToBrain', () => {
  it('maps EDITOR → MANAGER (the one non-identity mapping)', () => {
    expect(legacyRoleToBrain('EDITOR')).toBe('MANAGER');
  });

  it('maps OWNER/ADMIN/VIEWER 1:1', () => {
    expect(legacyRoleToBrain('OWNER')).toBe('OWNER');
    expect(legacyRoleToBrain('ADMIN')).toBe('ADMIN');
    expect(legacyRoleToBrain('VIEWER')).toBe('VIEWER');
  });

  it('NEGATIVE: throws (fail-closed) on an unknown legacy role — never defaults to a grant', () => {
    expect(() => legacyRoleToBrain('SUPERUSER')).toThrow(/unknown legacy/i);
    expect(() => legacyRoleToBrain('')).toThrow();
    expect(() => legacyRoleToBrain('MANAGER')).toThrow(); // MANAGER is a Brain role, not legacy
  });
});
