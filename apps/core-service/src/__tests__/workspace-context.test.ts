/**
 * Track T — Unit tests for workspace-context.ts (Track A)
 *
 * Uses a mock pg Pool to avoid live-DB dependency.
 * Positive AND negative scenarios per the coverage standard.
 *
 * Integration test (pgbouncer-txn-pool) is in integration/pool-isolation.test.ts.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import type { Pool, PoolClient } from 'pg'

// ---------------------------------------------------------------------------
// Mock pg Pool + PoolClient
// ---------------------------------------------------------------------------

function makeMockClient(queryFn?: (text: string) => unknown) {
  const queries: { text: string; params?: unknown[] }[] = []
  const client: Partial<PoolClient> = {
    query: vi.fn(async (text: string | { text: string }, params?: unknown[]) => {
      const textStr = typeof text === 'string' ? text : text.text
      queries.push({ text: textStr, params })
      if (queryFn) return queryFn(textStr)
      return { rows: [], rowCount: 0 }
    }) as unknown as PoolClient['query'],
    release: vi.fn(),
  }
  return { client: client as PoolClient, queries }
}

function makeMockPool(clientOverride?: Partial<PoolClient>) {
  const { client, queries } = makeMockClient()
  const mergedClient = { ...client, ...clientOverride } as PoolClient
  const pool: Partial<Pool> = {
    connect: vi.fn(async () => mergedClient),
  }
  return { pool: pool as Pool, client: mergedClient, queries }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('withWorkspace()', () => {
  let _setPoolForTest: (p: Pool) => void
  let _resetPoolForTest: () => void
  let withWorkspace: typeof import('../infrastructure/db/workspace-context.js').withWorkspace

  beforeEach(async () => {
    vi.resetModules()
    const mod = await import('../infrastructure/db/workspace-context.js')
    _setPoolForTest = mod._setPoolForTest
    _resetPoolForTest = mod._resetPoolForTest
    withWorkspace = mod.withWorkspace
  })

  afterEach(() => {
    _resetPoolForTest()
    vi.restoreAllMocks()
  })

  it('(+) sets app.workspace_id as first statement via bind-param', async () => {
    const { pool, queries, client } = makeMockPool()
    _setPoolForTest(pool)

    const wsId = 'aaaaaaaa-0000-0000-0000-000000000001'
    await withWorkspace(wsId, async () => 'ok')

    // First query is BEGIN
    expect(queries[0]?.text).toBe('BEGIN')
    // Second query is set_config for workspace_id with bind-param
    expect(queries[1]?.text).toContain("set_config('app.workspace_id'")
    expect(queries[1]?.params).toContain(wsId)
    // Third query clears superadmin flag
    expect(queries[2]?.text).toContain("set_config('app.is_superadmin'")
    expect(queries[2]?.text).toContain("'false'")
    // Release is called
    expect(client.release).toHaveBeenCalled()
  })

  it('(+) runs fn(tx) inside the transaction', async () => {
    const { pool } = makeMockPool()
    _setPoolForTest(pool)

    let txReceived: PoolClient | undefined
    const wsId = 'aaaaaaaa-0000-0000-0000-000000000001'
    await withWorkspace(wsId, async (tx) => {
      txReceived = tx
    })
    expect(txReceived).toBeDefined()
  })

  it('(+) returns the value from fn', async () => {
    const { pool } = makeMockPool()
    _setPoolForTest(pool)

    const result = await withWorkspace(
      'aaaaaaaa-0000-0000-0000-000000000001',
      async () => 42,
    )
    expect(result).toBe(42)
  })

  it('(+) COMMITs on success', async () => {
    const { pool, queries } = makeMockPool()
    _setPoolForTest(pool)

    await withWorkspace('aaaaaaaa-0000-0000-0000-000000000001', async () => {})
    const lastQuery = queries[queries.length - 1]?.text
    expect(lastQuery).toBe('COMMIT')
  })

  it('(+) ROLLBACKs and re-throws on fn error', async () => {
    const { pool, queries } = makeMockPool()
    _setPoolForTest(pool)

    const err = new Error('test error')
    await expect(
      withWorkspace('aaaaaaaa-0000-0000-0000-000000000001', async () => {
        throw err
      }),
    ).rejects.toThrow('test error')

    expect(queries.some((q) => q.text === 'ROLLBACK')).toBe(true)
  })

  it('(+) releases client even on fn error', async () => {
    const { pool, client } = makeMockPool()
    _setPoolForTest(pool)

    await expect(
      withWorkspace('aaaaaaaa-0000-0000-0000-000000000001', async () => {
        throw new Error('oops')
      }),
    ).rejects.toThrow()

    expect(client.release).toHaveBeenCalled()
  })

  it('(-) rejects non-string workspaceId', async () => {
    const { pool } = makeMockPool()
    _setPoolForTest(pool)

    await expect(
      // @ts-expect-error — testing runtime guard
      withWorkspace(null, async () => {}),
    ).rejects.toThrow('[withWorkspace] workspaceId must be a non-empty string')
  })

  it('(-) rejects empty string workspaceId', async () => {
    const { pool } = makeMockPool()
    _setPoolForTest(pool)

    await expect(withWorkspace('', async () => {})).rejects.toThrow(
      '[withWorkspace] workspaceId must be a non-empty string',
    )
  })

  it('(-) rejects non-UUID workspaceId', async () => {
    const { pool } = makeMockPool()
    _setPoolForTest(pool)

    await expect(
      withWorkspace('not-a-uuid', async () => {}),
    ).rejects.toThrow('not a valid UUID')
  })

  it('(-) throws if neither DIRECT_URL nor DATABASE_URL is set', async () => {
    vi.resetModules()
    const savedDirect = process.env['DIRECT_URL']
    const savedDatabase = process.env['DATABASE_URL']
    delete process.env['DIRECT_URL']
    delete process.env['DATABASE_URL']

    try {
      const mod = await import('../infrastructure/db/workspace-context.js')
      // _resetPoolForTest ensures pool is not set from previous test
      mod._resetPoolForTest()
      await expect(
        mod.withWorkspace('aaaaaaaa-0000-0000-0000-000000000001', async () => {}),
      ).rejects.toThrow('neither DIRECT_URL nor DATABASE_URL is set')
    } finally {
      if (savedDirect !== undefined) process.env['DIRECT_URL'] = savedDirect
      if (savedDatabase !== undefined) process.env['DATABASE_URL'] = savedDatabase
    }
  })

  it('(+) falls back to DATABASE_URL when DIRECT_URL is unset (slice C alias)', async () => {
    vi.resetModules()
    const savedDirect = process.env['DIRECT_URL']
    const savedDatabase = process.env['DATABASE_URL']
    delete process.env['DIRECT_URL']
    // A syntactically-valid URL is enough — the mock pool short-circuits before connect.
    process.env['DATABASE_URL'] = 'postgresql://rls_app:rls_app_pw@localhost:5432/brain_dev'

    const mod = await import('../infrastructure/db/workspace-context.js')
    try {
      const { pool, queries } = makeMockPool()
      mod._setPoolForTest(pool)
      await mod.withWorkspace('aaaaaaaa-0000-0000-0000-000000000001', async () => 'ok')
      // Proves it did NOT throw the unset-URL error and ran the transaction.
      expect(queries[0]?.text).toBe('BEGIN')
    } finally {
      mod._resetPoolForTest()
      if (savedDirect !== undefined) process.env['DIRECT_URL'] = savedDirect
      if (savedDatabase !== undefined) process.env['DATABASE_URL'] = savedDatabase
      else delete process.env['DATABASE_URL']
    }
  })

  it('(+) correlation 4-tuple is seeded in ALS during fn execution', async () => {
    vi.resetModules()
    const mod = await import('../infrastructure/db/workspace-context.js')
    const { pool } = makeMockPool()
    mod._setPoolForTest(pool)

    const wsId = 'aaaaaaaa-0000-0000-0000-000000000001'
    let correlationInsideFn: ReturnType<typeof mod.getCorrelation> | undefined

    await mod.withWorkspace(wsId, async () => {
      correlationInsideFn = mod.getCorrelation()
    }, { requestId: 'req-test', traceId: 'trace-test', userId: 'user-1' })

    expect(correlationInsideFn?.workspaceId).toBe(wsId)
    expect(correlationInsideFn?.requestId).toBe('req-test')
  })
})

describe('withSuperadmin()', () => {
  let _setPoolForTest: (p: Pool) => void
  let _resetPoolForTest: () => void
  let withSuperadmin: typeof import('../infrastructure/db/workspace-context.js').withSuperadmin

  beforeEach(async () => {
    vi.resetModules()
    const mod = await import('../infrastructure/db/workspace-context.js')
    _setPoolForTest = mod._setPoolForTest
    _resetPoolForTest = mod._resetPoolForTest
    withSuperadmin = mod.withSuperadmin
  })

  afterEach(() => {
    _resetPoolForTest()
    vi.restoreAllMocks()
  })

  it('(+) sets app.is_superadmin to true', async () => {
    const { pool, queries } = makeMockPool()
    _setPoolForTest(pool)

    await withSuperadmin(async () => {})

    expect(queries.some((q) =>
      q.text.includes("set_config('app.is_superadmin'") &&
      q.text.includes("'true'"),
    )).toBe(true)
  })

  it('(+) clears app.workspace_id (empty string)', async () => {
    const { pool, queries } = makeMockPool()
    _setPoolForTest(pool)

    await withSuperadmin(async () => {})

    expect(queries.some((q) =>
      q.text.includes("set_config('app.workspace_id'") &&
      q.text.includes("''"),
    )).toBe(true)
  })

  it('(+) sets is_superadmin before workspace_id clear (order matters)', async () => {
    const { pool, queries } = makeMockPool()
    _setPoolForTest(pool)

    await withSuperadmin(async () => {})

    const superadminIdx = queries.findIndex((q) =>
      q.text.includes("set_config('app.is_superadmin'") && q.text.includes("'true'"),
    )
    const clearWsIdx = queries.findIndex((q) =>
      q.text.includes("set_config('app.workspace_id'") && q.text.includes("''"),
    )
    expect(superadminIdx).toBeGreaterThanOrEqual(0)
    expect(clearWsIdx).toBeGreaterThanOrEqual(0)
    expect(superadminIdx).toBeLessThan(clearWsIdx)
  })

  it('(+) commits on success', async () => {
    const { pool, queries } = makeMockPool()
    _setPoolForTest(pool)

    await withSuperadmin(async () => {})
    expect(queries[queries.length - 1]?.text).toBe('COMMIT')
  })

  it('(-) rolls back and re-throws on fn error', async () => {
    const { pool, queries } = makeMockPool()
    _setPoolForTest(pool)

    await expect(withSuperadmin(async () => { throw new Error('fail') })).rejects.toThrow('fail')
    expect(queries.some((q) => q.text === 'ROLLBACK')).toBe(true)
  })

  it('(+) sets ALS workspaceId to null in superadmin context', async () => {
    vi.resetModules()
    const mod = await import('../infrastructure/db/workspace-context.js')
    const { pool } = makeMockPool()
    mod._setPoolForTest(pool)

    let correlationInsideFn: ReturnType<typeof mod.getCorrelation> | undefined
    await mod.withSuperadmin(async () => {
      correlationInsideFn = mod.getCorrelation()
    })

    expect(correlationInsideFn?.workspaceId).toBeNull()
  })
})

describe('getCorrelation() default', () => {
  it('(+) returns sentinel values when no ALS store is set', async () => {
    vi.resetModules()
    const { getCorrelation } = await import('../infrastructure/db/workspace-context.js')
    const c = getCorrelation()
    expect(c.requestId).toBe('unset')
    expect(c.traceId).toBe('unset')
    expect(c.workspaceId).toBeNull()
    expect(c.userId).toBeNull()
  })
})
