/**
 * Settings CRUD application use-cases (Wave-3 parity).
 *
 * @paradigm sql (deterministic DB transactions; no ML, no LLM)
 *
 * Covers:
 *   - Costs CRUD          (workspace_costs)
 *   - Misc-expenses CRUD  (workspace_misc_expenses)
 *   - Founder salary      (workspaces.founder_salary_monthly_mu / founder_salary_currency)
 *   - Workspace settings update + delete-workspace
 *   - Goals CRUD          (workspace_metric_goals)
 *   - Ad-campaign classification update (workspace_ad_campaign_classifications)
 *   - Festivals CRUD      (workspace_festivals)
 *
 * Design invariants:
 *   - Every write runs under withWorkspace(workspaceId) — RLS-scoped, single primitive.
 *   - money columns are BIGINT minor units (paise/cents); never float.
 *   - delete-workspace runs under withSuperadmin (the row is deleted so no context to set).
 *   - All functions accept an injectable DbRunners for unit tests.
 */

import type { PoolClient } from 'pg'
import { packageLogger } from '@brain/lib-logger'
import { withWorkspace, withSuperadmin } from '../../infrastructure/db/workspace-context.js'

const log = packageLogger('api-gateway', 'core-settings')

export interface DbRunners {
  withWorkspace: typeof withWorkspace
  withSuperadmin: typeof withSuperadmin
}
const defaultRunners: DbRunners = { withWorkspace, withSuperadmin }

export class SettingsError extends Error {
  constructor(
    public readonly code:
      | 'NOT_FOUND'
      | 'CONFLICT'
      | 'VALIDATION'
      | 'FORBIDDEN',
    message: string,
  ) {
    super(message)
    this.name = 'SettingsError'
  }
}

// ---------------------------------------------------------------------------
// Shared types
// ---------------------------------------------------------------------------

export type CostType = 'SHIPPING' | 'PACKAGING' | 'WEBSITE' | 'CUSTOM'
export type BillingMode = 'MONTHLY' | 'PER_ORDER'
export type GoalPeriod = 'DAILY' | 'WEEKLY' | 'MONTHLY'
export type GoalType = 'MINIMUM' | 'MAXIMUM' | 'TARGET'

// ---------------------------------------------------------------------------
// 1. COSTS CRUD — workspace_costs
// ---------------------------------------------------------------------------

export interface CostRow {
  id: string
  workspace_id: string
  cost_type: CostType
  name: string | null
  amount_mu: bigint
  is_percent: boolean
  currency_code: string | null
  billing_mode: BillingMode
  effective_from: string
  effective_to: string | null
  created_at: string
}

export interface CreateCostInput {
  cost_type: CostType
  name?: string | null
  amount_mu: bigint
  is_percent?: boolean
  currency_code?: string | null
  billing_mode: BillingMode
  effective_from: string // ISO date YYYY-MM-DD
  effective_to?: string | null
}

export async function createCost(
  workspaceId: string,
  input: CreateCostInput,
  runners: DbRunners = defaultRunners,
): Promise<CostRow> {
  const fn = 'createCost'
  const t0 = Date.now()
  try {
    return await runners.withWorkspace(workspaceId, async (tx: PoolClient) => {
      const res = await tx.query<CostRow>(
        `INSERT INTO workspace_costs
           (workspace_id, cost_type, name, amount_mu, is_percent, currency_code, billing_mode, effective_from, effective_to)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
         RETURNING id, workspace_id, cost_type, name, amount_mu, is_percent, currency_code, billing_mode,
                   effective_from::text, effective_to::text, created_at::text`,
        [
          workspaceId,
          input.cost_type,
          input.name ?? null,
          input.amount_mu,
          input.is_percent ?? false,
          input.currency_code ?? null,
          input.billing_mode,
          input.effective_from,
          input.effective_to ?? null,
        ],
      )
      const row = res.rows[0]
      if (!row) throw new SettingsError('NOT_FOUND', 'Insert returned no row')
      log.debug({ fn, workspaceId, id: row.id, duration_ms: Date.now() - t0 }, 'createCost done')
      return { ...row, amount_mu: BigInt(row.amount_mu) }
    })
  } catch (err) {
    if (err instanceof SettingsError) throw err
    log.error({ fn, err, workspaceId, duration_ms: Date.now() - t0 }, 'createCost failed')
    throw err
  }
}

export interface UpdateCostInput {
  cost_type?: CostType
  name?: string | null
  amount_mu?: bigint
  is_percent?: boolean
  currency_code?: string | null
  billing_mode?: BillingMode
  effective_from?: string
  effective_to?: string | null
}

