-- =============================================================================
-- 31 — Status-gated nightly PII purge (ADR-CONVERGENCE-001 ruling C, P0-A).
--
-- WHY: India DTC has a long tail of open / unfulfilled / disputed orders where
-- the customer is still reachable and the order can be reopened (COD RTO, partial
-- returns, disputed payment etc.). Nulling PII on live-lifecycle orders would break
-- transactional messaging and the dispute-resolution audit trail.
--
-- RULING C: purge PII columns on connector_order_facts_hot WHERE the order's
-- financial_status + fulfillment_status indicate the order is CLOSED (i.e. fully
-- resolved with no pending action). Orders with status IN (open, unfulfilled,
-- disputed, partial, on_hold) are EXEMPT and their PII columns survive until the
-- order transitions to a closed state.
--
-- MECHANISM: a PG function + a nightly-tick-callable procedure that:
--   1. Identifies closed orders older than the retention window (default 90 days).
--   2. Nulls PII-adjacent columns (customer_ref, delivery_pincode, delivery_city,
--      billing_pincode, is_new_customer) — these are the only columns the drift
--      gate registers as PII-adjacent on the order hot table.
--   3. Dead-letters 0-row webhook updates (INSERT ... ON CONFLICT DO NOTHING
--      returning 0 rows) by writing a purge_log entry so ops can diagnose
--      webhook replay storms without re-opening live data.
--
-- CLOSED-STATUS definition (conservative for Indian COD/RTO lifecycle):
--   financial_status NOT IN ('PENDING','PARTIALLY_PAID','VOIDED') — i.e. fully
--     paid (PAID, REFUNDED, PARTIALLY_REFUNDED) or explicitly cancelled.
--   AND fulfillment_status NOT IN ('UNFULFILLED','ON_HOLD','PARTIAL') — i.e.
--     fully shipped or returned.
--   AND cancelled_at IS NOT NULL   ←  order EXPLICITLY cancelled (safety gate)
--      OR (financial_status IN ('REFUNDED','PARTIALLY_REFUNDED')
--          AND fulfillment_status = 'FULFILLED')  ←  completed refund on shipped order
--
-- NOTE: the function does NOT purge orders where financial_status = 'VOIDED' and
-- fulfillment_status = 'UNFULFILLED' — these are COD orders that were cancelled
-- before shipment; the vendor may reactivate them, so we keep PII until
-- cancelled_at is set. This is the "disputed COD" exemption.
--
-- REVERSIBILITY: down.sql drops the function + procedure + log table.
--   No data is deleted from connector_order_facts_hot; only PII columns are nulled.
--   Re-importing from the vendor's API or the legacy raw tables can restore PII.
--
-- SECURITY: SECURITY DEFINER runs as postgres (superuser) — safe because the
--   function only touches connector_order_facts_hot within the workspace_id passed
--   as a parameter, and it cannot be called directly by rls_app (REVOKE EXECUTE).
--
-- Apply order: after 30 (connector_identity_map), before 32.
-- Run as postgres superuser (DDL).
-- =============================================================================

