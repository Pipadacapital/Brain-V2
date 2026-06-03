/**
 * sync-scheduler.test.ts — unit tests for the near-real-time ad-spend poll scheduler.
 *
 * @paradigm sql (pure deterministic scheduling logic; NO network, NO DB, NO real timer wait)
 *
 * Strategy:
 *   - runSchedulerTick() is exported and called directly — no fake timers needed.
 *   - syncConnector and readConnectedVendors are injected via SchedulerDeps — no real DB.
 *   - startSyncScheduler / stopSyncScheduler lifecycle is tested with a spy on setInterval
 *     (enabled flag gate only — we do not wait for interval ticks to fire).
 *
 * Coverage:
 *   POSITIVE — tick enumerates workspaces+vendors and calls doSync per connected connector
 *   POSITIVE — a thrown doSync is isolated (others still run; summary counts correct)
 *   POSITIVE — doSync returning { status: 'error' } is isolated (others still run)
 *   POSITIVE — no connected vendors = no doSync calls
 *   POSITIVE — multiple workspaces are all iterated
 *   POSITIVE — readConnectedVendors failure is isolated (other workspaces continue)
 *   NEGATIVE — startSyncScheduler double-start guard prevents second setInterval
 *   POSITIVE — stopSyncScheduler clears the interval handle
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { runSchedulerTick, startSyncScheduler, stopSyncScheduler } from './sync-scheduler.js'
import type { SchedulerDeps } from './sync-scheduler.js'
import type { SyncResult } from '@brain/core-connectors'
import type { ConnectorVendor } from '@brain/core-connectors'

// ---------------------------------------------------------------------------
// Logger stub (Pino-compatible minimal interface)
// ---------------------------------------------------------------------------

function makeLogger() {
  return {
    info: vi.fn<(msg: string, obj?: object) => void>(),
    warn: vi.fn<(obj: object, msg: string) => void>(),
    error: vi.fn<(obj: object, msg: string) => void>(),
  }
}

// ---------------------------------------------------------------------------
// SyncResult factories
// ---------------------------------------------------------------------------

const syncedResult = (vendor: ConnectorVendor): SyncResult => ({
  vendor,
  status: 'synced',
  ordersSynced: 0,
  lineItemsSynced: 0,
  productsSynced: 0,
  adRowsSynced: 5,
  lastSyncAt: new Date().toISOString(),
})

const errorResult = (vendor: ConnectorVendor): SyncResult => ({
  vendor,
  status: 'error',
  ordersSynced: 0,
  lineItemsSynced: 0,
  productsSynced: 0,
  adRowsSynced: 0,
  lastSyncAt: null,
  error: 'Live provider fetch requires a real token (Founder-gated)',
})

const notConnectedResult = (vendor: ConnectorVendor): SyncResult => ({
  vendor,
  status: 'not_connected',
  ordersSynced: 0,
  lineItemsSynced: 0,
  productsSynced: 0,
  adRowsSynced: 0,
  lastSyncAt: null,
})

// ---------------------------------------------------------------------------
// Workspace / vendor fixtures
// ---------------------------------------------------------------------------

const WS_A = 'aaaaaaaa-0000-0000-0000-000000000001'
const WS_B = 'bbbbbbbb-0000-0000-0000-000000000002'

// ---------------------------------------------------------------------------
// Helper — build a fully-typed SchedulerDeps with vi.fn stubs
// ---------------------------------------------------------------------------

type DoSyncFn = SchedulerDeps['doSync']
type ReadVendorsFn = SchedulerDeps['readConnectedVendors']

function makeDeps(
  connectedVendors: ConnectorVendor[],
  syncImpl?: DoSyncFn,
): SchedulerDeps {
  const doSync: DoSyncFn = syncImpl ?? (async (params) => syncedResult(params.vendor))
  const readConnectedVendors: ReadVendorsFn = async () => connectedVendors
  return { readConnectedVendors, doSync }
}

// ---------------------------------------------------------------------------
// runSchedulerTick — POSITIVE: enumerates workspaces+vendors, calls doSync
// ---------------------------------------------------------------------------

describe('runSchedulerTick — POSITIVE: tick enumerates and calls doSync', () => {
  it('calls doSync once per connected vendor per workspace', async () => {
    const doSync = vi.fn<DoSyncFn>(async () => syncedResult('META'))
    const deps = makeDeps(['META'], doSync)
    const log = makeLogger()

    await runSchedulerTick(log, [WS_A], ['META', 'GOOGLE'], deps)

    expect(doSync).toHaveBeenCalledOnce()
    expect(doSync).toHaveBeenCalledWith({ vendor: 'META', workspaceId: WS_A })
  })

  it('calls doSync for every connected vendor returned by enumeration', async () => {
    const doSync = vi.fn<DoSyncFn>(async (params) => syncedResult(params.vendor))
    const deps = makeDeps(['META', 'GOOGLE'], doSync)
    const log = makeLogger()

    await runSchedulerTick(log, [WS_A], ['META', 'GOOGLE'], deps)

    expect(doSync).toHaveBeenCalledTimes(2)
    const calls = doSync.mock.calls.map((c) => c[0].vendor).sort()
    expect(calls).toEqual(['GOOGLE', 'META'])
  })

  it('iterates all workspaces in the configured list', async () => {
    const doSync = vi.fn<DoSyncFn>(async (params) => syncedResult(params.vendor))
    const deps = makeDeps(['META'], doSync)
    const log = makeLogger()

    await runSchedulerTick(log, [WS_A, WS_B], ['META'], deps)

    expect(doSync).toHaveBeenCalledTimes(2)
    const workspaces = doSync.mock.calls.map((c) => c[0].workspaceId).sort()
    expect(workspaces).toEqual([WS_A, WS_B].sort())
  })

  it('does not call doSync when no vendors are connected', async () => {
    const doSync = vi.fn<DoSyncFn>(async (params) => syncedResult(params.vendor))
    const deps = makeDeps([], doSync)
    const log = makeLogger()

    await runSchedulerTick(log, [WS_A], ['META', 'GOOGLE'], deps)

    expect(doSync).not.toHaveBeenCalled()
  })

  it('logs a tick-complete summary after the tick', async () => {
    const doSync = vi.fn<DoSyncFn>(async () => syncedResult('META'))
    const deps = makeDeps(['META'], doSync)
    const log = makeLogger()

    await runSchedulerTick(log, [WS_A], ['META'], deps)

    const lastInfo = log.info.mock.calls[log.info.mock.calls.length - 1]!
    expect(lastInfo[0]).toMatch(/tick complete.*attempted=1.*succeeded=1.*failed=0/)
  })
})

// ---------------------------------------------------------------------------
// runSchedulerTick — POSITIVE: error isolation
// ---------------------------------------------------------------------------

describe('runSchedulerTick — POSITIVE: doSync throw is isolated', () => {
  it('continues to call doSync for other vendors when one throws', async () => {
    let callIdx = 0
    const doSync = vi.fn<DoSyncFn>(async (params) => {
      callIdx++
      if (callIdx === 1) throw new Error('unexpected boom')
      return syncedResult(params.vendor)
    })
    const deps = makeDeps(['META', 'GOOGLE'], doSync)
    const log = makeLogger()

    await runSchedulerTick(log, [WS_A], ['META', 'GOOGLE'], deps)

    expect(doSync).toHaveBeenCalledTimes(2)
    const summary = log.info.mock.calls[log.info.mock.calls.length - 1]![0]
    expect(summary).toMatch(/succeeded=1.*failed=1/)
  })

  it('continues to call doSync for other vendors when one returns { status: "error" }', async () => {
    let callIdx = 0
    const doSync = vi.fn<DoSyncFn>(async (params) => {
      callIdx++
      return callIdx === 1 ? errorResult(params.vendor) : syncedResult(params.vendor)
    })
    const deps = makeDeps(['META', 'GOOGLE'], doSync)
    const log = makeLogger()

    await runSchedulerTick(log, [WS_A], ['META', 'GOOGLE'], deps)

    expect(doSync).toHaveBeenCalledTimes(2)
    const summary = log.info.mock.calls[log.info.mock.calls.length - 1]![0]
    expect(summary).toMatch(/succeeded=1.*failed=1/)
  })

  it('logs a WARN (not error) for a Founder-gated fetch failure', async () => {
    const doSync = vi.fn<DoSyncFn>(async (params) => errorResult(params.vendor))
    const deps = makeDeps(['META'], doSync)
    const log = makeLogger()

    await runSchedulerTick(log, [WS_A], ['META'], deps)

    expect(log.warn).toHaveBeenCalled()
    expect(log.error).not.toHaveBeenCalled()
    const warnCall = log.warn.mock.calls.find(
      (c) => (c[1] as string).includes('Founder-gated'),
    )
    expect(warnCall).toBeDefined()
  })

  it('continues across workspaces when readConnectedVendors fails for one workspace', async () => {
    const doSync = vi.fn<DoSyncFn>(async (params) => syncedResult(params.vendor))

    let enumCallCount = 0
    const deps: SchedulerDeps = {
      readConnectedVendors: async (_wsId) => {
        enumCallCount++
        if (enumCallCount === 1) throw new Error('DB connection refused')
        return ['META']
      },
      doSync,
    }

    const log = makeLogger()
    await runSchedulerTick(log, [WS_A, WS_B], ['META'], deps)

    // WS_A enumeration failed — WS_B should still have been attempted
    expect(doSync).toHaveBeenCalledOnce()
    expect(doSync).toHaveBeenCalledWith({ vendor: 'META', workspaceId: WS_B })
    expect(log.warn).toHaveBeenCalled()
  })

  it('does not crash when not_connected is returned (race condition guard)', async () => {
    const doSync = vi.fn<DoSyncFn>(async (params) => notConnectedResult(params.vendor))
    const deps = makeDeps(['META'], doSync)
    const log = makeLogger()

    await expect(
      runSchedulerTick(log, [WS_A], ['META'], deps),
    ).resolves.toBeUndefined()

    expect(doSync).toHaveBeenCalledOnce()
  })
})

// ---------------------------------------------------------------------------
// startSyncScheduler / stopSyncScheduler — lifecycle gate tests
// ---------------------------------------------------------------------------

describe('startSyncScheduler / stopSyncScheduler — lifecycle', () => {
  let originalEnv: NodeJS.ProcessEnv

  beforeEach(() => {
    originalEnv = { ...process.env }
    // Ensure clean state before each lifecycle test
    stopSyncScheduler()
  })

  afterEach(() => {
    stopSyncScheduler()
    // Restore original env
    Object.keys(process.env).forEach((k) => { delete process.env[k] })
    Object.assign(process.env, originalEnv)
  })

  function setSchedulerEnv() {
    process.env['SYNC_SCHEDULER_ENABLED'] = 'true'
    process.env['SYNC_POLL_VENDORS'] = 'META'
    process.env['SYNC_POLL_WORKSPACES'] = WS_A
    process.env['SYNC_POLL_INTERVAL_MS'] = '999999'
  }

  it('calls setInterval when startSyncScheduler is invoked', () => {
    setSchedulerEnv()
    const setIntervalSpy = vi.spyOn(global, 'setInterval')

    const log = makeLogger()
    startSyncScheduler(log)

    expect(setIntervalSpy).toHaveBeenCalledOnce()
    setIntervalSpy.mockRestore()
  })

  it('does NOT register a second interval if called twice (double-start guard)', () => {
    setSchedulerEnv()
    const setIntervalSpy = vi.spyOn(global, 'setInterval')

    const log = makeLogger()
    startSyncScheduler(log)
    startSyncScheduler(log) // second call — should be a no-op

    expect(setIntervalSpy).toHaveBeenCalledOnce()
    expect(log.warn).toHaveBeenCalledWith({}, expect.stringContaining('already running'))
    setIntervalSpy.mockRestore()
  })

  it('stopSyncScheduler calls clearInterval after start', () => {
    setSchedulerEnv()
    const clearIntervalSpy = vi.spyOn(global, 'clearInterval')

    const log = makeLogger()
    startSyncScheduler(log)
    stopSyncScheduler()

    expect(clearIntervalSpy).toHaveBeenCalledOnce()
    clearIntervalSpy.mockRestore()
  })

  it('stopSyncScheduler is a no-op when scheduler was never started', () => {
    const clearIntervalSpy = vi.spyOn(global, 'clearInterval')
    stopSyncScheduler()
    expect(clearIntervalSpy).not.toHaveBeenCalled()
    clearIntervalSpy.mockRestore()
  })

  it('setInterval is called with the correct interval ms from env', () => {
    setSchedulerEnv()
    process.env['SYNC_POLL_INTERVAL_MS'] = '12345'

    const setIntervalSpy = vi.spyOn(global, 'setInterval')
    const log = makeLogger()
    startSyncScheduler(log)

    const callArgs = setIntervalSpy.mock.calls[0]!
    // setInterval(fn, delay) — second arg is delay
    expect(callArgs[1]).toBe(12345)
    setIntervalSpy.mockRestore()
  })
})
