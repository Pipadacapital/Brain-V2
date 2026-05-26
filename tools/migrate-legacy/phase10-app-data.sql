-- =============================================================================
-- Phase 10 — App-data ETL: notifications / ai_insights / marketing_actions →
-- local Postgres `brain_dev`. Closes the data-migration loop after Phases 7+8+9
-- (workspace_config, CH backfill, customer_pii).
--
-- Source (FDW): legacy_supa → public.{notifications, ai_insights, marketing_actions}.
-- Target: local public.{notifications, ai_insights, marketing_actions}.
--
-- Plan: docs/data-architecture-plan-v2.md §5 (app-data ETL, the small tail).
--
-- Apply via:
--   docker cp tools/migrate-legacy/phase10-app-data.sql brain-postgres-dev:/tmp/
--   docker exec brain-postgres-dev psql -U postgres -d brain_dev -f /tmp/phase10-app-data.sql
--
-- Idempotent: ON CONFLICT (id) DO NOTHING on each target.
-- Tenant-safe: every row carries workspace_id; RLS policies on each target table
--              stay enforced (this script runs as `postgres` superuser, which the
--              FDW credentials require, but the *rows* are workspace-scoped so
--              normal `rls_app` reads come back tenant-filtered).
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Foreign tables — declare them explicitly (IMPORT FOREIGN SCHEMA fails on the
-- legacy `NotificationType` enum that doesn't exist locally; we cast to text
-- here and let the local enum coerce on INSERT).
-- ---------------------------------------------------------------------------
DROP FOREIGN TABLE IF EXISTS legacy_src.notifications_src;
CREATE FOREIGN TABLE legacy_src.notifications_src (
  id           uuid          NOT NULL,
  user_id      uuid          NOT NULL,
  workspace_id uuid,
  type         text          NOT NULL,
  title        text          NOT NULL,
  body         text,
  action_url   text,
  read         boolean       NOT NULL,
  metadata     jsonb,
  created_at   timestamp     NOT NULL,
  read_at      timestamp
) SERVER legacy_supa OPTIONS (schema_name 'public', table_name 'notifications');

DROP FOREIGN TABLE IF EXISTS legacy_src.ai_insights_src;
CREATE FOREIGN TABLE legacy_src.ai_insights_src (
  id           uuid          NOT NULL,
  workspace_id uuid          NOT NULL,
  page         varchar       NOT NULL,
  date_from    timestamp     NOT NULL,
  date_to      timestamp     NOT NULL,
  filters_hash varchar       NOT NULL,
  content      text          NOT NULL,
  provider     varchar       NOT NULL,
  model        varchar       NOT NULL,
  tokens_used  integer       NOT NULL,
  latency_ms   integer       NOT NULL,
  metadata     jsonb,
  created_at   timestamp     NOT NULL,
  expires_at   timestamp     NOT NULL,
  status       varchar       NOT NULL
) SERVER legacy_supa OPTIONS (schema_name 'public', table_name 'ai_insights');

DROP FOREIGN TABLE IF EXISTS legacy_src.marketing_actions_src;
CREATE FOREIGN TABLE legacy_src.marketing_actions_src (
  id           uuid          NOT NULL,
  workspace_id uuid          NOT NULL,
  action_date  date          NOT NULL,
  action_type  varchar       NOT NULL,
  action_name  varchar       NOT NULL,
  notes        text,
  created_by   uuid,
  created_at   timestamp     NOT NULL,
  updated_at   timestamp     NOT NULL
) SERVER legacy_supa OPTIONS (schema_name 'public', table_name 'marketing_actions');

-- ---------------------------------------------------------------------------
-- 1) notifications (118 rows)
-- Workspace_id can be NULL on legacy for system-wide notifications. Local table
-- supports nullable workspace_id (RLS treats null as "global" — superuser only).
-- ---------------------------------------------------------------------------
INSERT INTO public.notifications
  (id, user_id, workspace_id, type, title, body, action_url, read, metadata, created_at, read_at)
SELECT id, user_id, workspace_id, type::notification_type, title, body, action_url,
       read, COALESCE(metadata, '{}'::jsonb), created_at, read_at
  FROM legacy_src.notifications_src
 WHERE
   -- Filter out rows pointing at users we did NOT migrate (referential integrity)
   user_id IN (SELECT id FROM public.users)
ON CONFLICT (id) DO NOTHING;

-- ---------------------------------------------------------------------------
-- 2) ai_insights (8 rows) — cached LLM responses per (page, workspace, filter).
-- expires_at is honoured: rows past expiry on legacy are still copied (a cache
-- miss locally will refresh).
-- ---------------------------------------------------------------------------
INSERT INTO public.ai_insights
  (id, workspace_id, page, date_from, date_to, filters_hash, status, content,
   provider, model, tokens_used, latency_ms, metadata, created_at, expires_at)
SELECT id, workspace_id, page, date_from, date_to, filters_hash, status, content,
       provider, model, tokens_used, latency_ms, COALESCE(metadata, '{}'::jsonb),
       created_at, expires_at
  FROM legacy_src.ai_insights_src
 WHERE workspace_id IN (SELECT id FROM public.workspaces)
ON CONFLICT (id) DO NOTHING;

-- ---------------------------------------------------------------------------
-- 3) marketing_actions (2 rows) — manual marketing events the brand logs.
-- created_by may reference a user that wasn't migrated; in that case we set NULL.
-- ---------------------------------------------------------------------------
INSERT INTO public.marketing_actions
  (id, workspace_id, action_date, action_type, action_name, notes, created_by,
   created_at, updated_at)
SELECT id, workspace_id, action_date, action_type, action_name, notes,
       CASE WHEN created_by IN (SELECT id FROM public.users) THEN created_by ELSE NULL END,
       created_at, updated_at
  FROM legacy_src.marketing_actions_src
 WHERE workspace_id IN (SELECT id FROM public.workspaces)
ON CONFLICT (id) DO NOTHING;

-- ---------------------------------------------------------------------------
-- Verification
-- ---------------------------------------------------------------------------
SELECT 'notifications'     AS tbl, count(*) FROM public.notifications
UNION ALL
SELECT 'ai_insights',         count(*) FROM public.ai_insights
UNION ALL
SELECT 'marketing_actions',   count(*) FROM public.marketing_actions
ORDER BY 1;

-- Cleanup foreign tables (they were one-shot for ETL)
DROP FOREIGN TABLE IF EXISTS legacy_src.notifications_src;
DROP FOREIGN TABLE IF EXISTS legacy_src.ai_insights_src;
DROP FOREIGN TABLE IF EXISTS legacy_src.marketing_actions_src;
DROP FOREIGN TABLE IF EXISTS legacy_src.remote_cols;
DROP FOREIGN TABLE IF EXISTS legacy_src.remote_tables;
DROP FOREIGN TABLE IF EXISTS legacy_src._scan;
