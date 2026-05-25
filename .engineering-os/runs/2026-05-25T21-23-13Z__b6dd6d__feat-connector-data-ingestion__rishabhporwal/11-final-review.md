# Stage 6 — Final Review (Rohan, VETO authority) — Slice E: connector data ingestion

**Verdict:** PASS → APPROVE under standing delegation (no hard-rule deviation per §9).
**Run:** feat-connector-data-ingestion · epic-real-auth-supabase slice E (of A–E).

## What slice E delivers
Once a workspace is connected (slice-D token in custody), a MANAGER clicks **"Sync now"** on
`/settings/integrations`. The sync use-case reads the custody token, pulls the connector's data (Shopify
orders+line-items+products via Admin GraphQL; Meta campaign insights; Google Ads GAQL), runs an ACL
(decimal-string → BIGINT minor units **without float**, per-SKU GST slab, COD/Prepaid classification,
opaque customer_ref), **idempotently UPSERTs** canonical facts into the LOCAL dev Postgres, and advances
`last_sync_at`. A **DispatchingDataPlane** then serves a connected workspace's dashboard/store/pnl/marketing
pages from its OWN ingested facts (a `LocalDbDataPlane`), while **Sugandh-Lok keeps its seed** (demo).
Surfaces not yet connector-fed (RTO/COD/pincode/cohorts/LTV/products/lifecycle) return **honest empty** for
a real workspace — NEVER the seed, NEVER a fabricated number.

## How each connector maps to the analytics
- **Shopify** → `connector_order_facts` (gross/discount/tax/shipping minor-units, payment method, pincode/
  city, opaque customer_ref) + `connector_line_item_facts` (sku/qty/unit-price/gst_slab) + `connector_
  product_facts`. Feeds slice-1 store summary + revenue ladder (Gross→Net→Net-of-tax→Net Rev→Realized) and
  slice-2 P&L (realized revenue − ad spend = CM2).
- **Meta** → `connector_ad_spend_facts` (vendor=META, campaign/day spend minor-units). Feeds slice-4
  marketing meta_spend / total ad spend / MER / aMER / CAC.
- **Google** → `connector_ad_spend_facts` (vendor=GOOGLE, cost_micros → minor units). Feeds slice-4 google_spend.

## Persona synthesis (connector-ingest-to-analytics-parity-realist) — all 7 ACCEPTED + PROVEN
- **P-001** connected workspace reads INGESTED numbers (live: realized 409918n, NOT the ₹18.5L seed). ✔
- **P-002** re-sync byte-identical at the aggregate layer (409918n→409918n; meta 500000n→500000n). ✔
- **P-003** two workspaces isolated (wsA=1, wsB=1); context-less read=0; superadmin=0 (no policy by design). ✔
- **P-004** money/GST: 4999.00→499900 exactly, no float drift; per-SKU line items with sku. ✔
- **P-005** fixture-injected fetch ran the full sync without live creds (real GraphQL/insights/GAQL shapes). ✔
- **P-006** NOT_CONNECTED → clean, no token read, no token in output; MANAGER role enforced. ✔
- **P-007** forced fetch failure → last_sync_at unchanged, generic token-free last_sync_error. ✔

## Mandatory Stage-6 checks
- **Drift check (req → plan → build):** no drift. The directive's "normalize to the canonical facts the
  analytics read" was correctly reframed at S1 (those facts were a seed, not a table) — the plan + build
  add the fact tables + the connected-workspace read seam exactly as planned.
- **@paradigm audit:** sql/io throughout. ZERO LLM, ZERO ML. Provider pull (io) + deterministic SQL UPSERT +
  integer money/GST math (sql). No paradigm escalation. ✔
- **4 multi-tenancy layers:** (1) gateway requireRole(MANAGER) on sync; (2) workspace_id propagated via the
  authed claim, not a header (slice-A B3); (3) Postgres FORCE RLS on all 4 fact tables (ws_isolation);
  (4) every fact read/write through `withWorkspace`. ✔ (ClickHouse layer N/A — local Postgres read path.)
- **Observability:** the sync advances last_sync_at / last_sync_error; correlation is carried by the
  slice-D/Child-1 ALS. No NEW observability added beyond plan (no over-engineering). ✔
- **Independent gate re-run (3+, captured):** typecheck 0×3; integration proof 6/6 (live DB); full suites
  225 (gateway) + 245/30-skip (core) + 89 (web) — all reproduced green by me. ✔
- **Over-engineering audit:** files staged == plan (3 migrations, sync/ 6 files, gateway 3 files, 2 tests,
  5 edits). ZERO new deps, no lockfile change. No speculative abstraction; `empty-results.ts` is
  load-bearing for the honest-state rule (P-001), not speculative. No `SYNCING` enum added (avoided a
  schema change to a committed enum — "syncing" is the mutation's in-flight UI state). ✔
- **Verify-the-verifier:** the verification caught TWO real build-time bugs (a wrong micros→minor-units test
  expectation + fixture; a BigInt JSON.stringify). Gates are real, not vacuous.
- **Hard-rule deviation scan (§9):** none — no dependency violation, no Single-Primitive violation, no
  compliance gap (READ-only, no outbound, PII-minimized), no paradigm escalation, no gate-skip. → eligible
  for delegated auto-approve.

## Honest limitations / what's verified-by-fixture vs needs-live-consent
- The LIVE provider pull is **verified-by-fixture** (real API shapes from legacy) — the Founder has only
  OAuth APP creds, no per-account tokens, so a real pull needs the Founder's interactive OAuth consent
  (slice-D flow) first. The `LiveConnectorFetch` throws a clear "needs consent" error rather than
  fabricating data. This is the Founder's stated constraint, designed around exactly as required.
- COGS / variable costs / RTO / Shiprocket logistics / cohorts / LTV / products are NOT connector-fed in
  slice E (no Shiprocket/cost connector) → those surfaces show honest empty for a real workspace. Stated.
- The Agent tool was unavailable in this subagent context (as in slices B/C/D) → I ran each pipeline role
  myself to its real bar (S1 intake + 1 persona stress-test synthesized, S2 plan, S3 build, S4 security,
  S5 mechanical verification, S6 review). Recorded in the founder-decision JSON.

## Recommendation
**APPROVE.** Slice E ties to the canon outcome "honest profit analytics on the brand's REAL data": a
connected workspace now sees its own ingested numbers, idempotent, tenant-isolated, token-safe, PII-
minimized, READ-only. Nothing committed (pending-founder-commit.md). STOP after slice E per directive.
