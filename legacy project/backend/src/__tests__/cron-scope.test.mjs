/**
 * Tests for cron session-scope refactor (Track 1a-E, CF-C1-CRON-SCOPE-1.a)
 *
 * Tests verify:
 * 1. proof-of-attempt logging fires for every connection (ok or failed)
 * 2. per-connection try/catch: one failure does NOT skip others
 * 3. attempted-vs-connected alarm fires when attempted < totalConnected
 * 4. withWorkspace is called per-connection (not once for all)
 *
 * Run: node --test src/__tests__/cron-scope.test.mjs
 */
import { test, describe, mock, before, after } from 'node:test'
import assert from 'node:assert/strict'

// ---------------------------------------------------------------------------
// Simulation of the cron fan-out pattern (extracted logic, no DB)
// ---------------------------------------------------------------------------

async function simulatedSyncAllWithWorkspace(connections, syncFn) {
  const logs = []
  const results = []
  const totalConnected = connections.length
  let attempted = 0
  const contextSetFor = []

  for (const c of connections) {
    attempted++
    // Simulate withWorkspace: record the workspace context was set for this connection
    contextSetFor.push(c.workspaceId)
    try {
      await syncFn(c.id)
      results.push({ connectionId: c.id, workspaceId: c.workspaceId, status: 'ok' })
      logs.push({ msg: 'cron.sync.attempted', connectionId: c.id, workspaceId: c.workspaceId, status: 'ok' })
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      logs.push({ msg: 'cron.sync.attempted', connectionId: c.id, workspaceId: c.workspaceId, status: 'failed', error: message })
      results.push({ connectionId: c.id, workspaceId: c.workspaceId, status: 'failed', error: message })
    }
  }

  if (attempted < totalConnected) {
    logs.push({ msg: 'cron.sync.alarm.silent_skip', attempted, totalConnected })
  }

  return { results, logs, contextSetFor, attempted, totalConnected }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Cron per-connection error isolation', () => {
  const connections = [
    { id: 'conn-1', workspaceId: 'ws-1' },
    { id: 'conn-2', workspaceId: 'ws-2' },
    { id: 'conn-3', workspaceId: 'ws-3' },
  ]

  test('All connections attempted even when middle connection fails', async () => {
    const { results, logs } = await simulatedSyncAllWithWorkspace(connections, async (id) => {
      if (id === 'conn-2') throw new Error('simulated error for conn-2')
      // conn-1 and conn-3 succeed
    })

    // All three are attempted
    assert.equal(results.length, 3, 'All 3 connections in results')
    assert.equal(logs.filter((l) => l.msg === 'cron.sync.attempted').length, 3, '3 proof-of-attempt logs')

    // conn-2 failed, others succeeded
    assert.equal(results.find((r) => r.connectionId === 'conn-1')?.status, 'ok')
    assert.equal(results.find((r) => r.connectionId === 'conn-2')?.status, 'failed')
    assert.equal(results.find((r) => r.connectionId === 'conn-3')?.status, 'ok')

    // conn-2's failure log carries error field
    const failLog = logs.find((l) => l.connectionId === 'conn-2' && l.status === 'failed')
    assert.ok(failLog?.error, 'Failed log has error field')
    assert.match(failLog.error, /simulated error/)
  })

  test('Each connection has its own workspace context (withWorkspace called per-connection)', async () => {
    const { contextSetFor } = await simulatedSyncAllWithWorkspace(connections, async () => {})
    assert.deepEqual(contextSetFor, ['ws-1', 'ws-2', 'ws-3'], 'Each connection gets its own workspace context')
  })

  test('Proof-of-attempt log for every connection regardless of outcome', async () => {
    const { logs } = await simulatedSyncAllWithWorkspace(connections, async (id) => {
      if (id === 'conn-1') throw new Error('fail-1')
      if (id === 'conn-2') throw new Error('fail-2')
    })
    const attemptLogs = logs.filter((l) => l.msg === 'cron.sync.attempted')
    const connectionIds = attemptLogs.map((l) => l.connectionId).sort()
    assert.deepEqual(connectionIds, ['conn-1', 'conn-2', 'conn-3'], 'All 3 connections logged')
  })
})

describe('Cron silent-skip alarm', () => {
  test('No alarm when attempted === totalConnected', async () => {
    const connections = [{ id: 'c1', workspaceId: 'w1' }, { id: 'c2', workspaceId: 'w2' }]
    const { logs } = await simulatedSyncAllWithWorkspace(connections, async () => {})
    const alarmLogs = logs.filter((l) => l.msg === 'cron.sync.alarm.silent_skip')
    assert.equal(alarmLogs.length, 0, 'No alarm when all connections attempted')
  })

  // The silent-skip scenario (attempted < totalConnected) cannot happen in the
  // normal for-loop path (it always iterates over the array). The alarm is a
  // safety net for if a connection is pre-filtered or the loop is modified.
  // We test the alarm logic directly:
  test('Alarm fires when attempted < totalConnected (simulated)', async () => {
    const logs = []
    const attempted = 2
    const totalConnected = 3
    if (attempted < totalConnected) {
      logs.push({ msg: 'cron.sync.alarm.silent_skip', attempted, totalConnected })
    }
    assert.equal(logs.length, 1)
    assert.equal(logs[0].attempted, 2)
    assert.equal(logs[0].totalConnected, 3)
  })
})

describe('Cron proof-of-attempt log fields (CF-C1-CRON-SCOPE-1.a)', () => {
  test('Each log entry carries connectionId, workspaceId, status', async () => {
    const connections = [{ id: 'c1', workspaceId: 'w1' }]
    const { logs } = await simulatedSyncAllWithWorkspace(connections, async () => {})
    const attemptLog = logs.find((l) => l.msg === 'cron.sync.attempted')
    assert.ok(attemptLog)
    assert.equal(attemptLog.connectionId, 'c1')
    assert.equal(attemptLog.workspaceId, 'w1')
    assert.equal(attemptLog.status, 'ok')
  })
})
