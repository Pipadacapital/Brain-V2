-- =============================================================================
-- 36 — Identity hashes + cluster registry (P1-C, R10, ADR #4)
--
-- WHY: today customer_pii.customer_ref is bare sha256(vendor_customer_id) with no
-- per-workspace salt (acl.ts:175), so the same Shopify customer at two brands
-- produces the SAME hash — a cross-workspace inference breach (G4/G6).
--
-- This migration:
--   1. Adds email_hash / phone_hash (HMAC-SHA256, per-workspace salt, salt_version)
--      to customer_pii for deterministic cross-vendor identity matching.
--   2. Adds identity_cluster_id to customer_pii (FK to identity_cluster_registry).
--   3. Creates identity_cluster_registry — maps a stable opaque UUID per connected
--      component (older-cluster-wins on merge; the min_label is internal, never
--      exposed downstream).
--   4. Creates identity_cluster_edges — undirected graph edges per workspace
--      (one edge per co-observation of strong identifiers in one event).
--   5. Creates workspace_identity_salt — per-workspace versioned HMAC salt.
--      Salt is append-only (never in-place rotation); historical hashes reference
--      their salt_version and remain stable across a rotation.
--
-- DPDP relevance: per-workspace salt prevents cross-workspace linkage and
-- brute-force re-identification of low-entropy phone numbers (R10.1).
--
-- Migration safety: all columns are additive + nullable-safe. Tables are new.
-- Reversible via 36-down-identity-hashes.sql.
--
-- Apply order: after 35-silver-raw-event-id.sql. Run as postgres superuser.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. workspace_identity_salt — per-workspace versioned HMAC salt
-- ---------------------------------------------------------------------------
-- The salt material itself is stored in KMS/Secrets Manager (infra/P1-D).
-- This table tracks which version is active and when each was created, so
-- historical hashes remain resolvable after a rotation.
CREATE TABLE IF NOT EXISTS workspace_identity_salt (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id      UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  salt_version      TEXT NOT NULL,                  -- e.g. 'v1', 'v2' (monotonic, never reused)
  -- The actual salt bytes are stored encrypted in KMS/Secrets Manager.
  -- This column holds the Secrets Manager secret key path for local-dev fallback.
  -- LOCAL DEV ONLY: the raw 32-byte salt (base64) lives here when
  -- CONNECTOR_CUSTODY_BACKING != 'production'. In production, this column is
  -- empty and the KMS vault is the canonical store.
  salt_enc          BYTEA,                          -- AES-256-GCM encrypted salt (local dev)
  is_active         BOOLEAN NOT NULL DEFAULT true,  -- only one active version per workspace
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  deactivated_at    TIMESTAMPTZ,

  UNIQUE (workspace_id, salt_version)
);

CREATE INDEX IF NOT EXISTS wis_workspace_active_idx
  ON workspace_identity_salt (workspace_id, is_active)
  WHERE is_active = true;

-- Only one active version per workspace.
CREATE UNIQUE INDEX IF NOT EXISTS wis_workspace_one_active_idx
  ON workspace_identity_salt (workspace_id)
  WHERE is_active = true;

GRANT SELECT, INSERT, UPDATE ON workspace_identity_salt TO rls_app;

-- ---------------------------------------------------------------------------
-- 2. identity_cluster_registry — stable surrogate UUIDs for connected components
-- ---------------------------------------------------------------------------
-- A component is identified by its MIN-label (the smallest customer_ref node-id
-- in the connected component). The min_label NEVER leaves this table; downstream
-- consumers see only cluster_id (stable opaque UUID).
--
-- Merge rule: when two clusters merge, the older cluster_id wins (the absorbed
-- cluster's facts are re-stamped to the survivor). older = smaller created_at.
CREATE TABLE IF NOT EXISTS identity_cluster_registry (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id      UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,

  -- Internal: the MIN customer_ref node-id in this component. Never exposed.
  min_label         TEXT NOT NULL,

  -- Stable surrogate UUID downstream consumers use. Never changes after creation.
  -- On merge: the absorbed cluster's cluster_id is redirected to the survivor's.
  cluster_id        UUID NOT NULL DEFAULT gen_random_uuid(),

  -- Cluster size (distinct customer_refs). Used for the k>=5 export guard.
  customer_count    INT NOT NULL DEFAULT 1,

  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),

  UNIQUE (workspace_id, min_label)
);

CREATE INDEX IF NOT EXISTS icr_workspace_cluster_idx
  ON identity_cluster_registry (workspace_id, cluster_id);

CREATE INDEX IF NOT EXISTS icr_workspace_min_label_idx
  ON identity_cluster_registry (workspace_id, min_label);

GRANT SELECT, INSERT, UPDATE ON identity_cluster_registry TO rls_app;

-- ---------------------------------------------------------------------------
-- 3. identity_cluster_edges — undirected edges per workspace
-- ---------------------------------------------------------------------------
-- One edge per co-observation of strong identifiers (email_hash or phone_hash)
-- in one event. Strong identifiers only — never shared/household IP/device.
-- Partitioned by workspace_id (logical; physical partitioning deferred to P2).
CREATE TABLE IF NOT EXISTS identity_cluster_edges (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id      UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,

  -- The two customer_ref nodes that co-occurred in one event.
  -- Stored normalized: node_a <= node_b (lexicographic) to deduplicate undirected edges.
  node_a            TEXT NOT NULL,
  node_b            TEXT NOT NULL,

  -- The hash type that triggered this edge ('email_hash' | 'phone_hash').
  match_key_type    TEXT NOT NULL CHECK (match_key_type IN ('email_hash', 'phone_hash', 'both')),

  -- Source bronze row that produced this edge.
  raw_event_id      TEXT,

  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- Dedup: one edge per (workspace, node_a, node_b) pair.
  UNIQUE (workspace_id, node_a, node_b),

  -- Invariant: node_a must be <= node_b (normalized edge direction).
  CONSTRAINT edge_normalized_order CHECK (node_a <= node_b)
);

CREATE INDEX IF NOT EXISTS ice_workspace_node_a_idx ON identity_cluster_edges (workspace_id, node_a);
CREATE INDEX IF NOT EXISTS ice_workspace_node_b_idx ON identity_cluster_edges (workspace_id, node_b);

GRANT SELECT, INSERT ON identity_cluster_edges TO rls_app;

-- ---------------------------------------------------------------------------
-- 4. Extend customer_pii with identity columns
-- ---------------------------------------------------------------------------
ALTER TABLE customer_pii
  ADD COLUMN IF NOT EXISTS email_hash        TEXT,       -- HMAC-SHA256(per-ws-salt, email_lower_trim)
  ADD COLUMN IF NOT EXISTS phone_hash        TEXT,       -- HMAC-SHA256(per-ws-salt, phone_e164)
  ADD COLUMN IF NOT EXISTS salt_version      TEXT,       -- which workspace_identity_salt version produced these hashes
  ADD COLUMN IF NOT EXISTS identity_cluster_id UUID;     -- FK to identity_cluster_registry.cluster_id (NOT a direct FK to allow deferred wiring)

CREATE INDEX IF NOT EXISTS customer_pii_email_hash_idx
  ON customer_pii (workspace_id, email_hash)
  WHERE email_hash IS NOT NULL;

CREATE INDEX IF NOT EXISTS customer_pii_phone_hash_idx
  ON customer_pii (workspace_id, phone_hash)
  WHERE phone_hash IS NOT NULL;

CREATE INDEX IF NOT EXISTS customer_pii_cluster_id_idx
  ON customer_pii (workspace_id, identity_cluster_id)
  WHERE identity_cluster_id IS NOT NULL;