export async function updateCost(
  workspaceId: string,
  costId: string,
  input: UpdateCostInput,
  runners: DbRunners = defaultRunners,
): Promise<CostRow> {
  const fn = 'updateCost'
  const t0 = Date.now()
  try {
    return await runners.withWorkspace(workspaceId, async (tx: PoolClient) => {
      const res = await tx.query<CostRow>(
        `UPDATE workspace_costs SET
           cost_type     = COALESCE($3, cost_type),
           name          = CASE WHEN $4::boolean THEN $5 ELSE name END,
           amount_mu     = COALESCE($6, amount_mu),
           is_percent    = COALESCE($7, is_percent),
           currency_code = CASE WHEN $8::boolean THEN $9 ELSE currency_code END,
           billing_mode  = COALESCE($10, billing_mode),
           effective_from= COALESCE($11, effective_from),
           effective_to  = CASE WHEN $12::boolean THEN $13 ELSE effective_to END
         WHERE id = $1 AND workspace_id = $2
         RETURNING id, workspace_id, cost_type, name, amount_mu, is_percent, currency_code, billing_mode,
                   effective_from::text, effective_to::text, created_at::text`,
        [
          costId,
          workspaceId,
          input.cost_type ?? null,
          'name' in input,
          input.name ?? null,
          input.amount_mu ?? null,
          input.is_percent ?? null,
          'currency_code' in input,
          input.currency_code ?? null,
          input.billing_mode ?? null,
          input.effective_from ?? null,
          'effective_to' in input,
          input.effective_to ?? null,
        ],
      )
      const row = res.rows[0]
      if (!row) throw new SettingsError('NOT_FOUND', `Cost ${costId} not found in workspace`)
      log.debug({ fn, workspaceId, id: costId, duration_ms: Date.now() - t0 }, 'updateCost done')
      return { ...row, amount_mu: BigInt(row.amount_mu) }
    })
  } catch (err) {
    if (err instanceof SettingsError) throw err
    log.error({ fn, err, workspaceId, costId, duration_ms: Date.now() - t0 }, 'updateCost failed')
    throw err
  }
}

export async function deleteCost(
  workspaceId: string,
  costId: string,
  runners: DbRunners = defaultRunners,
): Promise<{ deleted: boolean }> {
  const fn = 'deleteCost'
  const t0 = Date.now()
  try {
    return await runners.withWorkspace(workspaceId, async (tx: PoolClient) => {
      const res = await tx.query<{ id: string }>(
        `DELETE FROM workspace_costs WHERE id = $1 AND workspace_id = $2 RETURNING id`,
        [costId, workspaceId],
      )
      const deleted = (res.rows.length ?? 0) > 0
      if (!deleted) throw new SettingsError('NOT_FOUND', `Cost ${costId} not found in workspace`)
      log.debug({ fn, workspaceId, id: costId, duration_ms: Date.now() - t0 }, 'deleteCost done')
      return { deleted }
    })
  } catch (err) {
    if (err instanceof SettingsError) throw err
    log.error({ fn, err, workspaceId, costId, duration_ms: Date.now() - t0 }, 'deleteCost failed')
    throw err
  }
}

// ---------------------------------------------------------------------------
// 2. MISC-EXPENSES CRUD — workspace_misc_expenses
// ---------------------------------------------------------------------------

export interface MiscExpenseRow {
  id: string
  workspace_id: string
  name: string
  amount_mu: bigint
  currency_code: string
  effective_start_date: string
  created_at: string
  updated_at: string
}

export interface CreateMiscExpenseInput {
  name: string
  amount_mu: bigint
  currency_code?: string
  effective_start_date: string
}

export async function createMiscExpense(
  workspaceId: string,
  input: CreateMiscExpenseInput,
  runners: DbRunners = defaultRunners,
): Promise<MiscExpenseRow> {
  const fn = 'createMiscExpense'
  const t0 = Date.now()
  try {
    return await runners.withWorkspace(workspaceId, async (tx: PoolClient) => {
      const res = await tx.query<MiscExpenseRow>(
        `INSERT INTO workspace_misc_expenses
           (workspace_id, name, amount_mu, currency_code, effective_start_date)
         VALUES ($1,$2,$3,$4,$5)
         ON CONFLICT (workspace_id, name, effective_start_date)
           DO UPDATE SET amount_mu = EXCLUDED.amount_mu, updated_at = now()
         RETURNING id, workspace_id, name, amount_mu, currency_code,
                   effective_start_date::text, created_at::text, updated_at::text`,
        [
          workspaceId,
          input.name,
          input.amount_mu,
          input.currency_code ?? 'INR',
          input.effective_start_date,
        ],
      )
      const row = res.rows[0]
      if (!row) throw new SettingsError('NOT_FOUND', 'Insert returned no row')
      log.debug({ fn, workspaceId, id: row.id, duration_ms: Date.now() - t0 }, 'createMiscExpense done')
      return { ...row, amount_mu: BigInt(row.amount_mu) }
    })
  } catch (err) {
    if (err instanceof SettingsError) throw err
    log.error({ fn, err, workspaceId, duration_ms: Date.now() - t0 }, 'createMiscExpense failed')
    throw err
  }
}

export interface UpdateMiscExpenseInput {
  name?: string
  amount_mu?: bigint
  currency_code?: string
  effective_start_date?: string
}

