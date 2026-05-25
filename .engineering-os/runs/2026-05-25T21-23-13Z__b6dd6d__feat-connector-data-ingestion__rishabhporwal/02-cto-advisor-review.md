# Stage 1 — CTO Advisor Review (Rohan) — Slice E: connector data ingestion

**Req:** feat-connector-data-ingestion · **Epic:** epic-real-auth-supabase (slice E of A–E)
**Decision:** ADVANCE → Stage 2 (Architect) · **Paradigm (first pass):** sql/io (NO LLM/ML)

---

## Lane decision
- **feature_class:** `high-stakes`
- **Trigger-surface scan (fires ≥1 → high-stakes, STOP):** connectors (Shopify/Meta/Google live pull) ·
  PII (Shopify customer email/first/last name; address minimization) · multi-tenancy (`workspace_id` on
  every connector-fact row + RLS) · secrets (custody OAuth token used to call provider APIs) · money
  (orders/spend → BIGINT minor units) · schema/proto change (new connector-fact tables + ACL). Foundational-
  scaffolding carve-out **inapplicable** (live multi-tenant money + PII reads + token use).
- **feature_class_rationale:** 6 trigger surfaces fire; inherited high-stakes from the epic. Conservative
  tie-break moot (unambiguously high-stakes).
- **trigger_surfaces_touched:** `["connectors","pii","multi-tenancy","secrets","money","schema-proto"]`
- **Stages that run (high-stakes lane):** 1 (intake) → 2 (architect) → 3 (build) → 4 (security) →
  5 (verify) → 6 (final review, VETO) → 7 (Founder gate, signed under standing delegation).

