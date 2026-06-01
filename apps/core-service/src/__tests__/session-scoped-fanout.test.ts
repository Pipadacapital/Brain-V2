/**
 * Track T — Unit tests for session-scoped-fanout.ts (Track D)
 *
 * Tests the fan-out pattern with mock connections.
 * Positive AND negative scenarios per the coverage standard.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { Pool, PoolClient } from 'pg'
import type { ConnectedRecord, FanoutLogEvent } from '../application/contexts/cron/session-scoped-fanout.js'

// ---------------------------------------------------------------------------
// Minimal mock Pool + PoolClient
// ---------------------------------------------------------------------------

function makeMockPool() {
  const queries: string[] = []
  const client: Partial<PoolClient> = {
    query: vi.fn(async (text: string) => {
      queries.push(text)
      return { rows: [], rowCount: 0 }
    }) as unknown as PoolClient['query'],
    release: vi.fn(),
  }
  const pool: Partial<Pool> = {
    connect: vi.fn(async () => client as PoolClient),
  }
  return { pool: pool as Pool, client: client as PoolClient, queries }
}

const ALPHA_WS = 'aaaaaaaa-0000-0000-0000-000000000001'
const BETA_WS  = 'bbbbbbbb-0000-0000-0000-000000000002'

const ALPHA_CONN: ConnectedRecord = { id: 'conn-1', workspaceId: ALPHA_WS, status: 'CONNECTED' }
const BETA_CONN:  ConnectedRecord = { id: 'conn-2', workspaceId: BETA_WS,  status: 'CONNECTED' }

describe('scheduledFanout()', () => {
  let _setPoolForTest: (p: Pool) => void
  let _resetPoolForTest: () => void
  let scheduledFanout: typeof import('../application/contexts/cron/session-scoped-fanout.js').scheduledFanout

  beforeEach(async () => {
    vi.resetModules()
    const contextMod = await import('../infrastructure/db/workspace-context.js')
    _setPoolForTest = contextMod._setPoolForTest
    _resetPoolForTest = contextMod._resetPoolForTest
    const fanoutMod = await import('../application/contexts/cron/session-scoped-fanout.js')
    scheduledFanout = fanoutMod.scheduledFanout
  })

  afterEach(() => {
    _resetPoolForTest()
    vi.restoreAllMocks()
  })

  it('(+) enumerates all connections via withSuperadmin outer call', async () => {
    const { pool } = makeMockPool()
    _setPoolForTest(pool)

    const listedConns: ConnectedRecord[] = []
    await scheduledFanout({
      syncName: 'test-sync',
      listConnected: async () => [ALPHA_CONN, BETA_CONN],
      doWork: async (conn) => { listedConns.push(conn) },
    })

    expect(listedConns).toHaveLength(2)
    expect(listedConns.map((c) => c.id)).toContain('conn-1')
    expect(listedConns.map((c) => c.id)).toContain('conn-2')
  })

  it('(+) returns correct totalConnected and attempted counts', async () => {
    const { pool } = makeMockPool()
    _setPoolForTest(pool)

    const result = await scheduledFanout({
      syncName: 'test-sync',
      listConnected: async () => [ALPHA_CONN, BETA_CONN],
      doWork: async () => {},
    })

    expect(result.totalConnected).toBe(2)
    expect(result.attempted).toBe(2)
    expect(result.failed).toBe(0)
  })

  it('(+) per-connection work runs under withWorkspace(conn.workspaceId)', async () => {
    vi.resetModules()
    const contextMod = await import('../infrastructure/db/workspace-context.js')
    const { pool } = makeMockPool()
    contextMod._setPoolForTest(pool)

    const workspacesSeen: (string | null)[] = []
    const fanoutMod = await import('../application/contexts/cron/session-scoped-fanout.js')
    await fanoutMod.scheduledFanout({
      syncName: 'test-sync',
      listConnected: async () => [ALPHA_CONN],
      doWork: async () => {
        workspacesSeen.push(contextMod.getCorrelation().workspaceId)
      },
    })

    expect(workspacesSeen).toContain(ALPHA_WS)
  })

  it('(-) per-connection failure does NOT abort the remaining connections', async () => {
    const { pool } = makeMockPool()
    _setPoolForTest(pool)

    let betaAttempted = false
    const result = await scheduledFanout({
      syncName: 'test-sync',
      listConnected: async () => [ALPHA_CONN, BETA_CONN],
      doWork: async (conn) => {
        if (conn.id === 'conn-1') throw new Error('alpha failed')
        betaAttempted = true
      },
    })

    expect(betaAttempted).toBe(true)
    expect(result.failed).toBe(1)
    expect(result.attempted).toBe(2)
  })

  it('(+) proof-of-attempt log emitted for each connection', async () => {
    const { pool } = makeMockPool()
    _setPoolForTest(pool)

    const events: FanoutLogEvent[] = []
    await scheduledFanout({
      syncName: 'test-sync',
      listConnected: async () => [ALPHA_CONN, BETA_CONN],
      doWork: async () => {},
      log: (e) => events.push(e),
    })

    const attemptedEvents = events.filter((e) => e.event === 'cron.sync.attempted')
    expect(attemptedEvents).toHaveLength(2)
    expect(attemptedEvents.every((e) => e.status === 'ok')).toBe(true)
  })

  it('(-) proof-of-attempt log emitted with status=failed on error', async () => {
    const { pool } = makeMockPool()
    _setPoolForTest(pool)

    const events: FanoutLogEvent[] = []
    await scheduledFanout({
      syncName: 'test-sync',
      listConnected: async () => [ALPHA_CONN],
      doWork: async () => { throw new Error('network error') },
      log: (e) => events.push(e),
    })

    const failedEvent = events.find((e) => e.event === 'cron.sync.attempted' && e.status === 'failed')
    expect(failedEvent).toBeDefined()
    expect(failedEvent?.error).toContain('network error')
  })

  it('(+) empty connection list returns zero counts', async () => {
    const { pool } = makeMockPool()
    _setPoolForTest(pool)

    const result = await scheduledFanout({
      syncName: 'test-sync',
      listConnected: async () => [],
      doWork: async () => {},
    })

    expect(result.totalConnected).toBe(0)
    expect(result.attempted).toBe(0)
    expect(result.failed).toBe(0)
  })
})