export async function updateMiscExpense(
  workspaceId: string,
  expenseId: string,
  input: UpdateMiscExpenseInput,
  runners: DbRunners = defaultRunners,
): Promise<MiscExpenseRow> {
  const fn = 'updateMiscExpense'
  const t0 = Date.now()
  try {
    return await runners.withWorkspace(workspaceId, async (tx: PoolClient) => {
      const res = await tx.query<MiscExpenseRow>(
        `UPDATE workspace_misc_expenses SET
           name                = COALESCE($3, name),
           amount_mu           = COALESCE($4, amount_mu),
           currency_code       = COALESCE($5, currency_code),
           effective_start_date= COALESCE($6, effective_start_date),
           updated_at          = now()
         WHERE id = $1 AND workspace_id = $2
         RETURNING id, workspace_id, name, amount_mu, currency_code,
                   effective_start_date::text, created_at::text, updated_at::text`,
        [
          expenseId,
          workspaceId,
          input.name ?? null,
          input.amount_mu ?? null,
          input.currency_code ?? null,
          input.effective_start_date ?? null,
        ],
      )
      const row = res.rows[0]
      if (!row) throw new SettingsError('NOT_FOUND', `Misc expense ${expenseId} not found in workspace`)
      log.debug({ fn, workspaceId, id: expenseId, duration_ms: Date.now() - t0 }, 'updateMiscExpense done')
      return { ...row, amount_mu: BigInt(row.amount_mu) }
    })
  } catch (err) {
    if (err instanceof SettingsError) throw err
    log.error({ fn, err, workspaceId, expenseId, duration_ms: Date.now() - t0 }, 'updateMiscExpense failed')
    throw err
  }
}

export async function deleteMiscExpense(
  workspaceId: string,
  expenseId: string,
  runners: DbRunners = defaultRunners,
): Promise<{ deleted: boolean }> {
  const fn = 'deleteMiscExpense'
  const t0 = Date.now()
  try {
    return await runners.withWorkspace(workspaceId, async (tx: PoolClient) => {
      const res = await tx.query<{ id: string }>(
        `DELETE FROM workspace_misc_expenses WHERE id = $1 AND workspace_id = $2 RETURNING id`,
        [expenseId, workspaceId],
      )
      const deleted = (res.rows.length ?? 0) > 0
      if (!deleted) throw new SettingsError('NOT_FOUND', `Misc expense ${expenseId} not found in workspace`)
      log.debug({ fn, workspaceId, id: expenseId, duration_ms: Date.now() - t0 }, 'deleteMiscExpense done')
      return { deleted }
    })
  } catch (err) {
    if (err instanceof SettingsError) throw err
    log.error({ fn, err, workspaceId, expenseId, duration_ms: Date.now() - t0 }, 'deleteMiscExpense failed')
    throw err
  }
}

// ---------------------------------------------------------------------------
// 3. FOUNDER SALARY — workspaces (founder_salary_monthly_mu / founder_salary_currency)
// ---------------------------------------------------------------------------

export interface FounderSalaryRow {
  founder_salary_monthly_mu: bigint | null
  founder_salary_currency: string | null
}

export async function getFounderSalary(
  workspaceId: string,
  runners: DbRunners = defaultRunners,
): Promise<FounderSalaryRow> {
  const fn = 'getFounderSalary'
  const t0 = Date.now()
  try {
    return await runners.withWorkspace(workspaceId, async (tx: PoolClient) => {
      const res = await tx.query<{
        founder_salary_monthly_mu: string | null
        founder_salary_currency: string | null
      }>(
        `SELECT founder_salary_monthly_mu, founder_salary_currency
           FROM workspaces WHERE id = $1`,
        [workspaceId],
      )
      const row = res.rows[0]
      if (!row) throw new SettingsError('NOT_FOUND', `Workspace ${workspaceId} not found`)
      log.debug({ fn, workspaceId, duration_ms: Date.now() - t0 }, 'getFounderSalary done')
      return {
        founder_salary_monthly_mu: row.founder_salary_monthly_mu != null ? BigInt(row.founder_salary_monthly_mu) : null,
        founder_salary_currency: row.founder_salary_currency,
      }
    })
  } catch (err) {
    if (err instanceof SettingsError) throw err
    log.error({ fn, err, workspaceId, duration_ms: Date.now() - t0 }, 'getFounderSalary failed')
    throw err
  }
}

export async function setFounderSalary(
  workspaceId: string,
  input: { amount_mu: bigint; currency_code: string },
  runners: DbRunners = defaultRunners,
): Promise<FounderSalaryRow> {
  const fn = 'setFounderSalary'
  const t0 = Date.now()
  try {
    return await runners.withWorkspace(workspaceId, async (tx: PoolClient) => {
      const res = await tx.query<{
        founder_salary_monthly_mu: string | null
        founder_salary_currency: string | null
      }>(
        `UPDATE workspaces
            SET founder_salary_monthly_mu = $2,
                founder_salary_currency   = $3,
                updated_at                = now()
          WHERE id = $1
          RETURNING founder_salary_monthly_mu, founder_salary_currency`,
        [workspaceId, input.amount_mu, input.currency_code],
      )
      const row = res.rows[0]
      if (!row) throw new SettingsError('NOT_FOUND', `Workspace ${workspaceId} not found`)
      log.debug({ fn, workspaceId, duration_ms: Date.now() - t0 }, 'setFounderSalary done')
      return {
        founder_salary_monthly_mu: row.founder_salary_monthly_mu != null ? BigInt(row.founder_salary_monthly_mu) : null,
        founder_salary_currency: row.founder_salary_currency,
      }
    })
  } catch (err) {
    if (err instanceof SettingsError) throw err
    log.error({ fn, err, workspaceId, duration_ms: Date.now() - t0 }, 'setFounderSalary failed')
    throw err
  }
}

// ---------------------------------------------------------------------------
// 4. WORKSPACE SETTINGS UPDATE — workspaces + workspace_cogs_settings
// ---------------------------------------------------------------------------

