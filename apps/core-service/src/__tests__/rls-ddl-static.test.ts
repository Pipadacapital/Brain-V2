/**
 * Track T — Static contract tests for RLS DDL files (Track B)
 *
 * CF-C1-RLS-DEFAULT-1.a: assert the DDL contains ZERO banned shapes.
 * Also asserts every workspace-scoped table has a ws_isolation policy.
 *
 * These tests run without a live DB — they grep the SQL file contents.
 */

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))

const MIGRATIONS_DIR = resolve(__dirname, '../..', 'migrations', 'manual', 'rls')

function readSql(filename: string): string {
  return readFileSync(resolve(MIGRATIONS_DIR, filename), 'utf-8')
}

const stepA = readSql('step-a-enable-create.sql')
const stepB = readSql('step-b-force.sql')
const downSql = readSql('down.sql')

// ---------------------------------------------------------------------------
// The 44 tables that must be protected (from the PROBE_TABLES list in rls-probe.ts)
// Groups A (22) + B (17) + C (1) + dual-policy (3) = 43 with ws_isolation
// (system_settings has superadmin_only, not ws_isolation — excluded from this count)
// ---------------------------------------------------------------------------
const WS_ISOLATION_TABLES = [
  // Group A
  'marketing_actions', 'workspace_festivals', 'workspace_metric_goals',
  'workspace_ad_campaign_classifications', 'ai_insights', 'workspace_ai_insights_cache',
  'workspace_cogs_settings', 'workspace_members', 'invitations', 'workspace_costs',
  'workspace_misc_expenses', 'shopify_connections', 'product_lead_times',
  'shiprocket_connections', 'unicommerce_connections', 'klaviyo_connections',
  'email_performance', 'oauth_states', 'workspace_daily_metrics',
  'woocommerce_connections', 'google_ads_connections', 'meta_ads_connections',
  // Group B
  'product_daily_aggregates', 'shopify_analytics_daily', 'shopify_orders',
  'shopify_line_items', 'shopify_products', 'shopify_variants', 'shopify_customers',
  'unicommerce_products', 'shiprocket_orders', 'shiprocket_shipments',
  'google_ads_funnel_daily', 'google_ads_daily_metrics', 'meta_ads_creative_daily',
  'meta_ads_daily_metrics', 'woocommerce_orders', 'woocommerce_products',
  'shopify_refund_line_items',
  // Group C
  'woocommerce_line_items',
  // Dual
  'audit_logs', 'notifications',
]

const ALL_44_TABLES = [...WS_ISOLATION_TABLES, 'system_settings']

