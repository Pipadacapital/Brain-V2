/**
 * Wave-3 settings CRUD unit tests.
 *
 * Every use-case is tested with an in-memory mock withWorkspace / withSuperadmin
 * (same pattern as connector-use-cases.test.ts). DB never touched.
 *
 * Positive: happy-path creates, updates, deletes return expected rows.
 * Negative: NOT_FOUND errors when row absent; cross-workspace isolation (wrong
 *   workspaceId sees no row); Zod-level input guards tested at the router layer
 *   (via the router.settings.test.ts tests that drive the gateway).
 */

import { describe, it, expect } from 'vitest'
import {
  SettingsError,
  createCost,
  updateCost,
  deleteCost,
  createMiscExpense,
  updateMiscExpense,
  deleteMiscExpense,
  getFounderSalary,
  setFounderSalary,
  updateWorkspaceSettings,
  deleteWorkspace,
  createGoal,
  updateGoal,
  deleteGoal,
  upsertAdCampaignClassification,
  createFestival,
  updateFestival,
  deleteFestival,
  resetFestivalDefaults,
} from '../application/settings/settings-use-cases.js'
import type { DbRunners } from '../application/settings/settings-use-cases.js'
import type { PoolClient } from 'pg'

// ---------------------------------------------------------------------------
// Shared UUID constants
// ---------------------------------------------------------------------------
const WS_A = '00000000-0000-0000-0000-000000000001'
const WS_B = '00000000-0000-0000-0000-000000000002'
const COST_ID = '11111111-1111-1111-1111-111111111111'
const EXP_ID  = '22222222-2222-2222-2222-222222222222'
const GOAL_ID = '33333333-3333-3333-3333-333333333333'
const FEST_ID = '44444444-4444-4444-4444-444444444444'
const ADS_ID  = '55555555-5555-5555-5555-555555555555'

// ---------------------------------------------------------------------------
// In-memory mock store factories
// ---------------------------------------------------------------------------