## Persona-count decision
- **Count:** 1 (within high-stakes cap of 2).
- **Rationale:** Slice E is largely a **wiring** of two already-stress-tested primitives — Child-3's
  `ingest_batch` (idempotent UPSERT + RLS + PII gate, already had its own 2 :sonnet personas at Child-3)
  and slice-D custody (already had token-custody-at-rest-realist:sonnet, 5 concerns accepted). The
  cost/LLM dimension is N/A (sql/io, zero LLM — no ai-cost-realist needed). The compliance dimension is
  READ-only with NO outbound channel (no DLT/NCPR/9am-9pm surface) → no india-compliance-officer needed.
  **The ONE genuinely new, dominant risk dimension** is the **seam where ingested raw data crosses into
  the analytics read path** — i.e. does a *connected* workspace actually read its OWN ingested facts (not
  the seed, not another tenant's, not a fabricated number) and does re-sync NOT double-count the analytics
  numbers (idempotency proven at the *analytics* layer, not just the raw-row layer). That is a single
  dimension → 1 persona.
- **Persona requested (NOT spawned — returned in HANDOFF):**
  `connector-ingest-to-analytics-parity-realist:sonnet` — reasoning-heavy (multi-step adversarial: raw
  fixture → ACL minor-units/per-SKU-GST conversion → canonical fact → analytics tRPC number; re-sync
  idempotency at the *aggregate* layer; cross-tenant isolation when ≥2 workspaces have synced data;
  honest empty-state when connected-but-not-synced). Tagged `:sonnet` because it spans the full
  ingest→ACL→fact→analytics chain with money/GST correctness, not a bounded checklist.

---

## Domain context check (against the business canon)
- **Money:** orders + ad spend land as **BIGINT minor units + currency_code** (canon §6/§1.2). Raw
  vendor decimals convert at the ACL (Child-2 contract) — NEVER float/NUMERIC for money. ✔ in scope.
- **Per-SKU GST (India adapter):** revenue ladder extracts net-of-tax **per line item by SKU GST 2.0
  slab (0/5/18/40)** via `RegionAdapter.extract_net_revenue` — never a blended rate. Slice-1's revenue
  ladder already does this; slice E must feed it line-items with `sku` so the existing per-SKU extraction
  works. ✔ — binding requirement on the ACL.
- **Multi-tenancy:** `workspace_id` on every connector-fact row; Postgres RLS fail-closed; the analytics
  read path must reject a cross-workspace read (the StubDataPlane already throws UnscopedQueryError). ✔.
- **Honest data / no fabrication:** connected-but-not-synced → "sync pending"; not-connected → "connect a
  store"; NEVER a fabricated number (canon acceptance bar + CF-S10-HONEST-STATE-1). ✔ — binding.
- **Decision Log:** slice E is pure ingestion + READ analytics — it produces no recommendation/action, so
  it writes no Decision Log entry (correct; a sync is not a Brain *action* in the canon sense). The sync
  job IS logged operationally (last_sync_at / last_sync_error / correlation 4-tuple) but that is
  integration-health, not the moat. ✔.
- **Compliance:** READ-only external calls; **NO outbound sends** → no TCCCPR/DLT/NCPR/9am-9pm/WhatsApp
  surface. **PII minimization (DPDP):** Shopify customer email/first/last are already declared in the
  Child-3 SHOPIFY_PII_MANIFEST (lawful_basis owner_brand_controller / purpose analytics_performance);
  **no full street address or phone is pulled** — only pincode/city are needed for the India RTO/pincode
  metric, per the India-adapter default. Ad connectors (Meta/Google) carry **NO individual PII**
  (aggregates only). ✔ — no `/escalate` trigger (no compliance ambiguity; READ-only, PII pre-declared).
- **Cost paradigm:** sql/io only, zero LLM/ML. Pulling from provider APIs + deterministic normalization +
  SQL UPSERT. ✔ — protects %-of-GMV economics (no per-pull LLM cost).

## "Make the requirement less dumb first" (delete / simplify / defer)
- **REFRAME (binding, not a rebuild):** This is **wiring two already-built primitives**, not new
  machinery. (1) Child-3's `ingest_batch` already does idempotent UPSERT keyed `(workspace_id,
  vendor_event_id)`, RLS via `with_workspace`, PII-gate fail-closed, cursor advance, same path for
  live+backfill. (2) Slice-D `completeCallback` already lands the encrypted token in custody. Slice E
  adds: per-vendor **fetch** (the live API call the Child-3 adapters left as a HOLD stub) behind an
  injectable HTTP seam (fixture in tests, real fetch in prod), an **ACL** (raw vendor decimal → minor
  units + per-SKU GST → canonical fact), a **sync use-case** (read custody token → ingest → advance
  last_sync_at), and a **read seam** so a connected workspace's analytics read its OWN facts.
- **CRITICAL DESIGN CONSTRAINT (load-bearing — the architect must resolve this):** the analytics today
  are served by `StubDataPlane` (apps/api-gateway/src/infrastructure/loopback-data-plane.ts) which is
  hardcoded to ONE workspace (SUGANDH_LOK_WORKSPACE_ID `000…001`) reading a `SUGANDH_LOK_CANONICAL`
  seed; every other workspace gets `UnscopedQueryError`. There is **no existing path from ingested data
  to analytics.** Slice E must introduce a DataPlane that, **for a connected+synced workspace**, reads
  the real ingested facts from local Postgres, while **Sugandh-Lok keeps its seed** (Founder: keep the
  demo workspace). This is the single hardest architectural decision in the slice — see the persona.
- **SIMPLIFY (avoid over-engineering):** Do NOT stand up Kafka/ClickHouse for the local read. The canon
  target is ClickHouse OLAP, but Phase-0 local-dev reads from local Postgres facts (the analytics already
  read from an in-process port). The slice E read path is **Postgres facts → DataPlane**, not a new OLAP
  cluster. ClickHouse remains the Phase-3 graduation (trigger not fired). The Kafka producer in
  `ingest_batch` is OPTIONAL (it already no-ops when no producer is passed) — local sync does not require
  a broker. ONE ingest primitive, ONE custody seam, ONE ACL pattern, ONE read seam.
- **DEFER (named, must be stated on the pages):** ClickHouse OLAP read (local stays Postgres); Shopify
  webhooks (slice E is pull-on-demand "Sync now" + on-connect, not webhook-driven CDC — webhook HMAC
  verify already exists from Child-3 but the live webhook endpoint is a later slice); refund-sync /
  Klaviyo / Shiprocket / WooCommerce / Unicommerce connectors (legacy has them; slice E is Shopify +
  Meta + Google per the Founder priority); multi-ad-account / MCC child-account selection (store the
  discovered account_ref; multi-select UI deferred); automatic/scheduled sync (slice E is manual
  "Sync now" + on-connect; cron/scheduler is Stage-8/ops).
- **PRIORITIZATION / split (Founder allowed it):** if scope must be cut, the ranked order is **Shopify
  first** (it drives store/revenue-ladder + P&L — the most pages), then **Meta**, then **Google** (both
  feed slice-4 marketing). Defer the heaviest connector LAST and SAY what is deferred; keep every page
  real (synced where synced, honest empty-state where not).

## First-pass paradigm
- **sql/io** — provider API pull (io) + deterministic SQL UPSERT + per-SKU GST extraction (sql). **Zero
  LLM, zero ML.** Any reach for an LLM here is an anti-blind-agreement trigger → would CHALLENGE-BACK.

## Dependency pre-flight (mandatory)
- Slice E depends on slices A–D (all DONE + COMMITTED per Founder + MEMORY) and Child-3 connector
  framework (committed) + slice-1 store/order fact layer (approved, stage-8) + slice-2 P&L + slice-4
  marketing (all shipped). No unshipped blocker. **PASS** — no dependency violation.
- Local DB `brain-postgres-dev` confirmed UP + healthy on :5432 (docker ps). Real `.env` for both apps
  confirmed git-ignored + untracked; `.env.example` (names only) present (git check-ignore proven at S1).

## Anti-blind-agreement findings (challenged the directive where it was loose)
1. **The directive says "normalize to the canonical order/line-item facts the slice-1 store/revenue-ladder
   reads" — but those facts are currently a hardcoded seed, not a table.** I am NOT accepting the implied
   "just write to the fact table" framing because there is no fact table the analytics read from yet (the
   read path is the StubDataPlane seed). The architect MUST design the local fact tables + the
   connected-workspace read seam. (Reframed above.)
2. **The Child-3 ShopifyAdapter stub references REST `orders.json`; the legacy source-of-truth is the
   Admin GraphQL API (`ORDERS_QUERY`/`PRODUCTS_QUERY` with `totalPriceSet.shopMoney.amount`, `lineItems`,
   `sku`, `variant.product.id`).** Fixtures MUST use the GraphQL shape (the real shape), and the live
   fetch should target GraphQL to match the legacy backfill behavior. Flagged for the architect.
3. **"Money → BIGINT minor units" must happen at the ACL, NOT in the adapter.** Child-3's contract is
   explicit: adapters land raw money verbatim; conversion is the ACL's job. Slice E's new work is the ACL
   (raw decimal → minor units) — keep that boundary; do not convert money inside `normalize()`.
4. **Idempotency must be proven at the ANALYTICS layer, not just the raw-row layer.** `ingest_batch`
   already dedupes raw rows; but the slice-E acceptance is that **re-sync does not change the analytics
   numbers** (revenue, spend, CM2). That is the persona's job to stress.

## Decision
**ADVANCE** → Stage 2 (Architect Aryan). Persona round-trip first: spawn
`connector-ingest-to-analytics-parity-realist:sonnet`, then synthesize, then Aryan plans.

(No CHALLENGE-BACK: the ask is sound, ties to the canon outcome "honest profit analytics on the brand's
REAL data". No KILL.)