export interface WorkspaceSettingsUpdateInput {
  timezone?: string
  tax_percent_bp?: number           // 0..10000
  skip_zero_sales_orders?: boolean
  skipped_shopify_order_tags?: string[]
  override_all_cogs_bp?: number     // 0..10000
  cogs_markup_bp?: number           // 0..10000
  fallback_cogs_bp?: number         // 0..10000
}

export interface WorkspaceSettingsRow {
  id: string
  timezone: string
  tax_percent_bp: number
  skip_zero_sales_orders: boolean
  skipped_shopify_order_tags: string[]
  override_all_cogs_bp: number
  cogs_markup_bp: number
  fallback_cogs_bp: number
  updated_at: string
}

export async function updateWorkspaceSettings(
  workspaceId: string,
  input: WorkspaceSettingsUpdateInput,
  runners: DbRunners = defaultRunners,
): Promise<WorkspaceSettingsRow> {
  const fn = 'updateWorkspaceSettings'
  const t0 = Date.now()
  try {
    return await runners.withWorkspace(workspaceId, async (tx: PoolClient) => {
      // Update workspaces table fields
      await tx.query(
        `UPDATE workspaces SET
           timezone                  = COALESCE($2, timezone),
           tax_percent_bp            = COALESCE($3, tax_percent_bp),
           skip_zero_sales_orders    = COALESCE($4, skip_zero_sales_orders),
           skipped_shopify_order_tags= COALESCE($5, skipped_shopify_order_tags),
           updated_at                = now()
         WHERE id = $1`,
        [
          workspaceId,
          input.timezone ?? null,
          input.tax_percent_bp ?? null,
          input.skip_zero_sales_orders ?? null,
          input.skipped_shopify_order_tags ?? null,
        ],
      )

      // Upsert COGS settings if any COGS field provided
      if (
        input.override_all_cogs_bp !== undefined ||
        input.cogs_markup_bp !== undefined ||
        input.fallback_cogs_bp !== undefined
      ) {
        await tx.query(
          `INSERT INTO workspace_cogs_settings (workspace_id, override_all_cogs_bp, cogs_markup_bp, fallback_cogs_bp)
             VALUES ($1, COALESCE($2, 0), COALESCE($3, 0), COALESCE($4, 0))
           ON CONFLICT (workspace_id) DO UPDATE SET
             override_all_cogs_bp = COALESCE($2, workspace_cogs_settings.override_all_cogs_bp),
             cogs_markup_bp       = COALESCE($3, workspace_cogs_settings.cogs_markup_bp),
             fallback_cogs_bp     = COALESCE($4, workspace_cogs_settings.fallback_cogs_bp),
             updated_at           = now()`,
          [
            workspaceId,
            input.override_all_cogs_bp ?? null,
            input.cogs_markup_bp ?? null,
            input.fallback_cogs_bp ?? null,
          ],
        )
      }

      // Read back combined row
      const res = await tx.query<{
        id: string
        timezone: string
        tax_percent_bp: number
        skip_zero_sales_orders: boolean
        skipped_shopify_order_tags: string[]
        updated_at: string
        override_all_cogs_bp: number | null
        cogs_markup_bp: number | null
        fallback_cogs_bp: number | null
      }>(
        `SELECT w.id, w.timezone, w.tax_percent_bp, w.skip_zero_sales_orders,
                w.skipped_shopify_order_tags, w.updated_at::text,
                c.override_all_cogs_bp, c.cogs_markup_bp, c.fallback_cogs_bp
           FROM workspaces w
           LEFT JOIN workspace_cogs_settings c ON c.workspace_id = w.id
          WHERE w.id = $1`,
        [workspaceId],
      )
      const row = res.rows[0]
      if (!row) throw new SettingsError('NOT_FOUND', `Workspace ${workspaceId} not found`)
      log.debug({ fn, workspaceId, duration_ms: Date.now() - t0 }, 'updateWorkspaceSettings done')
      return {
        id: row.id,
        timezone: row.timezone,
        tax_percent_bp: row.tax_percent_bp,
        skip_zero_sales_orders: row.skip_zero_sales_orders,
        skipped_shopify_order_tags: row.skipped_shopify_order_tags,
        override_all_cogs_bp: row.override_all_cogs_bp ?? 0,
        cogs_markup_bp: row.cogs_markup_bp ?? 0,
        fallback_cogs_bp: row.fallback_cogs_bp ?? 0,
        updated_at: row.updated_at,
      }
    })
  } catch (err) {
    if (err instanceof SettingsError) throw err
    log.error({ fn, err, workspaceId, duration_ms: Date.now() - t0 }, 'updateWorkspaceSettings failed')
    throw err
  }
}

/**
 * deleteWorkspace — OWNER-only, runs under withSuperadmin because the row is about to
 * be deleted (no context to set; ON DELETE CASCADE handles member/connector cleanup).
 * The caller MUST verify the password before invoking this use-case.
 */
