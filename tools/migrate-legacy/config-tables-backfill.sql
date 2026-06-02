-- Config-tables backfill (production-readiness): legacy workspace_costs /
-- misc_expenses / festivals / metric_goals / cogs_settings -> local brain_dev.
-- Money ×100 (₹->minor units); percent->bp (×100); festival multiplier->bp
-- (×10000); billing_mode upper-cased; filtered to existing local workspaces.
-- Requires FDW server legacy_supa + legacy_src foreign tables.

INSERT INTO workspace_cogs_settings (workspace_id, override_all_cogs_bp, fallback_cogs_bp, cogs_markup_bp, updated_at)
SELECT s.workspace_id, round(COALESCE(s.override_all_cogs_percent,0)*100)::int,
       round(COALESCE(s.fallback_cogs_percent,0)*100)::int, round(COALESCE(s.cogs_markup_percent,0)*100)::int, now()
FROM legacy_src.workspace_cogs_settings s JOIN workspaces w ON w.id=s.workspace_id
ON CONFLICT (workspace_id) DO UPDATE SET override_all_cogs_bp=EXCLUDED.override_all_cogs_bp,
       fallback_cogs_bp=EXCLUDED.fallback_cogs_bp, cogs_markup_bp=EXCLUDED.cogs_markup_bp;

INSERT INTO workspace_costs (workspace_id, cost_type, name, amount_mu, is_percent, currency_code, billing_mode, effective_from, effective_to, created_at)
SELECT c.workspace_id, c.cost_type::workspace_cost_type, c.name, round(COALESCE(c.amount,0)*100)::bigint,
       COALESCE(c.is_percent,false), COALESCE(NULLIF(c.currency,''),'INR'),
       upper(COALESCE(c.billing_mode,'monthly'))::workspace_cost_billing_mode, c.effective_from, c.effective_to, COALESCE(c.created_at,now())
FROM legacy_src.workspace_costs c JOIN workspaces w ON w.id=c.workspace_id;

INSERT INTO workspace_misc_expenses (workspace_id, name, amount_mu, currency_code, effective_start_date, created_at)
SELECT m.workspace_id, m.name, round(COALESCE(m.amount,0)*100)::bigint, COALESCE(NULLIF(m.currency,''),'INR'), m.effective_start_date, COALESCE(m.created_at,now())
FROM legacy_src.workspace_misc_expenses m JOIN workspaces w ON w.id=m.workspace_id;

INSERT INTO workspace_metric_goals (workspace_id, metric_name, period_type, period_start, goal_value, goal_unit, goal_type, created_at)
SELECT g.workspace_id, g.metric_name, g.period_type::goal_period_type, g.period_start,
       round(COALESCE(g.goal_value,0)*10000)::bigint, 'bp'::goal_unit, g.goal_type::goal_value_type, COALESCE(g.created_at,now())
FROM legacy_src.workspace_metric_goals g JOIN workspaces w ON w.id=g.workspace_id;

INSERT INTO workspace_festivals (workspace_id, name, start_date, end_date, color, expected_multiplier_bp, regions, categories, is_template, is_active, created_at, updated_at)
SELECT f.workspace_id, f.name, f.start_date::date, f.end_date::date, COALESCE(f.color,''),
       round(COALESCE(f.expected_multiplier,1)*10000)::int, COALESCE(f.regions,'{}'), COALESCE(f.categories,'{}'),
       COALESCE(f.is_template,false), COALESCE(f.is_active,true), COALESCE(f.created_at,now()), COALESCE(f.updated_at,now())
FROM legacy_src.workspace_festivals f JOIN workspaces w ON w.id=f.workspace_id;
