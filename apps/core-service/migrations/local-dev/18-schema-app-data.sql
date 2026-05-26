-- =============================================================================
-- Phase 1 — D16..D19 app data: notifications, ai_insights, marketing_actions,
-- audit_log. Design: docs/data-architecture-plan.md §3.10.
-- =============================================================================

-- notification_type enum
DO $$ BEGIN
  CREATE TYPE notification_type AS ENUM (
    'WORKSPACE_INVITE','INVITE_ACCEPTED','MEMBER_JOINED','MEMBER_REMOVED','ROLE_CHANGED',
    'CONNECTOR_CONNECTED','CONNECTOR_DISCONNECTED','SYNC_COMPLETED','SYNC_FAILED','SYSTEM'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- D16 — notifications (workspace_id NULLABLE: system events have no ws scope).
-- RLS is the ONE sanctioned ws_or_user_isolation pattern (file 19) — exception documented.
CREATE TABLE IF NOT EXISTS notifications (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  workspace_id  UUID REFERENCES workspaces(id) ON DELETE CASCADE,
  type          notification_type NOT NULL,
  title         TEXT NOT NULL,
  body          TEXT,
  action_url    TEXT,
  read          BOOLEAN NOT NULL DEFAULT FALSE,
  metadata      JSONB,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  read_at       TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS notifications_user_idx ON notifications (user_id, read, created_at DESC);
CREATE INDEX IF NOT EXISTS notifications_ws_idx   ON notifications (workspace_id, created_at DESC);
GRANT SELECT, INSERT, UPDATE, DELETE ON notifications TO rls_app;

-- D17 — ai_insights (page-scoped narration cache; matches TECH/01 ai.insights shape)
CREATE TABLE IF NOT EXISTS ai_insights (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  page         TEXT NOT NULL,
  date_from    TIMESTAMPTZ NOT NULL,
  date_to      TIMESTAMPTZ NOT NULL,
  filters_hash TEXT NOT NULL,
  status       TEXT NOT NULL DEFAULT 'done',
  content      TEXT NOT NULL DEFAULT '',
  provider     TEXT NOT NULL DEFAULT '',
  model        TEXT NOT NULL DEFAULT '',
  tokens_used  INT NOT NULL DEFAULT 0,
  latency_ms   INT NOT NULL DEFAULT 0,
  metadata     JSONB,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at   TIMESTAMPTZ NOT NULL
);
CREATE INDEX IF NOT EXISTS ai_insights_ws_page_idx ON ai_insights (workspace_id, page, date_from, date_to);
CREATE INDEX IF NOT EXISTS ai_insights_expires_idx ON ai_insights (expires_at);
GRANT SELECT, INSERT, UPDATE, DELETE ON ai_insights TO rls_app;

-- D18 — marketing actions (operator-logged events affecting attribution)
CREATE TABLE IF NOT EXISTS marketing_actions (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  action_date  DATE NOT NULL,
  action_type  TEXT NOT NULL,
  action_name  TEXT NOT NULL,
  notes        TEXT,
  created_by   UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS marketing_actions_ws_date_idx ON marketing_actions (workspace_id, action_date);
GRANT SELECT, INSERT, UPDATE, DELETE ON marketing_actions TO rls_app;

-- D19 — audit_log (PII-free legal record; workspace_id nullable + NO cascade).
-- IP hashed (sha256) per TECH/16 §4.2. RLS = ws_or_user_isolation (file 19, documented).
CREATE TABLE IF NOT EXISTS audit_log (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID REFERENCES workspaces(id) ON DELETE SET NULL,  -- legal record outlives ws
  user_id      UUID NOT NULL REFERENCES users(id),
  action       TEXT NOT NULL,
  entity_type  TEXT NOT NULL,
  entity_id    TEXT,
  metadata     JSONB,
  ip_hash      TEXT,                                  -- sha256(ip), NEVER raw ip
  user_agent   TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS audit_log_ws_idx   ON audit_log (workspace_id, created_at DESC);
CREATE INDEX IF NOT EXISTS audit_log_user_idx ON audit_log (user_id, created_at DESC);
GRANT SELECT, INSERT, UPDATE, DELETE ON audit_log TO rls_app;
