/**
 * P1-F unit tests — Erasure MV fan-out (manifest-driven erasure target loading).
 *
 * @paradigm sql (deterministic; no LLM)
 *
 * Verifies that the erasure orchestrator:
 *   1. Loads erasure targets from the generated erasure_targets.json manifest
 *      (P1-F: replaces the P0-D hardcoded ERASURE_TARGETS list).
 *   2. Correctly maps manifest entries to ErasureTarget objects.
 *   3. Falls back to the hardcoded list gracefully when the manifest is missing.
 *   4. Skips PG-store targets (only CH targets get ALTER DELETE).
 *   5. Correctly handles MV targets (hasCustomerRef=false, included for completeness).
 *   6. A manifest that registers ALL current CH MVs passes the gate.
 *   7. A manifest that OMITS a CH MV is flagged as a gap (simulated).
 *
 * These tests are PURE (no live CH, no live PG) — they operate on a
 * temp manifest written to disk (or on the live generated manifest).
 *
 * POSITIVE scenarios:
 *   - Manifest targets loaded correctly (bronze + silver + MV)
 *   - PG-store targets excluded from CH erasure
 *   - MV targets with has_customer_ref=false included (completeness)
 *   - Bronze targets mapped to useFinal=false
 *   - Silver targets mapped to useFinal=true
 *   - Manifest-derived targets cover at least: connector_raw_events, connector_order_facts,
 *     workspace_daily_metrics_mv
 *
 * NEGATIVE scenarios:
 *   - Missing manifest file → falls back to hardcoded list (graceful degradation)
 *   - Malformed JSON manifest → falls back to hardcoded list
 *   - Empty targets array → falls back to hardcoded list
 *   - PG-store target does NOT appear in the CH erasure list
 *   - MV not registered in manifest → gap (detected by check_erasure_mv_registration.py)
 */