/** Build a mock DbRunners that routes SQL patterns to in-memory stores. */
function makeMockRunners(workspaceId: string) {
  // Stores
  const costs = new Map<string, Record<string, unknown>>()
  const expenses = new Map<string, Record<string, unknown>>()
  const workspaces = new Map<string, Record<string, unknown>>()
  const cogsSettings = new Map<string, Record<string, unknown>>()
  const goals = new Map<string, Record<string, unknown>>()
  const classifications = new Map<string, Record<string, unknown>>()
  const festivals = new Map<string, Record<string, unknown>>()

  // Seed workspace row
  workspaces.set(workspaceId, {
    id: workspaceId,
    timezone: 'Asia/Kolkata',
    tax_percent_bp: 0,
    skip_zero_sales_orders: false,
    skipped_shopify_order_tags: [],
    founder_salary_monthly_mu: null,
    founder_salary_currency: null,
    updated_at: new Date().toISOString(),
  })

  let idCounter = 1
  const nextId = () => `gen-${idCounter++}`

  async function runQuery(sql: string, params: unknown[]): Promise<{ rows: Record<string, unknown>[] }> {
    const s = sql.replace(/\s+/g, ' ').trim()

    // ---- workspace_costs ----
    if (/INSERT INTO workspace_costs/i.test(s)) {
      const id = nextId()
      const row = {
        id, workspace_id: params[0], cost_type: params[1], name: params[2],
        amount_mu: params[3], is_percent: params[4], currency_code: params[5],
        billing_mode: params[6], effective_from: String(params[7]), effective_to: params[8] ?? null,
        created_at: new Date().toISOString(),
      }
      costs.set(id, row)
      return { rows: [row] }
    }
    if (/UPDATE workspace_costs/i.test(s)) {
      const row = costs.get(String(params[0]))
      if (!row || row['workspace_id'] !== params[1]) return { rows: [] }
      if (params[2] !== null) row['cost_type'] = params[2]
      if (params[3]) row['name'] = params[4]
      if (params[5] !== null) row['amount_mu'] = params[5]
      if (params[6] !== null) row['is_percent'] = params[6]
      if (params[7]) row['currency_code'] = params[8]
      if (params[9] !== null) row['billing_mode'] = params[9]
      if (params[10] !== null) row['effective_from'] = String(params[10])
      if (params[11]) row['effective_to'] = params[12]
      return { rows: [row] }
    }
    if (/DELETE FROM workspace_costs WHERE id/i.test(s)) {
      const row = costs.get(String(params[0]))
      if (!row || row['workspace_id'] !== params[1]) return { rows: [] }
      costs.delete(String(params[0]))
      return { rows: [{ id: params[0] }] }
    }

    // ---- workspace_misc_expenses ----
    if (/INSERT INTO workspace_misc_expenses/i.test(s)) {
      const id = nextId()
      const key = `${params[0]}:${params[1]}:${params[4]}`
      // ON CONFLICT upsert
      const existing = [...expenses.values()].find(
        (r) => r['workspace_id'] === params[0] && r['name'] === params[1] && r['effective_start_date'] === String(params[4])
      )
      if (existing) {
        existing['amount_mu'] = params[2]
        existing['updated_at'] = new Date().toISOString()
        return { rows: [existing] }
      }
      const row: Record<string, unknown> = {
        id, workspace_id: params[0], name: params[1], amount_mu: params[2],
        currency_code: params[3], effective_start_date: String(params[4]),
        created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
      }
      expenses.set(id, row)
      void key
      return { rows: [row] }
    }
    if (/UPDATE workspace_misc_expenses/i.test(s)) {
      const row = expenses.get(String(params[0]))
      if (!row || row['workspace_id'] !== params[1]) return { rows: [] }
      if (params[2] !== null) row['name'] = params[2]
      if (params[3] !== null) row['amount_mu'] = params[3]
      if (params[4] !== null) row['currency_code'] = params[4]
      if (params[5] !== null) row['effective_start_date'] = String(params[5])
      row['updated_at'] = new Date().toISOString()
      return { rows: [row] }
    }
    if (/DELETE FROM workspace_misc_expenses WHERE id/i.test(s)) {
      const row = expenses.get(String(params[0]))
      if (!row || row['workspace_id'] !== params[1]) return { rows: [] }
      expenses.delete(String(params[0]))
      return { rows: [{ id: params[0] }] }
    }

    // ---- workspaces (founder salary + settings) ----
    if (/SELECT founder_salary_monthly_mu, founder_salary_currency/i.test(s)) {
      const row = workspaces.get(String(params[0]))
      if (!row || row['id'] !== params[0]) return { rows: [] }
      return { rows: [row] }
    }
    if (/UPDATE workspaces\s+SET founder_salary_monthly_mu/i.test(s)) {
      const row = workspaces.get(String(params[0]))
      if (!row) return { rows: [] }
      row['founder_salary_monthly_mu'] = params[1]
      row['founder_salary_currency'] = params[2]
      row['updated_at'] = new Date().toISOString()
      return { rows: [row] }
    }
    if (/UPDATE workspaces SET\s+timezone/i.test(s)) {
      const row = workspaces.get(String(params[0]))
      if (!row) return { rows: [] }
      if (params[1] !== null) row['timezone'] = params[1]
      if (params[2] !== null) row['tax_percent_bp'] = params[2]
      if (params[3] !== null) row['skip_zero_sales_orders'] = params[3]
      if (params[4] !== null) row['skipped_shopify_order_tags'] = params[4]
      row['updated_at'] = new Date().toISOString()
      return { rows: [row] }
    }
    if (/INSERT INTO workspace_cogs_settings/i.test(s)) {
      const ws = String(params[0])
      const existing = cogsSettings.get(ws) ?? { workspace_id: ws, override_all_cogs_bp: 0, cogs_markup_bp: 0, fallback_cogs_bp: 0 }
      if (params[1] !== null) existing['override_all_cogs_bp'] = params[1]
      if (params[2] !== null) existing['cogs_markup_bp'] = params[2]
      if (params[3] !== null) existing['fallback_cogs_bp'] = params[3]
      cogsSettings.set(ws, existing)
      return { rows: [] }
    }
    if (/SELECT w\.id, w\.timezone/i.test(s)) {
      const wsRow = workspaces.get(String(params[0]))
      if (!wsRow) return { rows: [] }
      const cogs = cogsSettings.get(String(params[0])) ?? {}
      return { rows: [{ ...wsRow, ...cogs }] }
    }
    if (/DELETE FROM workspaces WHERE id/i.test(s)) {
      const row = workspaces.get(String(params[0]))
      if (!row) return { rows: [] }
      workspaces.delete(String(params[0]))
      return { rows: [{ id: params[0] }] }
    }

    // ---- workspace_metric_goals ----
    if (/INSERT INTO workspace_metric_goals/i.test(s)) {
      const id = nextId()
      // ON CONFLICT upsert
      const existing = [...goals.values()].find(
        (r) => r['workspace_id'] === params[0] && r['metric_name'] === params[1] &&
                r['period_type'] === params[2] && r['period_start'] === String(params[3])
      )
      if (existing) {
        existing['goal_value'] = params[4]
        existing['goal_type'] = params[6]
        existing['updated_at'] = new Date().toISOString()
        return { rows: [existing] }
      }
      const row: Record<string, unknown> = {
        id, workspace_id: params[0], metric_name: params[1], period_type: params[2],
        period_start: String(params[3]), goal_value: params[4], goal_unit: params[5],
        goal_type: params[6], created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
      }
      goals.set(id, row)
      return { rows: [row] }
    }
    if (/UPDATE workspace_metric_goals/i.test(s)) {
      const row = goals.get(String(params[0]))
      if (!row || row['workspace_id'] !== params[1]) return { rows: [] }
      if (params[2] !== null) row['goal_value'] = params[2]
      if (params[3] !== null) row['goal_type'] = params[3]
      if (params[4] !== null) row['goal_unit'] = params[4]
      row['updated_at'] = new Date().toISOString()
      return { rows: [row] }
    }
    if (/DELETE FROM workspace_metric_goals WHERE id/i.test(s)) {
      const row = goals.get(String(params[0]))
      if (!row || row['workspace_id'] !== params[1]) return { rows: [] }
      goals.delete(String(params[0]))
      return { rows: [{ id: params[0] }] }
    }

    // ---- workspace_ad_campaign_classifications ----
    if (/INSERT INTO workspace_ad_campaign_classifications/i.test(s)) {
      const id = nextId()
      const existing = [...classifications.values()].find(
        (r) => r['workspace_id'] === params[0] && r['platform'] === params[1] && r['campaign_id'] === params[2]
      )
      if (existing) {
        existing['intent'] = params[3]
        existing['campaign_name'] = params[4] ?? existing['campaign_name']
        existing['updated_at'] = new Date().toISOString()
        return { rows: [existing] }
      }
      const row: Record<string, unknown> = {
        id, workspace_id: params[0], platform: params[1], campaign_id: params[2],
        intent: params[3], campaign_name: params[4] ?? null,
        created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
      }
      classifications.set(id, row)
      return { rows: [row] }
    }

    // ---- workspace_festivals ----
    if (/INSERT INTO workspace_festivals/i.test(s)) {
      const id = nextId()
      const row: Record<string, unknown> = {
        id, workspace_id: params[0], name: params[1], start_date: String(params[2]),
        end_date: String(params[3]), color: params[4], expected_multiplier_bp: params[5],
        regions: params[6], categories: params[7], is_template: params[8], is_active: params[9],
        created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
      }
      festivals.set(id, row)
      return { rows: [row] }
    }
    if (/UPDATE workspace_festivals/i.test(s)) {
      const row = festivals.get(String(params[0]))
      if (!row || row['workspace_id'] !== params[1]) return { rows: [] }
      if (params[2] !== null) row['name'] = params[2]
      if (params[3] !== null) row['start_date'] = String(params[3])
      if (params[4] !== null) row['end_date'] = String(params[4])
      if (params[5] !== null) row['color'] = params[5]
      if (params[6] !== null) row['expected_multiplier_bp'] = params[6]
      if (params[7] !== null) row['regions'] = params[7]
      if (params[8] !== null) row['categories'] = params[8]
      if (params[9] !== null) row['is_active'] = params[9]
      row['updated_at'] = new Date().toISOString()
      return { rows: [row] }
    }
    if (/DELETE FROM workspace_festivals\s+WHERE workspace_id/i.test(s)) {
      // resetFestivalDefaults — delete non-template rows
      let count = 0
      for (const [k, row] of [...festivals.entries()]) {
        if (row['workspace_id'] === params[0] && !row['is_template']) {
          festivals.delete(k)
          count++
        }
      }
      return { rows: [{ count: String(count) }] }
    }
    if (/DELETE FROM workspace_festivals WHERE id/i.test(s)) {
      const row = festivals.get(String(params[0]))
      if (!row || row['workspace_id'] !== params[1]) return { rows: [] }
      festivals.delete(String(params[0]))
      return { rows: [{ id: params[0] }] }
    }

    // fallback — return empty (safe)
    return { rows: [] }
  }

  const mockClient = {
    query: (sql: string, params: unknown[] = []) => runQuery(sql, params),
  } as unknown as PoolClient

  const runners: DbRunners = {
    withWorkspace: async (_wsId: string, fn: (tx: PoolClient) => Promise<unknown>) => fn(mockClient),
    withSuperadmin: async (fn: (tx: PoolClient) => Promise<unknown>) => fn(mockClient),
  } as unknown as DbRunners

  // Pre-seed specific IDs so update/delete tests work
  const seedCost = (id = COST_ID, ws = workspaceId) => {
    costs.set(id, {
      id, workspace_id: ws, cost_type: 'CUSTOM', name: 'seed cost',
      amount_mu: 5000n, is_percent: false, currency_code: 'INR',
      billing_mode: 'MONTHLY', effective_from: '2026-01-01', effective_to: null,
      created_at: new Date().toISOString(),
    })
  }
  const seedExpense = (id = EXP_ID, ws = workspaceId) => {
    expenses.set(id, {
      id, workspace_id: ws, name: 'seed expense', amount_mu: 1000n, currency_code: 'INR',
      effective_start_date: '2026-01-01',
      created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
    })
  }
  const seedGoal = (id = GOAL_ID, ws = workspaceId) => {
    goals.set(id, {
      id, workspace_id: ws, metric_name: 'revenue', period_type: 'MONTHLY',
      period_start: '2026-05-01', goal_value: 10_000_000n, goal_unit: 'mu', goal_type: 'MINIMUM',
      created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
    })
  }
  const seedFestival = (id = FEST_ID, ws = workspaceId, isTemplate = false) => {
    festivals.set(id, {
      id, workspace_id: ws, name: 'Diwali', start_date: '2026-10-20', end_date: '2026-10-24',
      color: '#F59E0B', expected_multiplier_bp: 40000, regions: [], categories: [],
      is_template: isTemplate, is_active: true,
      created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
    })
  }

  return { runners, seedCost, seedExpense, seedGoal, seedFestival, festivals }
}