export async function deleteWorkspace(
  workspaceId: string,
  runners: DbRunners = defaultRunners,
): Promise<{ deleted: boolean }> {
  const fn = 'deleteWorkspace'
  const t0 = Date.now()
  try {
    return await runners.withSuperadmin(async (tx: PoolClient) => {
      const res = await tx.query<{ id: string }>(
        `DELETE FROM workspaces WHERE id = $1 RETURNING id`,
        [workspaceId],
      )
      const deleted = (res.rows.length ?? 0) > 0
      if (!deleted) throw new SettingsError('NOT_FOUND', `Workspace ${workspaceId} not found`)
      log.debug({ fn, workspaceId, duration_ms: Date.now() - t0 }, 'deleteWorkspace done')
      return { deleted }
    })
  } catch (err) {
    if (err instanceof SettingsError) throw err
    log.error({ fn, err, workspaceId, duration_ms: Date.now() - t0 }, 'deleteWorkspace failed')
    throw err
  }
}

// ---------------------------------------------------------------------------
// 5. GOALS CRUD — workspace_metric_goals
// ---------------------------------------------------------------------------

export interface GoalRow {
  id: string
  workspace_id: string
  metric_name: string
  period_type: GoalPeriod
  period_start: string
  goal_value: bigint
  goal_unit: string
  goal_type: GoalType
  created_at: string
  updated_at: string
}

export interface CreateGoalInput {
  metric_name: string
  period_type: GoalPeriod
  period_start: string
  goal_value: bigint
  goal_unit?: string
  goal_type: GoalType
}

export async function createGoal(
  workspaceId: string,
  input: CreateGoalInput,
  runners: DbRunners = defaultRunners,
): Promise<GoalRow> {
  const fn = 'createGoal'
  const t0 = Date.now()
  try {
    return await runners.withWorkspace(workspaceId, async (tx: PoolClient) => {
      const res = await tx.query<GoalRow>(
        `INSERT INTO workspace_metric_goals
           (workspace_id, metric_name, period_type, period_start, goal_value, goal_unit, goal_type)
         VALUES ($1,$2,$3,$4,$5,$6,$7)
         ON CONFLICT (workspace_id, metric_name, period_type, period_start)
           DO UPDATE SET goal_value = EXCLUDED.goal_value, goal_type = EXCLUDED.goal_type, updated_at = now()
         RETURNING id, workspace_id, metric_name, period_type, period_start::text,
                   goal_value, goal_unit, goal_type, created_at::text, updated_at::text`,
        [
          workspaceId,
          input.metric_name,
          input.period_type,
          input.period_start,
          input.goal_value,
          input.goal_unit ?? 'mu',
          input.goal_type,
        ],
      )
      const row = res.rows[0]
      if (!row) throw new SettingsError('NOT_FOUND', 'Insert returned no row')
      log.debug({ fn, workspaceId, id: row.id, duration_ms: Date.now() - t0 }, 'createGoal done')
      return { ...row, goal_value: BigInt(row.goal_value) }
    })
  } catch (err) {
    if (err instanceof SettingsError) throw err
    log.error({ fn, err, workspaceId, duration_ms: Date.now() - t0 }, 'createGoal failed')
    throw err
  }
}

export interface UpdateGoalInput {
  goal_value?: bigint
  goal_type?: GoalType
  goal_unit?: string
}

export async function updateGoal(
  workspaceId: string,
  goalId: string,
  input: UpdateGoalInput,
  runners: DbRunners = defaultRunners,
): Promise<GoalRow> {
  const fn = 'updateGoal'
  const t0 = Date.now()
  try {
    return await runners.withWorkspace(workspaceId, async (tx: PoolClient) => {
      const res = await tx.query<GoalRow>(
        `UPDATE workspace_metric_goals SET
           goal_value = COALESCE($3, goal_value),
           goal_type  = COALESCE($4, goal_type),
           goal_unit  = COALESCE($5, goal_unit),
           updated_at = now()
         WHERE id = $1 AND workspace_id = $2
         RETURNING id, workspace_id, metric_name, period_type, period_start::text,
                   goal_value, goal_unit, goal_type, created_at::text, updated_at::text`,
        [
          goalId,
          workspaceId,
          input.goal_value ?? null,
          input.goal_type ?? null,
          input.goal_unit ?? null,
        ],
      )
      const row = res.rows[0]
      if (!row) throw new SettingsError('NOT_FOUND', `Goal ${goalId} not found in workspace`)
      log.debug({ fn, workspaceId, id: goalId, duration_ms: Date.now() - t0 }, 'updateGoal done')
      return { ...row, goal_value: BigInt(row.goal_value) }
    })
  } catch (err) {
    if (err instanceof SettingsError) throw err
    log.error({ fn, err, workspaceId, goalId, duration_ms: Date.now() - t0 }, 'updateGoal failed')
    throw err
  }
}

export async function deleteGoal(
  workspaceId: string,
  goalId: string,
  runners: DbRunners = defaultRunners,
): Promise<{ deleted: boolean }> {
  const fn = 'deleteGoal'
  const t0 = Date.now()
  try {
    return await runners.withWorkspace(workspaceId, async (tx: PoolClient) => {
      const res = await tx.query<{ id: string }>(
        `DELETE FROM workspace_metric_goals WHERE id = $1 AND workspace_id = $2 RETURNING id`,
        [goalId, workspaceId],
      )
      const deleted = (res.rows.length ?? 0) > 0
      if (!deleted) throw new SettingsError('NOT_FOUND', `Goal ${goalId} not found in workspace`)
      log.debug({ fn, workspaceId, id: goalId, duration_ms: Date.now() - t0 }, 'deleteGoal done')
      return { deleted }
    })
  } catch (err) {
    if (err instanceof SettingsError) throw err
    log.error({ fn, err, workspaceId, goalId, duration_ms: Date.now() - t0 }, 'deleteGoal failed')
    throw err
  }
}

