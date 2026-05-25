-- =============================================================================
-- LOCAL-DEV Brain-native schema — onboarding/membership core tables.
--
-- Slice C (feat-onboarding-membership-db). Founder-binding decision (2026-05-25):
--   onboarding/membership data persists in a LOCAL Postgres (docker, dev-only)
--   with the Brain-native RLS schema — NOT the live shared Supabase production DB.
--   Auth still uses real Supabase for IDENTITY only (slice A). The live/legacy
--   production DB (the zero-RLS P0) is left untouched.
--
-- This file CREATES the four Brain-native tables (users, workspaces,
-- workspace_members, invitations) in a clean local Postgres, mirroring the
-- legacy Prisma models (User/Workspace/WorkspaceMember/Invitation) and the
-- Brain 5-role WorkspaceRole enum (OWNER/ADMIN/MANAGER/ANALYST/VIEWER).
--
-- WHY a separate CREATE-TABLE file (vs Child-1's manual/rls/*.sql)?
--   Child-1's RLS DDL is `ALTER TABLE ... ENABLE/FORCE RLS` against the EXISTING
--   live/legacy table schema (those tables already exist there). The local dev DB
--   is empty, so slice C must first CREATE the tables, then apply the SAME
--   fail-closed RLS shape Child-1 codified. The policy shape here is byte-identical
--   to Child-1's ws_isolation pattern (CF-C1-RLS-DEFAULT-1.a).
--
-- RLS posture (matches Child-1 — CF-C1-RLS-DEFAULT-1.a, fail-closed):
--   * workspace_members + invitations carry a workspace_id column → ws_isolation
--     policy: (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid)
--     The NULLIF(...,'') converts the empty-GUC state to NULL so a context-less
--     connection returns 0 rows (fail-closed) instead of a UUID cast error — the
--     same shape proven in pool-isolation.test.ts.
--   * workspaces: scoped by its own id = app.workspace_id (a workspace row is only
--     visible inside its own context). Onboarding (creating a brand-new workspace)
--     runs under withSuperadmin (the sanctioned no-context write path) since the
--     row does not exist yet to set context on.
--   * users: NO workspace_id (a user can belong to many workspaces). Users are
--     read/written under withSuperadmin (system path) keyed by user_id = the
--     verified JWT sub. RLS is enabled with a superadmin-only policy so a bare
--     (context-less, non-superadmin) connection sees 0 rows — fail-closed.
--
-- BANNED shapes (same static gate as Child-1): OR ... IS NULL · COALESCE ·
--   USING (true) · session-level SET. None used here.
--
-- Apply order: this file → 02-enable-rls-onboarding.sql.
-- Run as the postgres superuser (DDL); the app connects as rls_app (non-BYPASSRLS).
-- =============================================================================

-- gen_random_uuid() lives in pgcrypto on older PG; PG16 has it built-in, but
-- create the extension defensively for portability.
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ---------------------------------------------------------------------------
-- Enums — mirror the Brain-native enums (legacy schema.prisma is already 5-role).
-- ---------------------------------------------------------------------------
DO $$ BEGIN
  CREATE TYPE workspace_role AS ENUM ('OWNER', 'ADMIN', 'MANAGER', 'ANALYST', 'VIEWER');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE system_role AS ENUM ('SUPERADMIN', 'USER');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE invitation_status AS ENUM ('PENDING', 'ACCEPTED', 'EXPIRED', 'REVOKED');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE store_platform AS ENUM ('SHOPIFY', 'WOOCOMMERCE');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ---------------------------------------------------------------------------
-- users — id = the verified Supabase JWT `sub`. Minimal PII (DPDP minimization):
-- email + full_name + job_role only. NEVER card/bank/Aadhaar. avatar_url is a URL.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS users (
  id          UUID PRIMARY KEY,                         -- = Supabase auth sub
  email       TEXT NOT NULL UNIQUE,
  full_name   TEXT,
  avatar_url  TEXT,
  job_role    TEXT,
  system_role system_role NOT NULL DEFAULT 'USER',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- workspaces — the tenant. Brand profile captured at onboarding.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS workspaces (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name            TEXT NOT NULL,
  slug            TEXT NOT NULL UNIQUE,
  industry        TEXT,
  monthly_revenue TEXT,
  store_url       TEXT,                                  -- handle only; live connect deferred (slice D)
  platform        store_platform NOT NULL DEFAULT 'SHOPIFY',
  created_by_id   UUID NOT NULL REFERENCES users(id),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- workspace_members — the (user, workspace) → role edge. workspace_id-leading.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS workspace_members (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  user_id      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role         workspace_role NOT NULL DEFAULT 'VIEWER',
  joined_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, workspace_id)
);
CREATE INDEX IF NOT EXISTS workspace_members_workspace_idx ON workspace_members (workspace_id);
CREATE INDEX IF NOT EXISTS workspace_members_user_idx ON workspace_members (user_id);

-- ---------------------------------------------------------------------------
-- invitations — pending workspace invites by email. workspace_id-leading.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS invitations (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id   UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  email          TEXT NOT NULL,
  role           workspace_role NOT NULL DEFAULT 'VIEWER',
  status         invitation_status NOT NULL DEFAULT 'PENDING',
  token          UUID NOT NULL UNIQUE DEFAULT gen_random_uuid(),
  invited_by_id  UUID NOT NULL REFERENCES users(id),
  expires_at     TIMESTAMPTZ NOT NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS invitations_workspace_idx ON invitations (workspace_id);
CREATE INDEX IF NOT EXISTS invitations_token_idx ON invitations (token);

-- ---------------------------------------------------------------------------
-- Grants — the app role (rls_app, non-BYPASSRLS) needs DML on these tables.
-- The docker role-init (01-create-rls-app-role.sql) sets ALTER DEFAULT PRIVILEGES,
-- but grant explicitly here too so the tables created above are immediately usable.
-- ---------------------------------------------------------------------------
GRANT SELECT, INSERT, UPDATE, DELETE ON users             TO rls_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON workspaces        TO rls_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON workspace_members TO rls_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON invitations       TO rls_app;