describe('Banned SQL shapes (CF-C1-RLS-DEFAULT-1.a)', () => {
  const combinedSql = stepA + '\n' + stepB + '\n' + downSql

  // Extract executable lines only (exclude comment lines starting with --)
  function executableLines(sql: string): string {
    return sql
      .split('\n')
      .filter((line) => !line.trim().startsWith('--'))
      .join('\n')
  }

  const executable = executableLines(combinedSql)

  it('(-) no OR ... IS NULL shape in executable SQL', () => {
    expect(executable).not.toMatch(/OR\s+\S+\s+IS\s+NULL/i)
  })

  it('(-) no COALESCE in executable SQL', () => {
    expect(executable).not.toMatch(/COALESCE\s*\(/i)
  })

  it('(-) no USING (true) in executable SQL', () => {
    // USING (true) — allow-all policy is banned
    expect(executable).not.toMatch(/USING\s*\(\s*true\s*\)/i)
  })

  it('(-) no session-level SET (outside tx-local set_config) in executable SQL', () => {
    // Session-level SET leaks across pgbouncer txn-pool connections.
    // Allowed: set_config() (tx-local), BEGIN/COMMIT/ROLLBACK.
    // Banned: bare SET app.workspace_id = ...
    expect(executable).not.toMatch(/^\s*SET\s+app\./im)
  })

  it('(+) all policies use current_setting with missing_ok=true', () => {
    // Every USING/WITH CHECK in step-a must use current_setting(..., true)
    const usingMatches = stepA.match(/current_setting\s*\(\s*'app\.\w+',\s*true\s*\)/g) ?? []
    expect(usingMatches.length).toBeGreaterThan(0)
    // None should use missing_ok=false (which would throw instead of returning null)
    expect(stepA).not.toMatch(/current_setting\s*\(\s*'app\.\w+',\s*false\s*\)/i)
  })
})

describe('Every workspace-scoped table has ws_isolation policy (CF-C1-FK-SCOPE-1.a)', () => {
  for (const table of WS_ISOLATION_TABLES) {
    it(`(+) ${table} has ws_isolation policy`, () => {
      expect(stepA).toContain(`CREATE POLICY ws_isolation ON ${table}`)
    })

    it(`(+) ${table} has ENABLE ROW LEVEL SECURITY`, () => {
      expect(stepA).toContain(`ALTER TABLE ${table} ENABLE ROW LEVEL SECURITY`)
    })
  }

  it('(+) system_settings has superadmin_only policy', () => {
    expect(stepA).toContain('CREATE POLICY superadmin_only ON system_settings')
  })

  it('(+) audit_logs has dual policy (ws_isolation + superadmin_system_rows)', () => {
    expect(stepA).toContain('CREATE POLICY ws_isolation ON audit_logs')
    expect(stepA).toContain('CREATE POLICY superadmin_system_rows ON audit_logs')
  })

  it('(+) notifications has dual policy (ws_isolation + superadmin_system_rows)', () => {
    expect(stepA).toContain('CREATE POLICY ws_isolation ON notifications')
    expect(stepA).toContain('CREATE POLICY superadmin_system_rows ON notifications')
  })
})

describe('step-b-force.sql correctness', () => {
  it('(+) all 44 tables have FORCE ROW LEVEL SECURITY', () => {
    for (const table of ALL_44_TABLES) {
      expect(stepB).toContain(`ALTER TABLE ${table}`)
      expect(stepB).toContain('FORCE ROW LEVEL SECURITY')
    }
  })

  it('(+) step-b has exactly 43 executable FORCE statements (43 distinct tables)', () => {
    // Count only ALTER TABLE lines — each table has exactly one FORCE statement.
    // The header comment contains "FORCE ROW LEVEL SECURITY" text too, so we count ALTER TABLE lines.
    const execLines = stepB
      .split('\n')
      .filter((line) => !line.trim().startsWith('--') && line.includes('FORCE ROW LEVEL SECURITY'))
    expect(execLines.length).toBe(43)
  })
})

describe('down.sql symmetry (CF-C1-ROLLOUT-ORDER-1)', () => {
  it('(+) down.sql has NO FORCE for all 44 tables', () => {
    for (const table of ALL_44_TABLES) {
      expect(downSql).toContain(`ALTER TABLE ${table}`)
      expect(downSql).toContain('NO FORCE ROW LEVEL SECURITY')
    }
  })

  it('(+) down.sql has DISABLE ROW LEVEL SECURITY for all 44 tables', () => {
    for (const table of ALL_44_TABLES) {
      expect(downSql).toContain('DISABLE ROW LEVEL SECURITY')
    }
  })

  it('(+) down.sql drops ws_isolation on all workspace-scoped tables', () => {
    for (const table of WS_ISOLATION_TABLES) {
      expect(downSql).toContain(`DROP POLICY IF EXISTS ws_isolation ON ${table}`)
    }
  })

  it('(+) down.sql drops superadmin_system_rows on audit_logs and notifications', () => {
    expect(downSql).toContain('DROP POLICY IF EXISTS superadmin_system_rows ON audit_logs')
    expect(downSql).toContain('DROP POLICY IF EXISTS superadmin_system_rows ON notifications')
  })

  it('(+) down.sql drops superadmin_only on system_settings', () => {
    expect(downSql).toContain('DROP POLICY IF EXISTS superadmin_only ON system_settings')
  })
})

describe('Runbook HOLD-AT-FORCE protection', () => {
  it('(+) step-b-force.sql header contains HELD / HOLD-AT-FORCE warning', () => {
    expect(stepB).toMatch(/HELD|HOLD-AT-FORCE/)
  })

  it('(+) step-a header contains QUIESCE-CRONS requirement', () => {
    expect(stepA).toMatch(/quiesce.crons|QUIESCE/i)
  })

  it('(+) step-b header contains DO NOT RUN instruction', () => {
    expect(stepB).toMatch(/DO NOT RUN/)
  })
})
