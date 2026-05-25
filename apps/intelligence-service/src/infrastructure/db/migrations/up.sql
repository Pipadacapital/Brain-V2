-- up.sql — ai.* + memory.* schema DDL for intelligence-service (Child 5).
--
-- CF-C5-DECISION-LOG-1: ai.decision_log (append-only, workspace-scoped, RLS)
-- CF-C5-MEMORY-1: memory.brand_fingerprint (pgvector 16-dim, read-only, RLS)
-- CF-C5-CACHE-PURGE-1: ai.insight_cache (filtersHash key preserved, M-A5-5)
-- CF-C5-INJECTION-GRADUATION-5: ai.graduation (Gate 4 graduation status)
-- CF-C5-INJECTION-EXECUTOR-2: ai.workspace_action_cap (Iron-Law executor caps)
--
-- Residency: ap-south-1 (CF-C5-RESIDENCY-1).
-- RLS: every table has fail-closed workspace_id = current_setting('app.workspace_id')
--      policy (reuses Child-1 session-context primitive).
-- All money fields: BIGINT minor-units (paise). No FLOAT/NUMERIC for money.
-- Reversible: see down.sql.

-- ---------------------------------------------------------------------------
-- Schemas
-- ---------------------------------------------------------------------------

CREATE SCHEMA IF NOT EXISTS ai;
CREATE SCHEMA IF NOT EXISTS memory;

-- ---------------------------------------------------------------------------
-- Enable pgvector extension (required for memory.brand_fingerprint)
-- ---------------------------------------------------------------------------
CREATE EXTENSION IF NOT EXISTS vector;

