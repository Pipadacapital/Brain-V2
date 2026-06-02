-- Teardown of legacy-migration staging tables (production-readiness P0 #12).
--
-- The ETL stages legacy rows into UNLOGGED stg_*/tmp_* tables in brain_dev to
-- join locally (see *-backfill.sql). Those tables hold MULTI-TENANT data with no
-- RLS and are readable by the rls_app role — an exfiltration surface. Once the
-- facts are loaded + verified they MUST be dropped. Run this at the end of every
-- migration cycle (the live brain_dev volume was cleaned 2026-06-02).
--
-- The FDW server `legacy_supa` + its `legacy_src` foreign tables are a separate,
-- dev-only artifact (the prod app has no such FDW); drop them too when the
-- migration toolkit is fully retired:
--   DROP SCHEMA IF EXISTS legacy_src CASCADE;
--   DROP SERVER IF EXISTS legacy_supa CASCADE;   -- also drops the user-mapping (legacy creds)

DROP TABLE IF EXISTS
  stg_ad, stg_clif_ch, stg_google_conn, stg_google_raw, stg_meta_conn, stg_meta_raw,
  stg_ship, stg_sli, stg_so_map, stg_wdm, stg_wo_map,
  tmp_shop_omap_clif, tmp_woo_omap_clif
CASCADE;
