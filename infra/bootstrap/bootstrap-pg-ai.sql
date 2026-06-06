-- =============================================================================
-- Brain — PostgreSQL bootstrap: AI + Memory schema (OPTIONAL / pgvector-gated).
--
-- The Decision Log (ai.*) + Memory Layer (memory.brand_fingerprint, pgvector)
-- "moat" tables. Kept SEPARATE from bootstrap-pg.sql because memory.* requires
-- the `vector` extension, which the local dev Postgres image does NOT ship.
-- scripts/bootstrap-db.sh applies this ONLY when `vector` is available
-- (e.g. ap-south-1 Supabase). Idempotent (IF NOT EXISTS / DROP POLICY IF EXISTS).
--
-- Source of truth for the ai/memory schema (replaces the retired
-- apps/intelligence-service/migrations/postgres/up.sql).
-- =============================================================================

BEGIN;

-- ============================================================
-- SCHEMA creation
-- ============================================================
CREATE SCHEMA IF NOT EXISTS ai;
CREATE SCHEMA IF NOT EXISTS memory;

-- ============================================================
-- ENABLE pgvector for memory.brand_fingerprint
-- ============================================================
CREATE EXTENSION IF NOT EXISTS vector;

-- ============================================================
-- ai.decision_log — append-only audit trail for all AI decisions.
-- CF-C5-DECISION-LOG-1: every recommendation + every write-tool writes here.
-- CF-C5-INJECTION-TYPED-REC-6: recommendation_jsonb carries a typed struct,
--   never free-text instructions.
-- Idempotency: (workspace_id, agent_id, input_hash) upsert on conflict.
-- ============================================================
CREATE TABLE IF NOT EXISTS ai.decision_log (
    id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id        TEXT        NOT NULL,
    agent_id            TEXT        NOT NULL,
    type                TEXT        NOT NULL CHECK (type IN ('insight','recommendation','write_tool','dropped_scope','dropped_graduation')),
    page                TEXT,
    date_from           DATE,
    date_to             DATE,
    input_hash          TEXT        NOT NULL,   -- sha256(system_template + signal_ids)[:16]
    output_jsonb        JSONB,                  -- full narration + signals snapshot
    recommendation_jsonb JSONB,                 -- {action: enum, entity_id, rationale} — render-only
    model_used          TEXT,
    paradigm            TEXT,
    tokens_input        INTEGER     DEFAULT 0,
    tokens_output       INTEGER     DEFAULT 0,
    latency_ms          INTEGER     DEFAULT 0,
    faithfulness_ok     BOOLEAN     DEFAULT TRUE,
    filters_hash        TEXT,
    cost_mu             BIGINT      DEFAULT 0,  -- BIGINT minor-units (paise), NEVER float
    -- Correlation quad (CF-SEC-5 / C5-SEC-003):
    --   request_id + trace_id + workspace_id + actor_id tie every row back to
    --   the originating HTTP request, OTel trace, tenant, and user/scheduler.
    --   Pinned contract: Maya populates these via GatewayRequest fields.
    request_id          TEXT        NOT NULL DEFAULT '',
    trace_id            TEXT        NOT NULL DEFAULT '',
    actor_id            TEXT        NOT NULL DEFAULT 'system',
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Append-only constraint: no UPDATE allowed on decision_log (enforced via trigger).
CREATE OR REPLACE FUNCTION ai.decision_log_no_update()
RETURNS TRIGGER AS $$
BEGIN
    RAISE EXCEPTION 'ai.decision_log is append-only: updates are not permitted. CF-C5-DECISION-LOG-1.';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_decision_log_no_update ON ai.decision_log;
CREATE TRIGGER trg_decision_log_no_update
    BEFORE UPDATE ON ai.decision_log
    FOR EACH ROW EXECUTE FUNCTION ai.decision_log_no_update();

-- Indexes for §5 performance requirements.
CREATE INDEX IF NOT EXISTS idx_decision_log_workspace_created
    ON ai.decision_log (workspace_id, created_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS idx_decision_log_idempotency
    ON ai.decision_log (workspace_id, agent_id, input_hash);

-- ============================================================
-- ai.graduation — per-agent graduation status (Gate 4).
-- CF-C5-INJECTION-GRADUATION-5: only GRADUATED agents may reach the executor.
-- ============================================================
CREATE TABLE IF NOT EXISTS ai.graduation (
    id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id    TEXT        NOT NULL,
    agent_id        TEXT        NOT NULL,
    tool            TEXT        NOT NULL,
    status          TEXT        NOT NULL DEFAULT 'PENDING'
                                CHECK (status IN ('PENDING', 'GRADUATED')),
    graduated_by    TEXT,                  -- user_id who graduated this
    graduated_at    TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT graduation_unique UNIQUE (workspace_id, agent_id, tool)
);

CREATE INDEX IF NOT EXISTS idx_graduation_workspace_agent
    ON ai.graduation (workspace_id, agent_id);

-- ============================================================
-- ai.workspace_action_cap — server-side magnitude caps (Gate 3).
-- CF-C5-INJECTION-EXECUTOR-2: magnitude sourced here at execution time.
-- Money: BIGINT minor-units — NEVER float/NUMERIC.
-- ============================================================
CREATE TABLE IF NOT EXISTS ai.workspace_action_cap (
    id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id        TEXT        NOT NULL,
    tool                TEXT        NOT NULL,
    per_call_max_mu     BIGINT      NOT NULL DEFAULT 0,    -- max per single call, paise
    per_day_max_mu      BIGINT      NOT NULL DEFAULT 0,    -- max aggregate per day, paise
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT action_cap_unique UNIQUE (workspace_id, tool)
);

CREATE INDEX IF NOT EXISTS idx_action_cap_workspace
    ON ai.workspace_action_cap (workspace_id);

-- ============================================================
-- ai.insight_cache — deterministic filtersHash cache.
-- CF-C5-CACHE-STRATEGY-1: filtersHash key PRESERVED from legacy formula.
-- CF-C5-CACHE-PURGE-1: CACHE-PURGE-C4C5 deletes rows for a workspace
--   before live serving flip.
-- ============================================================
CREATE TABLE IF NOT EXISTS ai.insight_cache (
    id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id    TEXT        NOT NULL,
    filters_hash    TEXT        NOT NULL,  -- sha256(workspaceId,page,dateFrom,dateTo,filters)
    page            TEXT        NOT NULL,
    date_from       DATE,
    date_to         DATE,
    content_jsonb   JSONB       NOT NULL,
    decision_log_id UUID        REFERENCES ai.decision_log(id),
    expires_at      TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '6 hours'),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT insight_cache_unique UNIQUE (workspace_id, filters_hash)
);

CREATE INDEX IF NOT EXISTS idx_insight_cache_workspace_hash
    ON ai.insight_cache (workspace_id, filters_hash);

CREATE INDEX IF NOT EXISTS idx_insight_cache_expires
    ON ai.insight_cache (workspace_id, expires_at);

-- ============================================================
-- ai.cross_brand_pattern — anonymized cross-brand cohort aggregates.
-- CF-C5-MEMORY-1 / C5-SEC-001: k-anonymity enforced at storage.
-- Populated by a SECURITY DEFINER aggregate job — NOT read through
-- brand_fingerprint RLS.  No workspace_id, no per-brand row.
-- brand_count CHECK (brand_count >= 5) is the storage-layer k-guarantee.
-- ============================================================
CREATE TABLE IF NOT EXISTS ai.cross_brand_pattern (
    id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    cohort_label        TEXT        NOT NULL,   -- e.g. "fashion_india_mid"
    brand_count         INTEGER     NOT NULL CHECK (brand_count >= 5),
    -- Cohort-level statistics only (medians / percentiles). No per-brand row.
    cm2_pct_bp_p50      INTEGER,    -- cohort median CM2% in basis points
    cm3_pct_bp_p50      INTEGER,    -- cohort median CM3% in basis points
    rto_rate_bp_p50     INTEGER,    -- cohort median RTO% in basis points
    computed_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT cross_brand_pattern_cohort_ts UNIQUE (cohort_label, computed_at)
);

CREATE INDEX IF NOT EXISTS idx_cross_brand_pattern_cohort_label
    ON ai.cross_brand_pattern (cohort_label, computed_at DESC);

-- NOTE: ai.cross_brand_pattern is intentionally NOT RLS-scoped.
-- It contains NO workspace_id and NO per-brand row — it is a cohort aggregate.
-- Access is controlled at the application layer (query_cross_brand_cohort()).
-- The absence of RLS here is INTENTIONAL and documented.  The k-anonymity
-- guarantee is the CHECK constraint (brand_count >= 5), not workspace isolation.

-- ============================================================
-- memory.brand_fingerprint — pgvector Brand Fingerprint (Memory-Layer).
-- CF-C5-MEMORY-1: 16-dim, read-only, workspace-scoped.
-- ============================================================
CREATE TABLE IF NOT EXISTS memory.brand_fingerprint (
    id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id    TEXT        NOT NULL UNIQUE,
    embedding       VECTOR(16)  NOT NULL,  -- 16-dim brand fingerprint
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- HNSW index for k-NN queries (CF-C5-MEMORY-1: k>=5).
-- Opclass = vector_cosine_ops: brand-fingerprint similarity is a function of
-- direction (relative profile), not magnitude, so cosine is the correct metric.
-- This is the SINGLE canonical pgvector index definition repo-wide (conformance
-- check C14a enforces no second, distance-metric-divergent definition exists).
CREATE INDEX IF NOT EXISTS idx_brand_fingerprint_hnsw
    ON memory.brand_fingerprint
    USING hnsw (embedding vector_cosine_ops)
    WITH (m = 16, ef_construction = 64);

-- ============================================================
-- ROW-LEVEL SECURITY — fail-closed (Child-1 pattern, CF-C5-RESIDENCY-1)
-- ============================================================

-- ai.decision_log
ALTER TABLE ai.decision_log ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS rls_decision_log ON ai.decision_log;
CREATE POLICY rls_decision_log ON ai.decision_log
    USING (workspace_id = current_setting('app.workspace_id', TRUE)::TEXT);

-- ai.graduation
ALTER TABLE ai.graduation ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS rls_graduation ON ai.graduation;
CREATE POLICY rls_graduation ON ai.graduation
    USING (workspace_id = current_setting('app.workspace_id', TRUE)::TEXT);

-- ai.workspace_action_cap
ALTER TABLE ai.workspace_action_cap ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS rls_workspace_action_cap ON ai.workspace_action_cap;
CREATE POLICY rls_workspace_action_cap ON ai.workspace_action_cap
    USING (workspace_id = current_setting('app.workspace_id', TRUE)::TEXT);

-- ai.insight_cache
ALTER TABLE ai.insight_cache ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS rls_insight_cache ON ai.insight_cache;
CREATE POLICY rls_insight_cache ON ai.insight_cache
    USING (workspace_id = current_setting('app.workspace_id', TRUE)::TEXT);

-- memory.brand_fingerprint
ALTER TABLE memory.brand_fingerprint ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS rls_brand_fingerprint ON memory.brand_fingerprint;
CREATE POLICY rls_brand_fingerprint ON memory.brand_fingerprint
    USING (workspace_id = current_setting('app.workspace_id', TRUE)::TEXT);

-- ============================================================
-- A4a — grant svc_intelligence its owned tables (ai.* + memory.*).
-- One-writer-per-store: intelligence-service owns ai/memory; svc_intelligence has
-- USAGE on ai+memory ONLY (no public USAGE — it cannot resolve core tables).
-- NON-BYPASSRLS → rows stay workspace-scoped. (Role created by core-service
-- initdb 02-create-service-roles.sql locally / the A4b live ceremony.)
-- DO-block guards in case the role is not yet provisioned in a given environment.
-- ============================================================
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'svc_intelligence') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON
      ai.decision_log, ai.graduation, ai.workspace_action_cap, ai.insight_cache,
      ai.cross_brand_pattern, memory.brand_fingerprint
    TO svc_intelligence;
  END IF;
END $$;

COMMIT;