// ---------------------------------------------------------------------------
// 6. AD-CAMPAIGN CLASSIFICATION — workspace_ad_campaign_classifications
// ---------------------------------------------------------------------------

export type CampaignIntent = 'acquisition' | 'retargeting' | 'brand' | 'unclassified'

export interface AdCampaignClassificationRow {
  id: string
  workspace_id: string
  platform: string
  campaign_id: string
  intent: CampaignIntent
  campaign_name: string | null
  created_at: string
  updated_at: string
}

export interface UpsertAdCampaignClassificationInput {
  platform: 'meta' | 'google'
  campaign_id: string
  intent: CampaignIntent
  campaign_name?: string | null
}

export async function upsertAdCampaignClassification(
  workspaceId: string,
  input: UpsertAdCampaignClassificationInput,
  runners: DbRunners = defaultRunners,
): Promise<AdCampaignClassificationRow> {
  const fn = 'upsertAdCampaignClassification'
  const t0 = Date.now()
  try {
    return await runners.withWorkspace(workspaceId, async (tx: PoolClient) => {
      const res = await tx.query<AdCampaignClassificationRow>(
        `INSERT INTO workspace_ad_campaign_classifications
           (workspace_id, platform, campaign_id, intent, campaign_name)
         VALUES ($1,$2,$3,$4,$5)
         ON CONFLICT (workspace_id, platform, campaign_id)
           DO UPDATE SET intent = EXCLUDED.intent,
                         campaign_name = COALESCE(EXCLUDED.campaign_name, workspace_ad_campaign_classifications.campaign_name),
                         updated_at = now()
         RETURNING id, workspace_id, platform, campaign_id, intent, campaign_name,
                   created_at::text, updated_at::text`,
        [
          workspaceId,
          input.platform,
          input.campaign_id,
          input.intent,
          input.campaign_name ?? null,
        ],
      )
      const row = res.rows[0]
      if (!row) throw new SettingsError('NOT_FOUND', 'Upsert returned no row')
      log.debug({ fn, workspaceId, id: row.id, duration_ms: Date.now() - t0 }, 'upsertAdCampaignClassification done')
      return row
    })
  } catch (err) {
    if (err instanceof SettingsError) throw err
    log.error({ fn, err, workspaceId, duration_ms: Date.now() - t0 }, 'upsertAdCampaignClassification failed')
    throw err
  }
}

// ---------------------------------------------------------------------------
// 7. FESTIVALS CRUD — workspace_festivals
// ---------------------------------------------------------------------------

export interface FestivalRow {
  id: string
  workspace_id: string
  name: string
  start_date: string
  end_date: string
  color: string
  expected_multiplier_bp: number
  regions: string[]
  categories: string[]
  is_template: boolean
  is_active: boolean
  created_at: string
  updated_at: string
}

export interface CreateFestivalInput {
  name: string
  start_date: string
  end_date: string
  color?: string
  expected_multiplier_bp: number
  regions?: string[]
  categories?: string[]
  is_template?: boolean
  is_active?: boolean
}

export async function createFestival(
  workspaceId: string,
  input: CreateFestivalInput,
  runners: DbRunners = defaultRunners,
): Promise<FestivalRow> {
  const fn = 'createFestival'
  const t0 = Date.now()
  try {
    return await runners.withWorkspace(workspaceId, async (tx: PoolClient) => {
      const res = await tx.query<FestivalRow>(
        `INSERT INTO workspace_festivals
           (workspace_id, name, start_date, end_date, color, expected_multiplier_bp, regions, categories, is_template, is_active)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
         RETURNING id, workspace_id, name, start_date::text, end_date::text, color,
                   expected_multiplier_bp, regions, categories, is_template, is_active,
                   created_at::text, updated_at::text`,
        [
          workspaceId,
          input.name,
          input.start_date,
          input.end_date,
          input.color ?? '#F59E0B',
          input.expected_multiplier_bp,
          input.regions ?? [],
          input.categories ?? [],
          input.is_template ?? false,
          input.is_active ?? true,
        ],
      )
      const row = res.rows[0]
      if (!row) throw new SettingsError('NOT_FOUND', 'Insert returned no row')
      log.debug({ fn, workspaceId, id: row.id, duration_ms: Date.now() - t0 }, 'createFestival done')
      return row
    })
  } catch (err) {
    if (err instanceof SettingsError) throw err
    log.error({ fn, err, workspaceId, duration_ms: Date.now() - t0 }, 'createFestival failed')
    throw err
  }
}

export interface UpdateFestivalInput {
  name?: string
  start_date?: string
  end_date?: string
  color?: string
  expected_multiplier_bp?: number
  regions?: string[]
  categories?: string[]
  is_active?: boolean
}

