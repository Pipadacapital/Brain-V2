-- @paradigm: sql
-- 0011 — shipment COD + payment + delivery geo columns (production-readiness P0 #6).
--
-- The slice-E connector_shipment_facts (CH) carried status/courier/is_rto but
-- dropped the COD signal and delivery geography that the logistics / RTO /
-- COD-vs-Prepaid surfaces need. Legacy derives COD from shiprocket_shipments
-- (payment_method = 'cod'), NOT the is_cod boolean (which is false for every
-- migrated row). Charges/cod_amount are intentionally absent — legacy never
-- materialized them into the facts (they live only in shiprocket rawJson), so the
-- read path emits 0 for charges (honest parity, not fabricated).
--
-- is_cod here is derived at ETL time from payment_method. Backfill: re-load
-- connector_shipment_facts from legacy shiprocket_shipments with a higher RMT
-- version (collapses on workspace_id, vendor, vendor_shipment_id).

ALTER TABLE brain.connector_shipment_facts
  ADD COLUMN IF NOT EXISTS is_cod          UInt8                  DEFAULT 0,
  ADD COLUMN IF NOT EXISTS payment_method  LowCardinality(String) DEFAULT '',
  ADD COLUMN IF NOT EXISTS delivery_city   LowCardinality(String) DEFAULT '',
  ADD COLUMN IF NOT EXISTS delivery_state  LowCardinality(String) DEFAULT '';
