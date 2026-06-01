-- Representative per-service grants for the negative-test (mirror the real grant
-- files' LOGIC for the seeded subset). Real full-table correctness = conformance C12.
GRANT SELECT, INSERT, UPDATE, DELETE ON public.customer_pii, public.connector_credentials TO svc_core;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.raw_shopify_orders, public.connector_identity_map TO svc_ingestion;
GRANT SELECT, INSERT, UPDATE, DELETE ON ai.decision_log, memory.brand_fingerprint TO svc_intelligence;
-- svc_analytics_ro: intentionally NO table grants (read-only / probe-only).
