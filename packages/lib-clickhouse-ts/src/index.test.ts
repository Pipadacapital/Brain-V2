// Regression suite for decorateWithFinal (advisor review P1-13). This regex broke
// production twice: (1) FINAL placed BEFORE the alias → CH SYNTAX_ERROR on every
// aliased fact read; (2) JOINed fact tables never decorated → un-merged RMT
// duplicates double-counted. Both are pinned below so a re-break fails CI.
import { describe, it, expect } from 'vitest';
import { decorateWithFinal } from './index.js';

const T = 'connector_order_facts';

describe('decorateWithFinal — FINAL placement', () => {
  it('bare FROM (no alias) → FINAL right after the table', () => {
    expect(decorateWithFinal(`SELECT 1 FROM brain.${T} WHERE workspace_id = {w:String}`))
      .toContain(`brain.${T} FINAL WHERE`);
  });

  it('FROM with a bare alias → FINAL AFTER the alias (not before — the prod break)', () => {
    const out = decorateWithFinal(`SELECT 1 FROM brain.${T} o WHERE o.workspace_id = {w:String}`);
    expect(out).toContain(`${T} o FINAL`);
    expect(out).not.toContain(`${T} FINAL o`); // the SYNTAX_ERROR form
  });

  it('FROM with an AS alias → FINAL after the alias', () => {
    const out = decorateWithFinal(`SELECT 1 FROM brain.${T} AS o WHERE o.workspace_id = {w:String}`);
    expect(out).toContain(`${T} AS o FINAL`);
    expect(out).not.toContain(`${T} FINAL AS o`);
  });

  it('does NOT swallow a following keyword (WHERE/GROUP) as an alias', () => {
    expect(decorateWithFinal(`SELECT 1 FROM brain.${T}\n  WHERE workspace_id = {w:String}`))
      .toContain(`${T} FINAL`);
    expect(decorateWithFinal(`SELECT vendor FROM brain.connector_ad_spend_facts GROUP BY vendor`))
      .toContain(`connector_ad_spend_facts FINAL GROUP BY`);
  });
});

describe('decorateWithFinal — JOINs (the doubled-revenue break)', () => {
  it('decorates a JOINed fact table', () => {
    expect(decorateWithFinal(`... JOIN brain.${T} ON x=y`)).toContain(`${T} FINAL ON`);
  });

  it('decorates BOTH the FROM and the JOIN, each after its alias', () => {
    const out = decorateWithFinal(
      `SELECT * FROM brain.connector_line_item_facts AS li LEFT JOIN brain.${T} o ON o.k = li.k`,
    );
    expect(out).toContain('connector_line_item_facts AS li FINAL');
    expect(out).toContain(`${T} o FINAL ON`);
  });
});

describe('decorateWithFinal — idempotency + scope', () => {
  it('is idempotent across the alias forms (no double FINAL)', () => {
    for (const sql of [
      `FROM brain.${T} FINAL`,
      `FROM brain.${T} AS o FINAL`,
      `FROM brain.${T} o FINAL`,
    ]) {
      const out = decorateWithFinal(sql);
      expect(out).toBe(sql);
      expect(out.match(/FINAL/g)?.length).toBe(1);
    }
  });

  it('leaves non-fact tables untouched', () => {
    const sql = `SELECT * FROM brain.workspaces WHERE id = {w:String}`;
    expect(decorateWithFinal(sql)).toBe(sql);
  });

  it('handles both brain.-prefixed and bare table refs', () => {
    expect(decorateWithFinal(`FROM ${T} WHERE x`)).toContain(`${T} FINAL`);
    expect(decorateWithFinal(`FROM brain.${T} WHERE x`)).toContain(`brain.${T} FINAL`);
  });

  it('produces valid alias-after-FINAL for the cohort/distribution/calendar shapes', () => {
    // these were the four queries that 500'd with the old before-alias placement
    const out = decorateWithFinal(
      `SELECT customer_ref FROM brain.${T} AS o WHERE o.workspace_id = {w:String} GROUP BY customer_ref`,
    );
    expect(out).toContain(`${T} AS o FINAL WHERE`);
  });
});