export async function updateFestival(
  workspaceId: string,
  festivalId: string,
  input: UpdateFestivalInput,
  runners: DbRunners = defaultRunners,
): Promise<FestivalRow> {
  const fn = 'updateFestival'
  const t0 = Date.now()
  try {
    return await runners.withWorkspace(workspaceId, async (tx: PoolClient) => {
      const res = await tx.query<FestivalRow>(
        `UPDATE workspace_festivals SET
           name                   = COALESCE($3, name),
           start_date             = COALESCE($4, start_date),
           end_date               = COALESCE($5, end_date),
           color                  = COALESCE($6, color),
           expected_multiplier_bp = COALESCE($7, expected_multiplier_bp),
           regions                = COALESCE($8, regions),
           categories             = COALESCE($9, categories),
           is_active              = COALESCE($10, is_active),
           updated_at             = now()
         WHERE id = $1 AND workspace_id = $2
         RETURNING id, workspace_id, name, start_date::text, end_date::text, color,
                   expected_multiplier_bp, regions, categories, is_template, is_active,
                   created_at::text, updated_at::text`,
        [
          festivalId,
          workspaceId,
          input.name ?? null,
          input.start_date ?? null,
          input.end_date ?? null,
          input.color ?? null,
          input.expected_multiplier_bp ?? null,
          input.regions ?? null,
          input.categories ?? null,
          input.is_active ?? null,
        ],
      )
      const row = res.rows[0]
      if (!row) throw new SettingsError('NOT_FOUND', `Festival ${festivalId} not found in workspace`)
      log.debug({ fn, workspaceId, id: festivalId, duration_ms: Date.now() - t0 }, 'updateFestival done')
      return row
    })
  } catch (err) {
    if (err instanceof SettingsError) throw err
    log.error({ fn, err, workspaceId, festivalId, duration_ms: Date.now() - t0 }, 'updateFestival failed')
    throw err
  }
}

export async function deleteFestival(
  workspaceId: string,
  festivalId: string,
  runners: DbRunners = defaultRunners,
): Promise<{ deleted: boolean }> {
  const fn = 'deleteFestival'
  const t0 = Date.now()
  try {
    return await runners.withWorkspace(workspaceId, async (tx: PoolClient) => {
      const res = await tx.query<{ id: string }>(
        `DELETE FROM workspace_festivals WHERE id = $1 AND workspace_id = $2 RETURNING id`,
        [festivalId, workspaceId],
      )
      const deleted = (res.rows.length ?? 0) > 0
      if (!deleted) throw new SettingsError('NOT_FOUND', `Festival ${festivalId} not found in workspace`)
      log.debug({ fn, workspaceId, id: festivalId, duration_ms: Date.now() - t0 }, 'deleteFestival done')
      return { deleted }
    })
  } catch (err) {
    if (err instanceof SettingsError) throw err
    log.error({ fn, err, workspaceId, festivalId, duration_ms: Date.now() - t0 }, 'deleteFestival failed')
    throw err
  }
}

/**
 * resetFestivalDefaults — deletes ALL workspace-specific (non-template) festival rows
 * and re-seeds from the system template set. Template rows are preserved.
 * Idempotent: safe to call repeatedly.
 */
export async function resetFestivalDefaults(
  workspaceId: string,
  runners: DbRunners = defaultRunners,
): Promise<{ deleted_count: number }> {
  const fn = 'resetFestivalDefaults'
  const t0 = Date.now()
  try {
    return await runners.withWorkspace(workspaceId, async (tx: PoolClient) => {
      const res = await tx.query<{ count: string }>(
        `WITH deleted AS (
           DELETE FROM workspace_festivals
            WHERE workspace_id = $1 AND is_template = false
           RETURNING id
         )
         SELECT COUNT(*) AS count FROM deleted`,
        [workspaceId],
      )
      const deleted_count = parseInt(res.rows[0]?.count ?? '0', 10)
      log.debug({ fn, workspaceId, deleted_count, duration_ms: Date.now() - t0 }, 'resetFestivalDefaults done')
      return { deleted_count }
    })
  } catch (err) {
    log.error({ fn, err, workspaceId, duration_ms: Date.now() - t0 }, 'resetFestivalDefaults failed')
    throw err
  }
}

// ---------------------------------------------------------------------------
// 8. MARKETING ACTIONS CRUD — marketing_actions
// Operator-logged events (email blasts, promotions, etc.) that overlay the
// calendar report. Money fields: NONE (no spend on this table — spend lives
// in connector_order_facts / platform-ads). Source is always 'manual' for
// operator-created rows; 'klaviyo' is reserved for sync-created rows.
// ---------------------------------------------------------------------------

export const MARKETING_ACTION_TYPES = [
  'email_campaign',
  'sms_campaign',
  'promotion',
  'product_launch',
  'influencer',
  'ad_creative_change',
  'external_event',
  'sale_event',
] as const
export type MarketingActionType = (typeof MARKETING_ACTION_TYPES)[number]

export interface MarketingActionRow {
  id: string
  workspace_id: string
  action_date: string   // ISO yyyy-mm-dd
  action_type: string
  action_name: string
  notes: string | null
  created_by: string | null
  created_at: string
  updated_at: string
}

export interface CreateMarketingActionInput {
  action_date: string
  action_type: string
  action_name: string
  notes?: string | null
  created_by?: string | null
}

export interface UpdateMarketingActionInput {
  action_date?: string
  action_type?: string
  action_name?: string
  notes?: string | null
}

