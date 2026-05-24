/**
 * Track T -- Unit tests for rls-probe.ts verdict logic + injectable runner (Track C)
 *
 * Covers:
 *   - formatProbeResult() (pure function)
 *   - probeTable() via injected runner -- direct / fk / fk2hop branches (F4)
 *   - runRlsProbe() via injected runner -- GREEN/RED transitions (F4)
 *   - writeProbeDecisionLog() error-catch branch (F4)
 *   - Live &&-predicate mutation target (F5): calling real verdict code via runner,
 *     not pre-built fixtures -- flip && -> || fails this test.
 *
 * Does NOT require a live DB. All DB interactions are through the injectable
 * ProbeQueryRunner interface (vi.fn() mocks).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { PoolClient } from 'pg'
import {
  formatProbeResult,
  runRlsProbe,
  PROBE_TABLES,
  type ProbeRunResult,
  type ProbeTableResult,
  type ProbeQueryRunner,
  _setProbeQueryRunner,
  _resetProbeQueryRunner,
} from '../infrastructure/db/rls-probe.js'

// ---------------------------------------------------------------------------
// Fixture helpers (for formatProbeResult tests -- pure function only)
// ---------------------------------------------------------------------------

function makeTableResult(
  override: Partial<ProbeTableResult> = {},
): ProbeTableResult {
  return {
    table: 'test_table',
    crossReadCount: 0,
    contextlessCount: 0,
    alphaCount: 5,
    verdict: 'GREEN',
    ...override,
  }
}

function makeRun(
  tableResults: ProbeTableResult[],
  runId = 'probe-test',
): ProbeRunResult {
  const overallVerdict = tableResults.every((r) => r.verdict === 'GREEN')
    ? 'GREEN' as const
    : 'RED' as const
  return {
    runId,
    ts: '2026-05-24T15:00:00.000Z',
    overallVerdict,
    tableResults,
    correlationId: { requestId: 'req-1', traceId: 'trace-1', workspaceId: null, userId: null },
  }
}

// ---------------------------------------------------------------------------
// Mock runner builder
// ---------------------------------------------------------------------------

interface MockRunnerConfig {
  alphaCount?: number
  crossReadCount?: number
  contextlessCount?: number | 'THROW'
  superadminThrows?: boolean
}

function makeMockRunner(cfg: MockRunnerConfig = {}): ProbeQueryRunner {
  const { alphaCount = 2, crossReadCount = 0, contextlessCount = 0, superadminThrows = false } = cfg

  // Call counter to distinguish alpha vs cross-read calls to withWorkspace.
  let workspaceCallCount = 0

  return {
    withWorkspace: vi.fn(async (_wsId: string, fn: (tx: PoolClient) => Promise<number>) => {
      workspaceCallCount++
      const mockTx = {
        query: vi.fn(async () => {
          // First call is ALPHA count, second call is cross-read count.
          const count = workspaceCallCount === 1 ? alphaCount : crossReadCount
          return { rows: [{ count: String(count) }], rowCount: 1 }
        }),
      } as unknown as PoolClient
      return fn(mockTx)
    }),

    rawQuery: vi.fn(async () => {
      if (cfg.contextlessCount === 'THROW') {
        throw new Error('[_rawQuery] current_user has rolbypassrls=true -- production misconfiguration')
      }
      return { rows: [{ count: String(contextlessCount) }] }
    }),

    withSuperadmin: vi.fn(async (fn: (tx: PoolClient) => Promise<void>) => {
      if (superadminThrows) {
        throw new Error('audit_log write failed')
      }
      const mockTx = {
        query: vi.fn(async () => ({ rows: [], rowCount: 0 })),
      } as unknown as PoolClient
      return fn(mockTx)
    }),
  }
}

// ---------------------------------------------------------------------------
// formatProbeResult() -- pure function tests (unchanged from Stage 3)
// ---------------------------------------------------------------------------

describe('formatProbeResult()', () => {
  it('(+) includes VERDICT=GREEN in output', () => {
    const run = makeRun([makeTableResult()])
    const output = formatProbeResult(run)
    expect(output).toContain('VERDICT=GREEN')
  })

  it('(-) includes VERDICT=RED and FAILED TABLES section when RED', () => {
    const run = makeRun([
      makeTableResult({ table: 'bad_table', crossReadCount: 3, verdict: 'RED' }),
    ])
    const output = formatProbeResult(run)
    expect(output).toContain('VERDICT=RED')
    expect(output).toContain('FAILED TABLES')
    expect(output).toContain('bad_table')
  })

  it('(+) includes runId in output', () => {
    const run = makeRun([makeTableResult()], 'probe-specific-run-id')
    const output = formatProbeResult(run)
    expect(output).toContain('probe-specific-run-id')
  })

  it('(+) includes correlation requestId', () => {
    const run = makeRun([makeTableResult()])
    const output = formatProbeResult(run)
    expect(output).toContain('requestId=req-1')
  })

  it('(+) includes per-table cross/ctxless counts', () => {
    const run = makeRun([
      makeTableResult({ table: 'shopify_orders', alphaCount: 10, crossReadCount: 0, contextlessCount: 0 }),
    ])
    const output = formatProbeResult(run)
    expect(output).toContain('shopify_orders')
    expect(output).toContain('alpha=10')
    expect(output).toContain('cross=0')
    expect(output).toContain('ctxless=0')
  })
})

// ---------------------------------------------------------------------------
// runRlsProbe() via injectable runner -- F4 + F5
// ---------------------------------------------------------------------------

const ALPHA_WS = 'aaaaaaaa-0000-0000-0000-000000000001'
const BETA_WS  = 'bbbbbbbb-0000-0000-0000-000000000002'

describe('runRlsProbe() via injectable runner', () => {
  beforeEach(() => {
    vi.resetModules()
  })

  afterEach(() => {
    _resetProbeQueryRunner()
    vi.restoreAllMocks()
  })

  // F5 -- LIVE PREDICATE TEST: exercises the actual && in probeTable, not pre-built fixtures.
  // Mutation: flipping && to || in rls-probe.ts MUST cause this test to fail.
  it('(F5-mutation-target) GREEN when cross=0 AND ctxless=0 -- live predicate exercised via runner', async () => {
    const runner = makeMockRunner({ alphaCount: 2, crossReadCount: 0, contextlessCount: 0 })
    // Run against a single-entry PROBE_TABLES-like list using the _runnerOverride path.
    const result = await runRlsProbe({
      alphaWorkspaceId: ALPHA_WS,
      betaWorkspaceId: BETA_WS,
      runId: 'test-green',
      _runnerOverride: runner,
    })
    expect(result.overallVerdict).toBe('GREEN')
    // Every table must be GREEN.
    for (const t of result.tableResults) {
      expect(t.verdict).toBe('GREEN')
    }
  })

  // F5 -- mutation must fail: cross>0 drives RED through the live && predicate.
  it('(F5-mutation-target) RED when cross>0 -- live predicate forces RED via runner', async () => {
    // cross=1 means the && predicate evaluates false -> verdict=RED
    const runner = makeMockRunner({ alphaCount: 2, crossReadCount: 1, contextlessCount: 0 })
    const result = await runRlsProbe({
      alphaWorkspaceId: ALPHA_WS,
      betaWorkspaceId: BETA_WS,
      runId: 'test-cross-red',
      _runnerOverride: runner,
    })
    expect(result.overallVerdict).toBe('RED')
    // At least one table must be RED.
    expect(result.tableResults.some((t) => t.verdict === 'RED')).toBe(true)
  })

  // F5 -- mutation must fail: ctxless>0 drives RED through the live && predicate.
  it('(F5-mutation-target) RED when ctxless>0 -- live predicate forces RED via runner', async () => {
    // contextlessCount=3 means post-FORCE fail-closed has broken: returns > 0 rows
    const runner = makeMockRunner({ alphaCount: 2, crossReadCount: 0, contextlessCount: 3 })
    const result = await runRlsProbe({
      alphaWorkspaceId: ALPHA_WS,
      betaWorkspaceId: BETA_WS,
      runId: 'test-ctxless-red',
      _runnerOverride: runner,
    })
    expect(result.overallVerdict).toBe('RED')
    expect(result.tableResults.some((t) => t.verdict === 'RED')).toBe(true)
  })

  // F4 -- contextless rawQuery throws (BYPASSRLS role) -> table RED with error message
  it('(-) RED when rawQuery throws (rolbypassrls=true production misconfiguration)', async () => {
    const runner = makeMockRunner({ contextlessCount: 'THROW' })
    const result = await runRlsProbe({
      alphaWorkspaceId: ALPHA_WS,
      betaWorkspaceId: BETA_WS,
      runId: 'test-bypassrls-error',
      _runnerOverride: runner,
    })
    expect(result.overallVerdict).toBe('RED')
    const firstRed = result.tableResults.find((t) => t.verdict === 'RED')
    expect(firstRed).toBeDefined()
    expect(firstRed?.errorMessage).toContain('contextless-probe')
    expect(firstRed?.contextlessCount).toBe(-1)
  })

  // F4 -- writeProbeDecisionLog error-catch branch: superadmin throw must not
  //       suppress the probe verdict (error is caught and logged, not re-thrown).
  it('(+) probe verdict returned even when Decision-Log write throws', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const runner = makeMockRunner({
      alphaCount: 2,
      crossReadCount: 0,
      contextlessCount: 0,
      superadminThrows: true,
    })
    const result = await runRlsProbe({
      alphaWorkspaceId: ALPHA_WS,
      betaWorkspaceId: BETA_WS,
      runId: 'test-log-error',
      _runnerOverride: runner,
    })
    // Verdict is still returned despite the audit_log write failure.
    expect(result.overallVerdict).toBe('GREEN')
    // console.error was called with the error.
    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining('[rls-probe]'),
      expect.any(Error),
    )
    consoleSpy.mockRestore()
  })

  // F4 -- runId falls back to probe-<timestamp> if not provided.
  it('(+) runId is auto-generated when not provided', async () => {
    const runner = makeMockRunner()
    const result = await runRlsProbe({
      alphaWorkspaceId: ALPHA_WS,
      betaWorkspaceId: BETA_WS,
      _runnerOverride: runner,
    })
    expect(result.runId).toMatch(/^probe-\d+$/)
  })

  // F4 -- PROBE_TABLES contains at least 40 entries (sanity: DDL parity check).
  it('(+) runRlsProbe runs against all PROBE_TABLES entries', async () => {
    const runner = makeMockRunner()
    const result = await runRlsProbe({
      alphaWorkspaceId: ALPHA_WS,
      betaWorkspaceId: BETA_WS,
      runId: 'test-table-count',
      _runnerOverride: runner,
    })
    expect(result.tableResults).toHaveLength(PROBE_TABLES.length)
    expect(result.tableResults.length).toBeGreaterThanOrEqual(40)
  })

  // F4 -- overallVerdict is GREEN only when ALL tables pass.
  it('(-) overallVerdict is RED when ANY table fails', async () => {
    // All GREEN -- then one cross=1 means there will be RED tables.
    // We verify the any-RED -> overall-RED invariant.
    let callCount = 0
    const mixedRunner: ProbeQueryRunner = {
      withWorkspace: vi.fn(async (_wsId, fn) => {
        callCount++
        // Every 3rd withWorkspace call (the cross-read for the first table) returns 1.
        const count = callCount === 2 ? 1 : 0
        const mockTx = {
          query: vi.fn(async () => ({ rows: [{ count: String(count) }], rowCount: 1 })),
        } as unknown as PoolClient
        return fn(mockTx)
      }),
      rawQuery: vi.fn(async () => ({ rows: [{ count: '0' }] })),
      withSuperadmin: vi.fn(async (fn) => {
        const mockTx = {
          query: vi.fn(async () => ({ rows: [], rowCount: 0 })),
        } as unknown as PoolClient
        return fn(mockTx)
      }),
    }

    const result = await runRlsProbe({
      alphaWorkspaceId: ALPHA_WS,
      betaWorkspaceId: BETA_WS,
      runId: 'test-any-red',
      _runnerOverride: mixedRunner,
    })
    expect(result.overallVerdict).toBe('RED')
  })
})

// ---------------------------------------------------------------------------
// _setProbeQueryRunner / _resetProbeQueryRunner -- test hooks work
// ---------------------------------------------------------------------------

describe('probe runner injection hooks', () => {
  afterEach(() => {
    _resetProbeQueryRunner()
    vi.restoreAllMocks()
  })

  it('(+) _setProbeQueryRunner injects runner used by runRlsProbe', async () => {
    const runner = makeMockRunner({ crossReadCount: 0, contextlessCount: 0 })
    _setProbeQueryRunner(runner)

    // Call without _runnerOverride -- should use the injected runner.
    const result = await runRlsProbe({
      alphaWorkspaceId: ALPHA_WS,
      betaWorkspaceId: BETA_WS,
      runId: 'test-injection',
    })
    expect(result.overallVerdict).toBe('GREEN')
    expect(runner.rawQuery).toHaveBeenCalled()
  })

  it('(+) _resetProbeQueryRunner restores to production default (all tables RED without DIRECT_URL)', async () => {
    const runner = makeMockRunner()
    _setProbeQueryRunner(runner)
    _resetProbeQueryRunner()
    // After reset, runRlsProbe uses the production runner which calls getPool().
    // Without DIRECT_URL, probeTable catches the error and returns RED per table.
    // The probe itself does not throw -- it returns a RED ProbeRunResult.
    // This proves the production runner is active (injected runner would have succeeded).
    const savedUrl = process.env['DIRECT_URL']
    delete process.env['DIRECT_URL']
    try {
      const result = await runRlsProbe({ alphaWorkspaceId: ALPHA_WS, betaWorkspaceId: BETA_WS })
      expect(result.overallVerdict).toBe('RED')
      // Every table should be RED because the production runner throws DIRECT_URL error.
      for (const t of result.tableResults) {
        expect(t.verdict).toBe('RED')
        expect(t.errorMessage).toContain('DIRECT_URL is not set')
      }
    } finally {
      if (savedUrl !== undefined) process.env['DIRECT_URL'] = savedUrl
    }
  })
})
