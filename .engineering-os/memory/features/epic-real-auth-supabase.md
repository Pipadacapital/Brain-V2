
## 2026-05-25T21:37:00Z — Slice E SHIPPED (Stage 6 PASS) — feat-connector-data-ingestion — Rohan

**Connector data ingestion** — once a workspace is connected (slice-D token in custody), "Sync now" pulls
real Shopify orders/line-items/products (Admin GraphQL) + Meta campaign insights + Google Ads GAQL using
the custody token, runs an ACL (decimal-string/micros → BIGINT minor units WITHOUT float; per-SKU GST slab;
COD/Prepaid; opaque customer_ref — DPDP-minimized), idempotently UPSERTs canonical facts into local
Postgres under FORCE RLS, advances last_sync_at. A DispatchingDataPlane serves a connected workspace its
OWN ingested facts (LocalDbDataPlane); Sugandh-Lok keeps its seed; non-fed surfaces show honest empty.

**Verified:** @paradigm sql/io (zero LLM); READ-only (no outbound → no DLT/NCPR surface); RLS fail-closed
+ idempotent re-sync (byte-identical at the aggregate layer) proven on live local Postgres (P-001..P-007);
token never logged; .env git-ignored. 21 unit + 6 integration + 225/245/89 suites green; typecheck 0×3;
ZERO new deps. LIVE pull verified-by-fixture (Founder OAuth consent still needed to mint per-account tokens).

**Deferred (stated on pages):** ClickHouse OLAP read (local stays Postgres); Shopify webhooks/CDC; refund-
sync; Klaviyo/Shiprocket/Woo/Unicommerce connectors; multi-ad-account/MCC; scheduled/cron sync; COGS/
RTO/cohorts/products not connector-fed → honest empty.

**epic-real-auth-supabase: slices A–E COMPLETE.** Real identity → signup → onboarding → OAuth connect +
custody → DATA INGESTION → real analytics on the brand's own data. Nothing committed (pending-founder-commit.md).