export async function listMarketingActions(
  workspaceId: string,
  dateStart: string,
  dateEnd: string,
  runners: DbRunners = defaultRunners,
): Promise<MarketingActionRow[]> {
  const fn = 'listMarketingActions'
  const t0 = Date.now()
  try {
    return await runners.withWorkspace(workspaceId, async (tx: PoolClient) => {
      const res = await tx.query<MarketingActionRow>(
        `SELECT id, workspace_id, action_date::text, action_type, action_name, notes,
                created_by::text, created_at::text, updated_at::text
         FROM marketing_actions
         WHERE workspace_id = $1
           AND action_date BETWEEN $2::date AND $3::date
         ORDER BY action_date ASC, created_at ASC`,
        [workspaceId, dateStart, dateEnd],
      )
      log.debug({ fn, workspaceId, count: res.rows.length, duration_ms: Date.now() - t0 }, 'listMarketingActions done')
      return res.rows
    })
  } catch (err) {
    log.error({ fn, err, workspaceId, duration_ms: Date.now() - t0 }, 'listMarketingActions failed')
    throw err
  }
}

export async function createMarketingAction(
  workspaceId: string,
  input: CreateMarketingActionInput,
  runners: DbRunners = defaultRunners,
): Promise<MarketingActionRow> {
  const fn = 'createMarketingAction'
  const t0 = Date.now()
  try {
    return await runners.withWorkspace(workspaceId, async (tx: PoolClient) => {
      const res = await tx.query<MarketingActionRow>(
        `INSERT INTO marketing_actions
           (workspace_id, action_date, action_type, action_name, notes, created_by)
         VALUES ($1, $2::date, $3, $4, $5, $6)
         RETURNING id, workspace_id, action_date::text, action_type, action_name, notes,
                   created_by::text, created_at::text, updated_at::text`,
        [
          workspaceId,
          input.action_date,
          input.action_type,
          input.action_name,
          input.notes ?? null,
          input.created_by ?? null,
        ],
      )
      const row = res.rows[0]
      if (!row) throw new SettingsError('NOT_FOUND', 'Insert returned no row')
      log.debug({ fn, workspaceId, id: row.id, duration_ms: Date.now() - t0 }, 'createMarketingAction done')
      return row
    })
  } catch (err) {
    if (err instanceof SettingsError) throw err
    log.error({ fn, err, workspaceId, duration_ms: Date.now() - t0 }, 'createMarketingAction failed')
    throw err
  }
}

export async function updateMarketingAction(
  workspaceId: string,
  actionId: string,
  input: UpdateMarketingActionInput,
  runners: DbRunners = defaultRunners,
): Promise<MarketingActionRow> {
  const fn = 'updateMarketingAction'
  const t0 = Date.now()
  try {
    return await runners.withWorkspace(workspaceId, async (tx: PoolClient) => {
      const sets: string[] = ['updated_at = now()']
      const vals: unknown[] = [actionId, workspaceId]
      let idx = 3
      if (input.action_date !== undefined) { sets.push(`action_date = $${idx}::date`); vals.push(input.action_date); idx++ }
      if (input.action_type !== undefined) { sets.push(`action_type = $${idx}`); vals.push(input.action_type); idx++ }
      if (input.action_name !== undefined) { sets.push(`action_name = $${idx}`); vals.push(input.action_name); idx++ }
      if (input.notes !== undefined) { sets.push(`notes = $${idx}`); vals.push(input.notes); idx++ }
      const res = await tx.query<MarketingActionRow>(
        `UPDATE marketing_actions SET ${sets.join(', ')}
         WHERE id = $1 AND workspace_id = $2
         RETURNING id, workspace_id, action_date::text, action_type, action_name, notes,
                   created_by::text, created_at::text, updated_at::text`,
        vals,
      )
      const row = res.rows[0]
      if (!row) throw new SettingsError('NOT_FOUND', `Marketing action ${actionId} not found in workspace`)
      log.debug({ fn, workspaceId, id: actionId, duration_ms: Date.now() - t0 }, 'updateMarketingAction done')
      return row
    })
  } catch (err) {
    if (err instanceof SettingsError) throw err
    log.error({ fn, err, workspaceId, actionId, duration_ms: Date.now() - t0 }, 'updateMarketingAction failed')
    throw err
  }
}

export async function deleteMarketingAction(
  workspaceId: string,
  actionId: string,
  runners: DbRunners = defaultRunners,
): Promise<{ deleted: boolean }> {
  const fn = 'deleteMarketingAction'
  const t0 = Date.now()
  try {
    return await runners.withWorkspace(workspaceId, async (tx: PoolClient) => {
      const res = await tx.query<{ id: string }>(
        `DELETE FROM marketing_actions WHERE id = $1 AND workspace_id = $2 RETURNING id`,
        [actionId, workspaceId],
      )
      const deleted = (res.rows[0]?.id) != null
      if (!deleted) throw new SettingsError('NOT_FOUND', `Marketing action ${actionId} not found in workspace`)
      log.debug({ fn, workspaceId, id: actionId, duration_ms: Date.now() - t0 }, 'deleteMarketingAction done')
      return { deleted: true }
    })
  } catch (err) {
    if (err instanceof SettingsError) throw err
    log.error({ fn, err, workspaceId, actionId, duration_ms: Date.now() - t0 }, 'deleteMarketingAction failed')
    throw err
  }
}