// ===========================================================================
// COSTS CRUD
// ===========================================================================

describe('Costs CRUD', () => {
  it('[+] createCost returns a row with bigint amount_mu', async () => {
    const { runners } = makeMockRunners(WS_A)
    const row = await createCost(WS_A, {
      cost_type: 'SHIPPING', billing_mode: 'PER_ORDER',
      amount_mu: 2000n, effective_from: '2026-01-01',
    }, runners)
    expect(row.cost_type).toBe('SHIPPING')
    expect(typeof row.amount_mu).toBe('bigint')
    expect(row.amount_mu).toBe(2000n)
    expect(row.workspace_id).toBe(WS_A)
  })

  it('[+] updateCost changes amount_mu', async () => {
    const { runners, seedCost } = makeMockRunners(WS_A)
    seedCost()
    const row = await updateCost(WS_A, COST_ID, { amount_mu: 9999n }, runners)
    expect(row.amount_mu).toBe(9999n)
    expect(row.id).toBe(COST_ID)
  })

  it('[+] deleteCost removes the row', async () => {
    const { runners, seedCost } = makeMockRunners(WS_A)
    seedCost()
    const result = await deleteCost(WS_A, COST_ID, runners)
    expect(result.deleted).toBe(true)
  })

  it('[-] updateCost NOT_FOUND when row missing', async () => {
    const { runners } = makeMockRunners(WS_A)
    await expect(updateCost(WS_A, COST_ID, { amount_mu: 1n }, runners))
      .rejects.toMatchObject({ code: 'NOT_FOUND' })
  })

  it('[-] deleteCost NOT_FOUND when row missing', async () => {
    const { runners } = makeMockRunners(WS_A)
    await expect(deleteCost(WS_A, COST_ID, runners))
      .rejects.toMatchObject({ code: 'NOT_FOUND' })
  })

  it('[-] updateCost cross-workspace isolation (seeded in WS_A, accessed from WS_B)', async () => {
    const { runners, seedCost } = makeMockRunners(WS_A)
    seedCost(COST_ID, WS_A)
    // WS_B has cost_id but workspace_id check fails → NOT_FOUND
    await expect(updateCost(WS_B, COST_ID, { amount_mu: 1n }, runners))
      .rejects.toMatchObject({ code: 'NOT_FOUND' })
  })
})