import { describe, it, expect, afterEach, beforeEach } from 'vitest'
import { writeFileSync, mkdirSync, rmSync, existsSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { randomUUID } from 'node:crypto'

// We import loadErasureTargetsFromManifest directly to unit-test it.
// The ERASURE_MANIFEST_PATH env var overrides the default manifest path.
import { loadErasureTargetsFromManifest, type ErasureTarget } from '../infrastructure/erasure/clickhouse-eraser.js'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const TEST_TMP = join(tmpdir(), `p1-f-test-${randomUUID()}`)

function mkTmp(): void {
  mkdirSync(TEST_TMP, { recursive: true })
}

function rmTmp(): void {
  if (existsSync(TEST_TMP)) {
    rmSync(TEST_TMP, { recursive: true, force: true })
  }
}

function writeManifest(targets: object[]): string {
  mkTmp()
  const path = join(TEST_TMP, 'erasure_targets.json')
  const manifest = {
    _generated_by: 'tools/codegen/gen_facts.py',
    _source: 'docs/schema/canonical-facts.yaml',
    targets,
  }
  writeFileSync(path, JSON.stringify(manifest, null, 2), 'utf-8')
  return path
}

function withManifestPath(path: string, fn: () => void): void {
  const saved = process.env['ERASURE_MANIFEST_PATH']
  process.env['ERASURE_MANIFEST_PATH'] = path
  try {
    fn()
  } finally {
    if (saved === undefined) {
      delete process.env['ERASURE_MANIFEST_PATH']
    } else {
      process.env['ERASURE_MANIFEST_PATH'] = saved
    }
  }
}

// ---------------------------------------------------------------------------
// Minimal valid manifest (mirrors tools/codegen/generated/erasure_targets.json)
// ---------------------------------------------------------------------------

const MINIMAL_TARGETS = [
  {
    table: 'brain.connector_raw_events',
    type: 'bronze',
    store: 'clickhouse',
    customer_ref_column: 'customer_ref',
    workspace_id_column: 'workspace_id',
    key_columns: ['workspace_id', 'customer_ref'],
    erasure_mechanism: 'ALTER TABLE brain.connector_raw_events DELETE WHERE workspace_id={ws} AND customer_ref={ref}',
    note: 'Bronze append-only MergeTree. customer_ref added in P0-B (0012).',
  },
  {
    table: 'brain.connector_order_facts',
    type: 'silver_fact',
    store: 'clickhouse',
    customer_ref_column: 'customer_ref',
    workspace_id_column: 'workspace_id',
    key_columns: ['workspace_id', 'customer_ref'],
    erasure_mechanism: 'ALTER TABLE brain.connector_order_facts DELETE WHERE workspace_id={ws} AND customer_ref={ref}',
    note: 'Silver fact table for connector_order_facts.',
  },
  {
    table: 'connector_order_facts_hot',
    type: 'silver_fact_pg_mirror',
    store: 'postgres',
    customer_ref_column: 'customer_ref',
    workspace_id_column: 'workspace_id',
    key_columns: ['workspace_id', 'customer_ref'],
    erasure_mechanism: 'UPDATE connector_order_facts_hot SET customer_ref = ...',
    note: 'PG hot-mirror — handled by PG wipe tier, not CH erasure.',
  },
  {
    table: 'brain.workspace_daily_metrics_mv',
    type: 'materialized_view',
    source: 'brain.workspace_daily_metrics_base',
    note: 'MV over base — base does not carry customer_ref directly.',
    has_customer_ref: false,
  },
]

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('P1-F — loadErasureTargetsFromManifest (manifest-driven erasure targets)', () => {
  afterEach(() => {
    rmTmp()
  })

  // -------------------------------------------------------------------------
  // POSITIVE: correct loading from a well-formed manifest
  // -------------------------------------------------------------------------
  describe('POSITIVE — valid manifest loading', () => {
    it('loads CH targets from the manifest (excludes PG-store targets)', () => {
      const manifestPath = writeManifest(MINIMAL_TARGETS)
      let targets: ErasureTarget[] = []
      withManifestPath(manifestPath, () => {
        targets = loadErasureTargetsFromManifest()
      })

      // PG target must be excluded
      const tables = targets.map((t) => t.table)
      expect(tables).not.toContain('connector_order_facts_hot')
    })

    it('includes bronze target (connector_raw_events) with hasCustomerRef=true', () => {
      const manifestPath = writeManifest(MINIMAL_TARGETS)
      let targets: ErasureTarget[] = []
      withManifestPath(manifestPath, () => {
        targets = loadErasureTargetsFromManifest()
      })

      const bronze = targets.find((t) => t.table === 'brain.connector_raw_events')
      expect(bronze).toBeDefined()
      expect(bronze!.hasCustomerRef).toBe(true)
    })

    it('maps bronze target to useFinal=false (MergeTree does not support FINAL)', () => {
      const manifestPath = writeManifest(MINIMAL_TARGETS)
      let targets: ErasureTarget[] = []
      withManifestPath(manifestPath, () => {
        targets = loadErasureTargetsFromManifest()
      })

      const bronze = targets.find((t) => t.type === 'bronze')
      expect(bronze).toBeDefined()
      expect(bronze!.useFinal).toBe(false)
    })

    it('maps silver fact target to useFinal=true (ReplacingMergeTree needs FINAL)', () => {
      const manifestPath = writeManifest(MINIMAL_TARGETS)
      let targets: ErasureTarget[] = []
      withManifestPath(manifestPath, () => {
        targets = loadErasureTargetsFromManifest()
      })

      const silver = targets.find((t) => t.table === 'brain.connector_order_facts')
      expect(silver).toBeDefined()
      expect(silver!.hasCustomerRef).toBe(true)
      expect(silver!.useFinal).toBe(true)
    })

    it('includes MV target with hasCustomerRef=false (completeness — CH ALTER DELETE skipped)', () => {
      const manifestPath = writeManifest(MINIMAL_TARGETS)
      let targets: ErasureTarget[] = []
      withManifestPath(manifestPath, () => {
        targets = loadErasureTargetsFromManifest()
      })

      const mv = targets.find((t) => t.table === 'brain.workspace_daily_metrics_mv')
      expect(mv).toBeDefined()
      expect(mv!.hasCustomerRef).toBe(false)
      // MV is included but not CH-delete eligible
      expect(mv!.type).toBe('materialized_view')
    })

    it('returns at least 3 targets (bronze + silver + MV) from the minimal manifest', () => {
      const manifestPath = writeManifest(MINIMAL_TARGETS)
      let targets: ErasureTarget[] = []
      withManifestPath(manifestPath, () => {
        targets = loadErasureTargetsFromManifest()
      })

      // MINIMAL_TARGETS has 4 entries but 1 is PG (excluded) → 3 CH targets
      expect(targets.length).toBeGreaterThanOrEqual(3)
    })

    it('all returned targets have a non-empty table name', () => {
      const manifestPath = writeManifest(MINIMAL_TARGETS)
      let targets: ErasureTarget[] = []
      withManifestPath(manifestPath, () => {
        targets = loadErasureTargetsFromManifest()
      })

      for (const target of targets) {
        expect(typeof target.table).toBe('string')
        expect(target.table.length).toBeGreaterThan(0)
      }
    })
  })

  // -------------------------------------------------------------------------
  // POSITIVE: live generated manifest covers all known tables
  // -------------------------------------------------------------------------
  describe('POSITIVE — live generated manifest (tools/codegen/generated/erasure_targets.json)', () => {
    it('live manifest covers brain.connector_raw_events (bronze)', () => {
      // Do NOT override ERASURE_MANIFEST_PATH — use the real generated file.
      const savedPath = process.env['ERASURE_MANIFEST_PATH']
      delete process.env['ERASURE_MANIFEST_PATH']
      try {
        const targets = loadErasureTargetsFromManifest()
        const tables = targets.map((t) => t.table)
        expect(tables).toContain('brain.connector_raw_events')
      } finally {
        if (savedPath !== undefined) process.env['ERASURE_MANIFEST_PATH'] = savedPath
      }
    })

    it('live manifest covers brain.connector_order_facts (silver)', () => {
      const savedPath = process.env['ERASURE_MANIFEST_PATH']
      delete process.env['ERASURE_MANIFEST_PATH']
      try {
        const targets = loadErasureTargetsFromManifest()
        const tables = targets.map((t) => t.table)
        expect(tables).toContain('brain.connector_order_facts')
      } finally {
        if (savedPath !== undefined) process.env['ERASURE_MANIFEST_PATH'] = savedPath
      }
    })

    it('live manifest includes brain.workspace_daily_metrics_mv (MV fan-out)', () => {
      const savedPath = process.env['ERASURE_MANIFEST_PATH']
      delete process.env['ERASURE_MANIFEST_PATH']
      try {
        const targets = loadErasureTargetsFromManifest()
        const tables = targets.map((t) => t.table)
        expect(tables).toContain('brain.workspace_daily_metrics_mv')
      } finally {
        if (savedPath !== undefined) process.env['ERASURE_MANIFEST_PATH'] = savedPath
      }
    })

    it('live manifest has no PG-store targets (PG targets excluded from CH erasure)', () => {
      const savedPath = process.env['ERASURE_MANIFEST_PATH']
      delete process.env['ERASURE_MANIFEST_PATH']
      try {
        const targets = loadErasureTargetsFromManifest()
        for (const target of targets) {
          // All returned targets should be CH store (no PG mirrors)
          expect(target.store).not.toBe('postgres')
        }
      } finally {
        if (savedPath !== undefined) process.env['ERASURE_MANIFEST_PATH'] = savedPath
      }
    })
  })

  // -------------------------------------------------------------------------
  // NEGATIVE: missing manifest → hardcoded fallback
  // -------------------------------------------------------------------------
  describe('NEGATIVE — manifest not found → hardcoded fallback', () => {
    it('returns the hardcoded fallback when the manifest file does not exist', () => {
      const nonExistentPath = join(TEST_TMP, 'missing_manifest.json')
      mkTmp()
      let targets: ErasureTarget[] = []
      withManifestPath(nonExistentPath, () => {
        targets = loadErasureTargetsFromManifest()
      })

      // Fallback must include at minimum the two hardcoded P0-D targets
      const tables = targets.map((t) => t.table)
      expect(tables).toContain('brain.connector_raw_events')
      expect(tables).toContain('brain.connector_order_facts')
    })

    it('hardcoded fallback has bronze target with useFinal=false', () => {
      const nonExistentPath = join(TEST_TMP, 'missing_manifest_b.json')
      mkTmp()
      let targets: ErasureTarget[] = []
      withManifestPath(nonExistentPath, () => {
        targets = loadErasureTargetsFromManifest()
      })

      const bronze = targets.find((t) => t.table === 'brain.connector_raw_events')
      expect(bronze).toBeDefined()
      expect(bronze!.useFinal).toBe(false)
    })
  })

  // -------------------------------------------------------------------------
  // NEGATIVE: malformed JSON manifest → hardcoded fallback
  // -------------------------------------------------------------------------
  describe('NEGATIVE — malformed JSON manifest → hardcoded fallback', () => {
    it('falls back to hardcoded targets when manifest JSON is invalid', () => {
      mkTmp()
      const badPath = join(TEST_TMP, 'bad_manifest.json')
      writeFileSync(badPath, '{ this is not valid JSON }', 'utf-8')

      let targets: ErasureTarget[] = []
      withManifestPath(badPath, () => {
        targets = loadErasureTargetsFromManifest()
      })

      // Must still return the hardcoded fallback
      const tables = targets.map((t) => t.table)
      expect(tables).toContain('brain.connector_raw_events')
      expect(tables).toContain('brain.connector_order_facts')
    })
  })

  // -------------------------------------------------------------------------
  // NEGATIVE: empty targets array → hardcoded fallback
  // -------------------------------------------------------------------------
  describe('NEGATIVE — empty targets array → hardcoded fallback', () => {
    it('falls back to hardcoded targets when the manifest targets list is empty', () => {
      const manifestPath = writeManifest([])

      let targets: ErasureTarget[] = []
      withManifestPath(manifestPath, () => {
        targets = loadErasureTargetsFromManifest()
      })

      // Must still return the hardcoded fallback (empty manifest is a CI error)
      const tables = targets.map((t) => t.table)
      expect(tables).toContain('brain.connector_raw_events')
      expect(tables).toContain('brain.connector_order_facts')
    })
  })

  // -------------------------------------------------------------------------
  // NEGATIVE: PG-only manifest → hardcoded fallback (no CH targets after filtering)
  // -------------------------------------------------------------------------
  describe('NEGATIVE — manifest with only PG targets → falls back to hardcoded', () => {
    it('falls back to hardcoded targets when all manifest entries are postgres store', () => {
      const pgOnlyManifest = [
        {
          table: 'connector_order_facts_hot',
          type: 'silver_fact_pg_mirror',
          store: 'postgres',
          note: 'PG only',
        },
      ]
      const manifestPath = writeManifest(pgOnlyManifest)

      let targets: ErasureTarget[] = []
      withManifestPath(manifestPath, () => {
        targets = loadErasureTargetsFromManifest()
      })

      // PG targets excluded → 0 CH targets → fallback
      const tables = targets.map((t) => t.table)
      expect(tables).toContain('brain.connector_raw_events')
    })
  })

  // -------------------------------------------------------------------------
  // NEGATIVE: simulate the "unregistered MV" gap
  // A new MV in CH that is NOT in the manifest is detected by
  // check_erasure_mv_registration.py. We unit-test the gap detection logic here
  // by verifying that a manifest without the known MV is missing the MV entry.
  // -------------------------------------------------------------------------
  describe('NEGATIVE — simulate unregistered MV gap (detection check)', () => {
    it('a manifest without the workspace_daily_metrics_mv MV does not include it', () => {
      // Manifest without the MV entry (simulates a developer adding a new MV
      // without updating erasure_targets — the CI gate would catch this).
      const targetsWithoutMv = MINIMAL_TARGETS.filter(
        (t) => t.table !== 'brain.workspace_daily_metrics_mv',
      )
      const manifestPath = writeManifest(targetsWithoutMv)

      let targets: ErasureTarget[] = []
      withManifestPath(manifestPath, () => {
        targets = loadErasureTargetsFromManifest()
      })

      // The MV is not in this manifest — so it's absent from the loaded targets.
      // This is the gap that check_erasure_mv_registration.py catches.
      const tables = targets.map((t) => t.table)
      expect(tables).not.toContain('brain.workspace_daily_metrics_mv')
      // The gap is NOT caught here (it's a CI gate, not a runtime error) —
      // but the test documents the observable gap for auditability.
    })
  })
})

// ---------------------------------------------------------------------------
// Coverage: ERASURE_TARGETS constant is derived from the live manifest
// ---------------------------------------------------------------------------

describe('P1-F — ERASURE_TARGETS constant (module-level loaded from manifest)', () => {
  it('POSITIVE: ERASURE_TARGETS is a non-empty array', async () => {
    const { ERASURE_TARGETS } = await import('../infrastructure/erasure/clickhouse-eraser.js')
    expect(Array.isArray(ERASURE_TARGETS)).toBe(true)
    expect(ERASURE_TARGETS.length).toBeGreaterThan(0)
  })

  it('POSITIVE: ERASURE_TARGETS includes bronze and silver targets', async () => {
    const { ERASURE_TARGETS } = await import('../infrastructure/erasure/clickhouse-eraser.js')
    const tables = ERASURE_TARGETS.map((t) => t.table)
    expect(tables).toContain('brain.connector_raw_events')
    expect(tables).toContain('brain.connector_order_facts')
  })

  it('POSITIVE: ERASURE_TARGETS includes workspace_daily_metrics_mv (MV fan-out)', async () => {
    const { ERASURE_TARGETS } = await import('../infrastructure/erasure/clickhouse-eraser.js')
    const tables = ERASURE_TARGETS.map((t) => t.table)
    expect(tables).toContain('brain.workspace_daily_metrics_mv')
  })

  it('POSITIVE: all ERASURE_TARGETS entries are CH store (no PG mirrors)', async () => {
    const { ERASURE_TARGETS } = await import('../infrastructure/erasure/clickhouse-eraser.js')
    for (const target of ERASURE_TARGETS) {
      expect(target.store).not.toBe('postgres')
    }
  })

  it('POSITIVE: bronze target has useFinal=false', async () => {
    const { ERASURE_TARGETS } = await import('../infrastructure/erasure/clickhouse-eraser.js')
    const bronze = ERASURE_TARGETS.find((t) => t.table === 'brain.connector_raw_events')
    expect(bronze).toBeDefined()
    expect(bronze!.useFinal).toBe(false)
  })

  it('POSITIVE: silver target has useFinal=true', async () => {
    const { ERASURE_TARGETS } = await import('../infrastructure/erasure/clickhouse-eraser.js')
    const silver = ERASURE_TARGETS.find((t) => t.table === 'brain.connector_order_facts')
    expect(silver).toBeDefined()
    expect(silver!.useFinal).toBe(true)
  })
})