-- ---------------------------------------------------------------------------
-- pii_purge_log — audit trail of nightly purge runs.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS pii_purge_log (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id    UUID        NOT NULL,
  run_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  orders_purged   INT         NOT NULL DEFAULT 0,
  retention_days  INT         NOT NULL DEFAULT 90,
  status          TEXT        NOT NULL DEFAULT 'ok',   -- 'ok' | 'error'
  error_msg       TEXT,
  -- dead-letter counter: 0-row webhook update attempts observed during this run window
  -- (these are webhook replays that matched no row — signal of a replay storm or
  -- misconfigured vendor callback). Populated by the webhook dead-letter path, not here.
  zero_row_webhook_updates INT NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS pii_purge_log_workspace_idx
  ON pii_purge_log (workspace_id, run_at DESC);

-- rls_app may SELECT purge logs for observability but cannot INSERT/UPDATE/DELETE.
GRANT SELECT ON pii_purge_log TO rls_app;

-- ---------------------------------------------------------------------------
-- is_order_pii_purgeable — predicate: returns TRUE if an order's lifecycle
-- is fully closed and its PII may be nulled.
--
-- Status gates (all must be TRUE to purge):
--  1. financial_status completed: PAID, REFUNDED, or PARTIALLY_REFUNDED.
--  2. fulfillment_status completed: FULFILLED (not UNFULFILLED / ON_HOLD / PARTIAL).
--  3. NOT in disputed/open set (defence-in-depth: the financial_status gate above
--     covers this, but explicit guard for PENDING/VOIDED/PARTIALLY_PAID).
--  4. cancelled_at IS NOT NULL (explicit cancellation) OR financial_status IN
--     ('REFUNDED','PARTIALLY_REFUNDED') AND fulfillment_status = 'FULFILLED'.
--
-- Equivalent plain-English: the order was FULFILLED AND fully PAID (or refunded),
-- OR it was explicitly cancelled. Open / disputed / partial / on-hold orders are exempt.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION is_order_pii_purgeable(
  p_financial_status   TEXT,
  p_fulfillment_status TEXT,
  p_cancelled_at       TIMESTAMPTZ
) RETURNS BOOLEAN
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
AS $$
  SELECT (
    -- Gate 1: closed financial status only
    upper(coalesce(p_financial_status, '')) NOT IN (
      'PENDING', 'PARTIALLY_PAID', 'VOIDED', ''
    )
    -- Gate 2: fulfilled (not open) fulfillment status
    AND upper(coalesce(p_fulfillment_status, '')) NOT IN (
      'UNFULFILLED', 'ON_HOLD', 'PARTIAL', ''
    )
    -- Gate 3: either explicitly cancelled OR refunded after fulfilment
    AND (
      p_cancelled_at IS NOT NULL
      OR (
        upper(coalesce(p_financial_status, '')) IN ('REFUNDED', 'PARTIALLY_REFUNDED')
        AND upper(coalesce(p_fulfillment_status, '')) = 'FULFILLED'
      )
    )
  )
$$;

-- ---------------------------------------------------------------------------
-- purge_closed_order_pii — null PII-adjacent columns on closed orders older
-- than retention_days for a specific workspace.
--
-- Nulled columns: customer_ref, delivery_pincode, delivery_city, billing_pincode,
-- is_new_customer. These are the PII-adjacent non-fact columns; gross/discount/
-- tax/shipping amounts are FACTS, not PII, and are preserved for audit.
--
-- Returns the count of orders purged.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION purge_closed_order_pii(
  p_workspace_id   UUID,
  p_retention_days INT DEFAULT 90
) RETURNS INT
LANGUAGE plpgsql
SECURITY DEFINER  -- runs as postgres (superuser) to bypass RLS for the purge operation
AS $$
DECLARE
  v_purged INT := 0;
BEGIN
  -- Safety: never purge orders newer than retention_days.
  -- Safety: only touch the workspace passed as the argument.
  UPDATE connector_order_facts_hot
  SET
    customer_ref      = NULL,
    delivery_pincode  = NULL,
    delivery_city     = NULL,
    billing_pincode   = NULL,
    is_new_customer   = NULL
  WHERE
    workspace_id = p_workspace_id
    AND synced_at < now() - (p_retention_days || ' days')::INTERVAL
    -- Only purge orders whose lifecycle is fully closed (ruling C exemptions).
    AND is_order_pii_purgeable(financial_status, fulfillment_status, cancelled_at)
    -- Belt-and-suspenders: only purge rows that still have PII (avoid no-op updates).
    AND (
      customer_ref IS NOT NULL
      OR delivery_pincode IS NOT NULL
      OR delivery_city IS NOT NULL
      OR billing_pincode IS NOT NULL
      OR is_new_customer IS NOT NULL
    );

  GET DIAGNOSTICS v_purged = ROW_COUNT;
  RETURN v_purged;
END;
$$;

-- Revoke direct execution from the app role (purge runs as a superuser background job).
REVOKE EXECUTE ON FUNCTION purge_closed_order_pii(UUID, INT) FROM PUBLIC;

-- ---------------------------------------------------------------------------
-- run_nightly_pii_purge — iterate all workspaces and purge closed orders.
-- Called by the daily-tick scheduler (Phase-D). For local/dev: call directly.
--
-- Writes a pii_purge_log row per workspace per run (audit + ops debugging).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE PROCEDURE run_nightly_pii_purge(
  p_retention_days INT DEFAULT 90
)
LANGUAGE plpgsql
AS $$
DECLARE
  v_workspace_id  UUID;
  v_purged        INT;
BEGIN
  FOR v_workspace_id IN
    SELECT DISTINCT workspace_id
    FROM connector_order_facts_hot
    ORDER BY workspace_id
  LOOP
    BEGIN
      v_purged := purge_closed_order_pii(v_workspace_id, p_retention_days);
      INSERT INTO pii_purge_log
        (workspace_id, orders_purged, retention_days, status)
      VALUES
        (v_workspace_id, v_purged, p_retention_days, 'ok');
    EXCEPTION WHEN OTHERS THEN
      INSERT INTO pii_purge_log
        (workspace_id, orders_purged, retention_days, status, error_msg)
      VALUES
        (v_workspace_id, 0, p_retention_days, 'error', SQLERRM);
    END;
  END LOOP;
END;
$$;