// ===========================================================================
// MISC-EXPENSES CRUD
// ===========================================================================

describe('Misc-expenses CRUD', () => {
  it('[+] createMiscExpense returns row with bigint amount_mu', async () => {
    const { runners } = makeMockRunners(WS_A)
    const row = await createMiscExpense(WS_A, {
      name: 'Packaging', amount_mu: 3000n, effective_start_date: '2026-01-01',
    }, runners)
    expect(row.name).toBe('Packaging')
    expect(typeof row.amount_mu).toBe('bigint')
    expect(row.amount_mu).toBe(3000n)
  })

  it('[+] createMiscExpense idempotent upsert — same name+date updates amount_mu', async () => {
    const { runners } = makeMockRunners(WS_A)
    await createMiscExpense(WS_A, { name: 'Rent', amount_mu: 1000n, effective_start_date: '2026-01-01' }, runners)
    const row = await createMiscExpense(WS_A, { name: 'Rent', amount_mu: 2000n, effective_start_date: '2026-01-01' }, runners)
    expect(row.amount_mu).toBe(2000n)
  })

  it('[+] updateMiscExpense changes name and currency', async () => {
    const { runners, seedExpense } = makeMockRunners(WS_A)
    seedExpense()
    const row = await updateMiscExpense(WS_A, EXP_ID, { name: 'Updated', currency_code: 'USD' }, runners)
    expect(row.name).toBe('Updated')
    expect(row.currency_code).toBe('USD')
  })

  it('[+] deleteMiscExpense removes the row', async () => {
    const { runners, seedExpense } = makeMockRunners(WS_A)
    seedExpense()
    const result = await deleteMiscExpense(WS_A, EXP_ID, runners)
    expect(result.deleted).toBe(true)
  })

  it('[-] updateMiscExpense NOT_FOUND when row missing', async () => {
    const { runners } = makeMockRunners(WS_A)
    await expect(updateMiscExpense(WS_A, EXP_ID, { name: 'X' }, runners))
      .rejects.toMatchObject({ code: 'NOT_FOUND' })
  })

  it('[-] deleteMiscExpense cross-workspace isolation', async () => {
    const { runners, seedExpense } = makeMockRunners(WS_A)
    seedExpense(EXP_ID, WS_A)
    await expect(deleteMiscExpense(WS_B, EXP_ID, runners))
      .rejects.toMatchObject({ code: 'NOT_FOUND' })
  })
})