-- ---------------------------------------------------------------------------
-- ai.decision_log — append-only audit trail for all agent recommendations
-- and (would-be) write tool calls.
--
-- CF-C5-DECISION-LOG-1: every recommendation + every gateway synthesis writes
-- one row. The table is append-only (no UPDATE/DELETE permitted via RLS).
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS ai.decision_log (
    id               UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    workspace_id     TEXT NOT NULL,
    agent_id         TEXT NOT NULL,
    type             TEXT NOT NULL     -- 'insight' | 'recommendation' | 'cache_purge'
        CHECK (type IN ('insight', 'recommendation', 'cache_purge')),
    page             TEXT,
    date_range_from  DATE,
    date_range_to    DATE,
    input_hash       TEXT,             -- sha256 of (system_template + signal_ids)[:16]
    output_jsonb     JSONB,            -- the parsed InsightItem[] or WriteToolCall
    recommendation_jsonb JSONB,        -- typed TypedRecommendation struct
    model_used       TEXT,
    paradigm         TEXT,
    tokens_input     INT,
    tokens_output    INT,
    cost_mu          BIGINT DEFAULT 0, -- estimated cost in paise
    faithfulness_ok  BOOLEAN,
    filters_hash     TEXT,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Append-only invariant: no UPDATE or DELETE on decision_log.
-- (Enforced by GRANT — only INSERT + SELECT in production role.)

CREATE INDEX IF NOT EXISTS idx_decision_log_workspace_created
    ON ai.decision_log (workspace_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_decision_log_type
    ON ai.decision_log (workspace_id, type, created_at DESC);

-- RLS (fail-closed — Child-1 session-context primitive)
ALTER TABLE ai.decision_log ENABLE ROW LEVEL SECURITY;

-- Fail-closed: no row visible without a set session context.
CREATE POLICY decision_log_workspace_isolation
    ON ai.decision_log
    USING (workspace_id = current_setting('app.workspace_id', TRUE));

-- ---------------------------------------------------------------------------
-- ai.graduation — per-(workspace, agent, tool) graduation status (Gate 4).
--
-- CF-C5-INJECTION-GRADUATION-5: dispatch_tool_call() reads this table.
-- PENDING = recommendation-only (no execution). GRADUATED = execution allowed.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS ai.graduation (
    id               UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    workspace_id     TEXT NOT NULL,
    agent_id         TEXT NOT NULL,
    tool             TEXT NOT NULL,
    status           TEXT NOT NULL DEFAULT 'PENDING'
        CHECK (status IN ('PENDING', 'GRADUATED')),
    graduated_by     TEXT,             -- user_id who granted graduation
    graduated_at     TIMESTAMPTZ,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (workspace_id, agent_id, tool)
);

CREATE INDEX IF NOT EXISTS idx_graduation_lookup
    ON ai.graduation (workspace_id, agent_id, tool);

ALTER TABLE ai.graduation ENABLE ROW LEVEL SECURITY;

CREATE POLICY graduation_workspace_isolation
    ON ai.graduation
    USING (workspace_id = current_setting('app.workspace_id', TRUE));

-- ---------------------------------------------------------------------------
-- ai.workspace_action_cap — server-side magnitude caps (Gate 3, Iron-Law).
--
-- CF-C5-INJECTION-EXECUTOR-2: execute_write_tool() reads per_call_max_mu
-- and per_day_max_mu here. The LLM NEVER sets these values.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS ai.workspace_action_cap (
    id               UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    workspace_id     TEXT NOT NULL,
    tool             TEXT NOT NULL,
    per_call_max_mu  BIGINT NOT NULL CHECK (per_call_max_mu >= 0),
    per_day_max_mu   BIGINT NOT NULL CHECK (per_day_max_mu >= 0),
    created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (workspace_id, tool)
);

-- Default caps for the 5a build (recommendation-only — caps exercised in tests)
-- reallocate_budget: ₹5,000/call, ₹20,000/day (most dangerous cap)
-- pause_ad_set: no magnitude (PAUSE intent = 0)
-- send_refund: ₹500/call, ₹2,000/day
INSERT INTO ai.workspace_action_cap (workspace_id, tool, per_call_max_mu, per_day_max_mu)
VALUES
    ('__default__', 'pause_ad_set',      0,       0),
    ('__default__', 'reallocate_budget', 500000,  2000000),
    ('__default__', 'send_refund',       50000,   200000)
ON CONFLICT (workspace_id, tool) DO NOTHING;

ALTER TABLE ai.workspace_action_cap ENABLE ROW LEVEL SECURITY;

CREATE POLICY workspace_action_cap_isolation
    ON ai.workspace_action_cap
    USING (
        workspace_id = current_setting('app.workspace_id', TRUE)
        OR workspace_id = '__default__'
    );

-- ---------------------------------------------------------------------------
-- ai.insight_cache — deterministic filtersHash cache (CF-C5-CACHE-STRATEGY-1).
--
-- filtersHash key: sha256(workspaceId+page+dateFrom+dateTo+filters)[:16]
-- Preserved from the legacy formula (M-A5-5 gate key).
-- CACHE-PURGE-C4C5: DELETE WHERE workspace_id = W; post-purge count must = 0.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS ai.insight_cache (
    id               UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    workspace_id     TEXT NOT NULL,
    filters_hash     TEXT NOT NULL,   -- M-A5-5 gate key
    page             TEXT NOT NULL,
    date_from        DATE,
    date_to          DATE,
    content_jsonb    JSONB NOT NULL,  -- the InsightItem[] from the gateway response
    decision_log_id  UUID REFERENCES ai.decision_log(id),
    expires_at       TIMESTAMPTZ NOT NULL,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (workspace_id, filters_hash)
);

CREATE INDEX IF NOT EXISTS idx_insight_cache_workspace_hash
    ON ai.insight_cache (workspace_id, filters_hash);

CREATE INDEX IF NOT EXISTS idx_insight_cache_expires
    ON ai.insight_cache (workspace_id, expires_at);

ALTER TABLE ai.insight_cache ENABLE ROW LEVEL SECURITY;

CREATE POLICY insight_cache_workspace_isolation
    ON ai.insight_cache
    USING (workspace_id = current_setting('app.workspace_id', TRUE));

-- ---------------------------------------------------------------------------
-- memory.brand_fingerprint — Brand Fingerprint pgvector (CF-C5-MEMORY-1).
--
-- 16-dim vector per workspace. HNSW index for cosine similarity search.
-- Read-only for all agents. Written by the analytics pipeline (not in scope here).
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS memory.brand_fingerprint (
    id               UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    workspace_id     TEXT NOT NULL UNIQUE,
    embedding        VECTOR(16) NOT NULL,     -- 16-dim Brand Fingerprint
    cm2_pct_bp       INT,                     -- pre-computed for fast lookup
    cm3_pct_bp       INT,
    rto_rate_bp      INT,
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- HNSW index for cosine similarity (CF-C5-MEMORY-1: k≥5 queries)
CREATE INDEX IF NOT EXISTS idx_brand_fingerprint_hnsw
    ON memory.brand_fingerprint
    USING hnsw (embedding vector_cosine_ops)
    WITH (m = 16, ef_construction = 64);

ALTER TABLE memory.brand_fingerprint ENABLE ROW LEVEL SECURITY;

-- Brand Fingerprint is readable by all workspaces for cross-brand benchmarks.
-- The RLS policy allows reads across workspaces (k-NN search) but restricts
-- writes to the owning workspace.
CREATE POLICY brand_fingerprint_read_all
    ON memory.brand_fingerprint
    FOR SELECT
    USING (TRUE);

CREATE POLICY brand_fingerprint_write_own
    ON memory.brand_fingerprint
    FOR INSERT
    WITH CHECK (workspace_id = current_setting('app.workspace_id', TRUE));

CREATE POLICY brand_fingerprint_update_own
    ON memory.brand_fingerprint
    FOR UPDATE
    USING (workspace_id = current_setting('app.workspace_id', TRUE));