// ===========================================================================
// FOUNDER SALARY
// ===========================================================================

describe('Founder salary', () => {
  it('[+] getFounderSalary returns null for un-set workspace', async () => {
    const { runners } = makeMockRunners(WS_A)
    const row = await getFounderSalary(WS_A, runners)
    expect(row.founder_salary_monthly_mu).toBeNull()
  })

  it('[+] setFounderSalary stores and returns bigint', async () => {
    const { runners } = makeMockRunners(WS_A)
    const row = await setFounderSalary(WS_A, { amount_mu: 500_000_00n, currency_code: 'INR' }, runners)
    expect(typeof row.founder_salary_monthly_mu).toBe('bigint')
    expect(row.founder_salary_monthly_mu).toBe(500_000_00n)
    expect(row.founder_salary_currency).toBe('INR')
  })

  it('[-] setFounderSalary NOT_FOUND when workspace missing', async () => {
    const { runners } = makeMockRunners(WS_A)
    await expect(setFounderSalary(WS_B, { amount_mu: 1n, currency_code: 'INR' }, runners))
      .rejects.toMatchObject({ code: 'NOT_FOUND' })
  })
})

// ===========================================================================
// WORKSPACE SETTINGS
// ===========================================================================

describe('Workspace settings', () => {
  it('[+] updateWorkspaceSettings changes timezone', async () => {
    const { runners } = makeMockRunners(WS_A)
    const row = await updateWorkspaceSettings(WS_A, { timezone: 'UTC' }, runners)
    expect(row.timezone).toBe('UTC')
  })

  it('[+] updateWorkspaceSettings updates COGS fields', async () => {
    const { runners } = makeMockRunners(WS_A)
    const row = await updateWorkspaceSettings(WS_A, {
      override_all_cogs_bp: 1000,
      cogs_markup_bp: 500,
      fallback_cogs_bp: 2000,
    }, runners)
    expect(row.override_all_cogs_bp).toBe(1000)
    expect(row.cogs_markup_bp).toBe(500)
    expect(row.fallback_cogs_bp).toBe(2000)
  })

  it('[+] updateWorkspaceSettings sets skip_zero_sales_orders', async () => {
    const { runners } = makeMockRunners(WS_A)
    const row = await updateWorkspaceSettings(WS_A, { skip_zero_sales_orders: true }, runners)
    expect(row.skip_zero_sales_orders).toBe(true)
  })

  it('[+] deleteWorkspace removes the workspace', async () => {
    const { runners } = makeMockRunners(WS_A)
    const result = await deleteWorkspace(WS_A, runners)
    expect(result.deleted).toBe(true)
  })

  it('[-] deleteWorkspace NOT_FOUND when workspace missing', async () => {
    const { runners } = makeMockRunners(WS_A)
    await expect(deleteWorkspace(WS_B, runners))
      .rejects.toMatchObject({ code: 'NOT_FOUND' })
  })

  it('[-] updateWorkspaceSettings NOT_FOUND for unknown workspace', async () => {
    const { runners } = makeMockRunners(WS_A)
    await expect(updateWorkspaceSettings(WS_B, { timezone: 'UTC' }, runners))
      .rejects.toMatchObject({ code: 'NOT_FOUND' })
  })
})

// ===========================================================================
// GOALS CRUD
// ===========================================================================

describe('Goals CRUD', () => {
  it('[+] createGoal returns bigint goal_value', async () => {
    const { runners } = makeMockRunners(WS_A)
    const row = await createGoal(WS_A, {
      metric_name: 'revenue', period_type: 'MONTHLY', period_start: '2026-05-01',
      goal_value: 10_000_000n, goal_type: 'MINIMUM',
    }, runners)
    expect(row.metric_name).toBe('revenue')
    expect(typeof row.goal_value).toBe('bigint')
    expect(row.goal_value).toBe(10_000_000n)
  })

  it('[+] createGoal upserts (same metric+period+start updates value)', async () => {
    const { runners } = makeMockRunners(WS_A)
    await createGoal(WS_A, {
      metric_name: 'cac', period_type: 'MONTHLY', period_start: '2026-05-01',
      goal_value: 100n, goal_type: 'MAXIMUM',
    }, runners)
    const row = await createGoal(WS_A, {
      metric_name: 'cac', period_type: 'MONTHLY', period_start: '2026-05-01',
      goal_value: 200n, goal_type: 'MAXIMUM',
    }, runners)
    expect(row.goal_value).toBe(200n)
  })

  it('[+] updateGoal changes goal_type', async () => {
    const { runners, seedGoal } = makeMockRunners(WS_A)
    seedGoal()
    const row = await updateGoal(WS_A, GOAL_ID, { goal_type: 'TARGET' }, runners)
    expect(row.goal_type).toBe('TARGET')
  })

  it('[+] deleteGoal removes the row', async () => {
    const { runners, seedGoal } = makeMockRunners(WS_A)
    seedGoal()
    const result = await deleteGoal(WS_A, GOAL_ID, runners)
    expect(result.deleted).toBe(true)
  })

  it('[-] updateGoal NOT_FOUND when row missing', async () => {
    const { runners } = makeMockRunners(WS_A)
    await expect(updateGoal(WS_A, GOAL_ID, { goal_type: 'TARGET' }, runners))
      .rejects.toMatchObject({ code: 'NOT_FOUND' })
  })

  it('[-] deleteGoal cross-workspace isolation', async () => {
    const { runners, seedGoal } = makeMockRunners(WS_A)
    seedGoal(GOAL_ID, WS_A)
    await expect(deleteGoal(WS_B, GOAL_ID, runners))
      .rejects.toMatchObject({ code: 'NOT_FOUND' })
  })

  it('[-] SettingsError is instanceof SettingsError', () => {
    const err = new SettingsError('NOT_FOUND', 'test')
    expect(err).toBeInstanceOf(SettingsError)
    expect(err.code).toBe('NOT_FOUND')
  })
})

// ===========================================================================
// AD-CAMPAIGN CLASSIFICATION
// ===========================================================================

describe('Ad-campaign classification', () => {
  it('[+] upsertAdCampaignClassification creates a row', async () => {
    const { runners } = makeMockRunners(WS_A)
    const row = await upsertAdCampaignClassification(WS_A, {
      platform: 'meta', campaign_id: 'camp_001', intent: 'acquisition', campaign_name: 'BFCM',
    }, runners)
    expect(row.intent).toBe('acquisition')
    expect(row.platform).toBe('meta')
    expect(row.campaign_id).toBe('camp_001')
  })

  it('[+] upsertAdCampaignClassification is idempotent (re-classify same campaign)', async () => {
    const { runners } = makeMockRunners(WS_A)
    await upsertAdCampaignClassification(WS_A, {
      platform: 'meta', campaign_id: 'camp_001', intent: 'brand',
    }, runners)
    const row = await upsertAdCampaignClassification(WS_A, {
      platform: 'meta', campaign_id: 'camp_001', intent: 'acquisition',
    }, runners)
    expect(row.intent).toBe('acquisition')
  })

  it('[+] upsertAdCampaignClassification works for google', async () => {
    const { runners } = makeMockRunners(WS_A)
    const row = await upsertAdCampaignClassification(WS_A, {
      platform: 'google', campaign_id: 'g_001', intent: 'retargeting',
    }, runners)
    expect(row.platform).toBe('google')
    expect(row.intent).toBe('retargeting')
  })
})

// ===========================================================================
// FESTIVALS CRUD
// ===========================================================================

describe('Festivals CRUD', () => {
  it('[+] createFestival returns expected row', async () => {
    const { runners } = makeMockRunners(WS_A)
    const row = await createFestival(WS_A, {
      name: 'Holi', start_date: '2026-03-25', end_date: '2026-03-26',
      expected_multiplier_bp: 20000,
    }, runners)
    expect(row.name).toBe('Holi')
    expect(row.expected_multiplier_bp).toBe(20000)
    expect(row.color).toBe('#F59E0B')
    expect(row.is_active).toBe(true)
  })

  it('[+] updateFestival changes multiplier and color', async () => {
    const { runners, seedFestival } = makeMockRunners(WS_A)
    seedFestival()
    const row = await updateFestival(WS_A, FEST_ID, {
      expected_multiplier_bp: 50000, color: '#FF0000',
    }, runners)
    expect(row.expected_multiplier_bp).toBe(50000)
    expect(row.color).toBe('#FF0000')
  })

  it('[+] deleteFestival removes the row', async () => {
    const { runners, seedFestival } = makeMockRunners(WS_A)
    seedFestival()
    const result = await deleteFestival(WS_A, FEST_ID, runners)
    expect(result.deleted).toBe(true)
  })

  it('[+] resetFestivalDefaults removes non-template rows, preserves templates', async () => {
    const { runners, seedFestival, festivals } = makeMockRunners(WS_A)
    seedFestival('f-non-template', WS_A, false)
    seedFestival('f-template',     WS_A, true)
    const result = await resetFestivalDefaults(WS_A, runners)
    expect(result.deleted_count).toBe(1)
    expect(festivals.has('f-template')).toBe(true)
    expect(festivals.has('f-non-template')).toBe(false)
  })

  it('[-] updateFestival NOT_FOUND when row missing', async () => {
    const { runners } = makeMockRunners(WS_A)
    await expect(updateFestival(WS_A, FEST_ID, { color: '#000' }, runners))
      .rejects.toMatchObject({ code: 'NOT_FOUND' })
  })

  it('[-] deleteFestival cross-workspace isolation', async () => {
    const { runners, seedFestival } = makeMockRunners(WS_A)
    seedFestival(FEST_ID, WS_A)
    await expect(deleteFestival(WS_B, FEST_ID, runners))
      .rejects.toMatchObject({ code: 'NOT_FOUND' })
  })
})

// ===========================================================================
// SettingsError class invariants
// ===========================================================================

describe('SettingsError', () => {
  it('is instanceof Error and SettingsError', () => {
    const e = new SettingsError('FORBIDDEN', 'nope')
    expect(e).toBeInstanceOf(Error)
    expect(e).toBeInstanceOf(SettingsError)
    expect(e.name).toBe('SettingsError')
    expect(e.code).toBe('FORBIDDEN')
    expect(e.message).toBe('nope')
  })
})
