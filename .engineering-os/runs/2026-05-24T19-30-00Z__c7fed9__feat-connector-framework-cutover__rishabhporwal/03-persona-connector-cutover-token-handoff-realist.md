# Dynamic Persona Review — connector-cutover / token-handoff realist

> Filled by a single persona spawned in Stage 1.
> At least one concern is mandatory. A "no concerns" persona is rejected by the CTO Advisor.

| Field | Value |
|-------|-------|
| **req_id** | `feat-connector-framework-cutover` |
| **Persona** | connector-cutover / token-handoff realist (engineering reversibility) |
| **Timestamp** | 2026-05-24T20:10:00Z |

---

## What this lens sees

The cutover realist's job is to hold one question above everything else: **at the instant the token moves, what is actually irreversible, and does the rollback tree silently rely on something that may no longer exist?**

This requirement is carefully structured — the HOLD-AT-CUTOVER discipline is exactly right in shape. But reading the actual legacy connector code, the `ingestion-service` scaffold, and the A4 rollback table against each other reveals four concrete structural problems the requirement text papers over:

1. Shopify HMAC validation is keyed on a single env-var app secret (`SHOPIFY_CLIENT_SECRET`), not on a per-shop secret — meaning the webhook endpoint itself is shared infrastructure. "Cutting over per connector" for Shopify actually means switching the single shared endpoint URL, making the cut a facade-level flip rather than a per-shop token swap. This is a different shape than the requirement describes.
2. The A4 rollback tree for connectors ("restore legacy token + re-register legacy webhook") assumes the legacy app is **still running and reachable** at rollback time. The 3c scope (residual-writer retirement) creates a state where legacy is formally "retired" at that connector's cutover — producing a rollback instruction that points at a dead endpoint.
3. Shiprocket is not a webhook connector at all. It is a **polling/API-pull connector** authenticated by a re-loginable `email/password` pair that produces a short-lived JWT (9-day effective TTL). "No replay" is true but understated: the actual data-loss window is bounded by Shiprocket's API pagination window AND by the JWT re-login latency, not by a 72h rollback window that implies an event stream exists.
4. `ingestion-service` has four `.gitkeep` directories and a `pyproject.toml` with `dependencies = []`. There is no Kafka client, no deploy pipeline, no database connection, no schema. CF-C3-FIRST-RUNTIME-1 names this explicitly — but the requirement underweights the blast radius: the first live Brain ingest runtime is a full Python service standup (greenfield DDD scaffold, MSK/Kafka topic creation, Supabase pooler connection from Python, psycopg3 + asyncpg not yet in `pyproject.toml`). This is precisely the Shape-B scope blow-up that bit Child 1 (which discovered `ingestion-service` was out of scope when a deployed ingest runtime appeared in the Child-1 design).

---

## Concerns

### Concern 1 — CRITICAL: Shopify "per-connector cutover" is an endpoint-level flip, not a token-level flip — webhook HMAC uses a single shared app secret, not a per-shop credential

- **Severity:** critical
- **Evidence:**
  - `legacy project/backend/src/lib/shopify/webhooks.ts:35`: `crypto.createHmac('sha256', process.env.SHOPIFY_CLIENT_SECRET!)` — the HMAC key is the **app-level client secret from env**, identical for every Shopify shop connected to the same app installation. It is not derived from the per-shop `accessToken`.
  - `legacy project/backend/src/lib/shopify/webhooks.ts:505`: `webhookUri = ${baseUrl.replace(/\/$/, '')}/api/shopify/webhooks` — **one webhook URL for all shops**, registered via `webhookSubscriptionCreate` GraphQL mutation. All connected Shopify stores send webhooks to this single endpoint.
  - `legacy project/backend/src/routes/shopify.ts:663`: the webhook handler resolves `connection` via `prisma.shopifyConnection.findFirst({ where: { shopDomain: normalizedShop } })` — the routing is shop-domain-based at the endpoint, NOT token-based.

- **Concern:** The architecture (A6) and CF-C3-SINGLE-OWNER-1 describe "token lives in exactly ONE system at a time" as if each Shopify connector has an independent, isolated cutover. It does not. For Shopify, there is ONE shared webhook endpoint URL (keyed to the legacy app's `SHOPIFY_APP_URL`), ONE shared HMAC secret (`SHOPIFY_CLIENT_SECRET`), and per-shop `accessToken` values used only for outbound API calls (REST/GraphQL). The per-connector reversibility unit is NOT a token; it is the registered `callbackUrl` in Shopify's `webhookSubscriptionCreate` — i.e., the endpoint URL that Shopify pushes events to. This means:
  - **Cutting over Shopify = changing the webhook callback URL** from `legacy-host/api/shopify/webhooks` to `brain-host/ingestion-service/webhooks/shopify`. That flip affects ALL Shopify shops simultaneously (there is one registered URL per topic per shop, but re-registering ALL shops' webhooks to a new URL is an atomic operation across all workspaces).
  - **"Per-shop" reversibility** would require de-registering Brain's callback URL and re-registering the legacy URL shop-by-shop via the GraphQL mutation — which is O(shops × topics) API calls, each of which can fail, and Shopify rate-limits mutations. With 14 webhook topics and N shops, this is not a sub-minute rollback.
  - **HMAC verification at Brain** cannot reuse the legacy `SHOPIFY_CLIENT_SECRET` env var unless that secret is explicitly copied into the Brain environment. The architecture's CF-SEC-SECRETS-1 (no plaintext creds) creates a contradiction: Brain must know the HMAC secret to verify webhook authenticity, but that secret is the app-level Shopify Partner secret (not a per-brand credential that rotates into Secrets Manager per A6).

- **Proposed binding constraint:** `CF-C3-SHOPIFY-ENDPOINT-ATOMIC-1` — Document that the Shopify connector cutover is **all-shops-simultaneously** (one endpoint URL flip), not per-shop. The per-connector reversibility unit for Shopify is the set of all shops; the rollback is a bulk webhook re-registration against the legacy endpoint URL. The runbook MUST: (a) call `webhookSubscriptionCreate` for ALL connected shops in one scripted batch, (b) define the rollback as the same bulk script in reverse, (c) account for Shopify rate limiting (2 mutations/sec/shop for the Admin API), and (d) specify how the Brain ingest endpoint verifies HMAC using the app-level secret (which must be in the Brain environment before any webhook arrives).

---

### Concern 2 — HIGH: A4 rollback tree silently assumes the legacy app is still live and webhook-capable — the 3c residual-writer retirement severs that assumption at the moment of cutover

- **Severity:** high
- **Evidence:**
  - A4 Child-3 row (`06-architecture-plan.md` line ~554): "ROLLBACK: Token handed back to legacy; webhook re-registered to legacy endpoint; gap backfilled from API (except Shiprocket → accept documented gap)."
  - Requirement §scope 3c: "legacy writers retired at their connector's cutover" and CF-C3-FORCE-UNLOCK-1: "legacy writers retired at cutover."
  - `legacy project/backend/src/routes/shopify.ts:604-716`: the legacy Shopify webhook handler is a live Express route (`/api/shopify/webhooks`) that depends on the legacy server running, receiving HTTP, and having `SHOPIFY_APP_URL` resolving to the legacy host. The legacy app is the only system that can re-receive webhooks at rollback.

- **Concern:** The A4 rollback tree works only if the legacy app:
  - (a) Is still **deployed and running** when rollback fires
  - (b) Has its webhook endpoint **DNS-reachable** from Shopify's servers
  - (c) Still has the `SHOPIFY_CLIENT_SECRET` env var set (to verify HMAC)
  - (d) Still has the plaintext credentials in its DB (CF-SEC-SECRETS-1 requires deleting the legacy plaintext AT cutover — which means after C8, the legacy app's own DB lookup for `accessToken` returns null, and `handleInventoryLevelWebhook` already guards `if (!conn?.accessToken) return`)

  The requirement's HOLD-AT-CUTOVER discipline preserves (a) and (b): the live flip is deferred, so legacy stays up. BUT CF-C3-SINGLE-OWNER-1 + the A6 ceremony as described requires **deleting the legacy plaintext credential at cutover (C8)**. If the legacy plaintext is deleted at the same step as the token transfer, the rollback window opens into a state where: Brain has the credential (or is mid-rotation), legacy's credential is deleted, and if Brain fails parity within N hours, "restore legacy token" means re-entering the plaintext credential into the legacy DB — a manual intervention, not an automated flag-flip.

  The Child-1 analogy is: "Rollback = DISABLE + DROP POLICY" — which works because ENABLE/CREATE is additive and DISABLE is instantaneous. The connector rollback is not additive; it is destructive (delete legacy plaintext). There is no `DISABLE` equivalent for a deleted credential.

- **Proposed binding constraint:** `CF-C3-ROLLBACK-CRED-WINDOW-1` — The legacy-plaintext-delete (C8) step MUST be sequenced AFTER the rollback window N closes and parity is confirmed, NOT at the instant of token transfer. During the rollback window, the legacy plaintext is in a SEALED state (not deleted, not accessible to the legacy app, not accessible to Brain; held in a holding secret in the Secrets Manager or behind a Founder-controlled flag). Only after N hours of successful parity does the delete become permanent. This extends the "dual custody prohibition" moment to after the rollback window, accepting a brief custody-gap rather than a permanent data-loss risk.

---

### Concern 3 — HIGH: Shiprocket is a polling connector with re-loginable email/password, not a webhook connector — the "no replay" framing is correct but the token-handoff model in A6 does not fit Shiprocket's auth pattern

- **Severity:** high
- **Evidence:**
  - `legacy project/backend/src/lib/integrations/shiprocket.ts:6`: `TOKEN_MAX_AGE_MS = 9 * 24 * 60 * 60 * 1000` — Shiprocket JWTs are valid for ~9 days (with 10-day server-side validity); `getValidToken()` re-logs in via `loginShiprocket(email, password)` automatically when expired.
  - `legacy project/backend/src/routes/integrations/shiprocket.ts:50-56`: `ShiprocketConnection.upsert` stores `email`, `password`, `accessToken` as plaintext. The `password` is the Shiprocket account password in plaintext.
  - `legacy project/backend/src/lib/integrations/shiprocket-sync.ts:341-364`: `discoverChannels(connectionId)` calls `getValidToken` → `loginShiprocket(email, password)` and writes back to `prisma.shiprocketConnection` **using the bare `prisma` singleton**, not `withWorkspace`. This is a BARE WRITE that the Child-1 FORCE-unlock (3c) must convert. The code comment at the call site (`routes/integrations/shiprocket.ts:291`) does not wrap `discoverChannels` in a `withWorkspace` context.
  - A1.3 (`06-architecture-plan.md` line ~201): "Shiprocket: NO historical event replay" — but Shiprocket does not HAVE webhooks in the same sense as Shopify. It is a REST API poll (`/shipments`, `/orders`) paginated by date range.

- **Concern:** The architecture treats Shiprocket's "no replay" as a risk about missing webhook events during the transition window. That framing is incomplete. Shiprocket has no webhook infrastructure to "cut over" — there is no callback URL to re-register. Instead:
  - **What a Shiprocket "cutover" actually means:** Brain starts calling `fetchShiprocketOrders()` + `fetchShiprocketShipments()` with a valid JWT, and the legacy cron stops calling them. The "token handoff" is not transferring a webhook secret — it is ensuring that Brain's first poll uses a valid JWT (obtained by re-logging in with `email/password`) and that the legacy cron's scheduled invocation of `syncAllShiprocket()` is disabled. There is no instant where events are "in flight" and might be lost.
  - **The actual data-loss scenario** is a polling gap: if Brain's first scheduled poll runs at T+1h and legacy's last poll ran at T-5m, the window T-5m to T+1h is covered by neither. For Shiprocket's API, this means orders with `order_date` or shipments with `status_updated_at` in that window may not be fetched until Brain's first cron tick covers it with `days=1`. This is recoverable (just extend the days window on first poll) but is not documented as the gap scenario in the runbook.
  - **The `discoverChannels` bare-write problem (3c):** `discoverChannels` at `shiprocket-sync.ts:346-361` uses `prisma.shiprocketConnection.update(...)` with the bare Prisma singleton — no `withWorkspace`, no RLS context. This is exactly the class of writer the Child-1 FORCE-unlock requires to be converted before the bare-write grep can return ZERO hits. The requirement's 3c scope says this is satisfied by "Brain-native ingest framework becomes the replacement" — but the legacy `discoverChannels` is STILL CALLED from the live legacy route (`routes/integrations/shiprocket.ts:291`) and from `syncShiprocketForConnection` at line 212-222 (inside `withWorkspace`, but `discoverChannels` itself uses bare `prisma`). Until the legacy app is decommissioned, `discoverChannels` remains a live bare writer. The 3c "satisfied against Brain code" ruling in 02-cto-advisor-review.md is correct in principle but requires an explicit acknowledgement that the `discoverChannels` bare write in legacy continues until that connector is fully decommissioned — meaning the Child-1 FORCE unlock precondition (complete bare-write grep ZERO hits) is not met until after EVERY connector is decommissioned, not after Child 3 builds its Brain replacement.

- **Proposed binding constraint:** `CF-C3-SHIPROCKET-POLL-MODEL-1` — The Shiprocket cutover runbook MUST explicitly model the polling-gap scenario, not a webhook event-loss scenario. The Brain ingest framework for Shiprocket is a scheduled pull (not a webhook receiver). The cutover step is: (1) disable legacy `syncAllShiprocket` cron, (2) verify no legacy Shiprocket cron is scheduled, (3) trigger Brain's first Shiprocket poll with `days=7` (not `days=1`) to cover the polling gap, (4) verify shipment count parity. The 72h rollback window is the time allowed for this polling parity check to complete, not a webhook replay window. Separately bind: `CF-C3-FORCE-UNLOCK-SCOPE-1` — explicitly document that the bare-write grep ZERO hits precondition for the Child-1 FORCE is not satisfied until the legacy `discoverChannels`/`backfillShiprocketCourierNames`/`backfillShiprocketPincodes` bare writers are retired by the Shiprocket connector decommission (the last connector), not by merely building the Brain replacement.

---

### Concern 4 — CRITICAL: CF-C3-FIRST-RUNTIME-1 is a named constraint but the scope explosion is larger than named — `ingestion-service` needs Python dependencies, a Postgres connection, AND Kafka before it can ingest a single event

- **Severity:** critical
- **Evidence:**
  - `apps/ingestion-service/pyproject.toml`: `dependencies = []` — no psycopg3, no asyncpg, no aiokafka, no httpx/aiohttp, no pydantic. Zero dependencies declared.
  - `apps/ingestion-service/src/`: four directories, all `.gitkeep`. Zero Python source files.
  - `apps/ingestion-service/pyproject.toml` description: "Shopify/Unicommerce/MoEngage connector ingestion pipeline. Phase 0-1 deployable." — the description references MoEngage (not in the legacy connector list) and Unicommerce but not Shiprocket/Meta/Google/Klaviyo.
  - Child-1 analogy: the CTO review for `feat-tenancy-rls-brain-native` named the Shape-B trap explicitly — "Child 1 discovered that `ingestion-service` was out of scope when a deployed ingest runtime appeared in the design." That trap fires again here, but Child 3 IS the ingestion-service child.

- **Concern:** CF-C3-FIRST-RUNTIME-1 says "Stage-2 must scope explicitly whether the framework ships behind a deploy-pipeline track or stays LOCAL-verified-only this child." This is the right question but it understates the minimum viable scope. Even for LOCAL-verified-only, the Brain ingest framework needs:
  - **Python dependency declarations** (psycopg3 for Postgres, asyncpg or psycopg3 async, httpx for outbound API calls, pydantic for event schemas, kafka-python or aiokafka for Kafka producer)
  - **A Supabase/Postgres connection from Python** — `apps/core-service` is Node.js/Prisma; the ingestion Python service needs its own DB connection mechanism. The `withWorkspace` primitive is a Node.js/TypeScript function in `apps/core-service/src/infrastructure/db/workspace-context.ts`. The Python ingestion service cannot import it. CF-C3-RLS-CONSUME-1 requires "every write goes through the Child-1 `withWorkspace` primitive" — but that primitive is TS-only. Python must implement an equivalent `set_config('app.workspace_id', workspace_id)` pattern independently (a known-safe pattern, but it must be designed and tested, not assumed).
  - **A Kafka topic** — `integrations.*.v1` does not exist anywhere. Creating the first MSK topic requires infrastructure decisions (topic naming convention, partition count, retention policy, schema registry or not) that have not been made.
  - **A deploy target** — there is no `Dockerfile`, no `fly.toml`, no ECS task def, no Kubernetes manifest for `ingestion-service`. "LOCAL-verified-only" means a local `uvicorn` process or a `pytest` run, which cannot test the actual psycopg3 Supabase pgbouncer connection path (the same pool-correctness problem that bit Child 1's rollout runbook).

  If Stage-2 decides "LOCAL-verified-only this child" for the framework, the HOLD-AT-CUTOVER ceremony is gated on a framework that has never run against the real Supabase pooler. The live cutover will be the first time Brain's Python ingest path actually connects to production — which is exactly the big-bang failure mode the HOLD-AT-CUTOVER discipline was designed to prevent.

  **The Shape-B scope test:** Does this child need a NEW deployable service (not just new code in an existing service)? Yes — `ingestion-service` is a new Python process, not a module of `core-service`. Does it need new infrastructure (Kafka topic, MSK cluster or local broker, possibly Schema Registry)? Yes — the `integrations.*.v1` topic does not exist and no Kafka infrastructure is documented anywhere in Brain. This is unambiguously Shape-B by the definition that bit Child 1.

- **Proposed binding constraint:** `CF-C3-RUNTIME-SCOPE-DECISION-1` — Stage-2 (Aryan) MUST make ONE of two explicit, binding decisions before the build begins: **(A) Framework-only LOCAL-verified:** ingestion-service ships Python source + dependencies + unit tests + a local Docker Compose test harness (Postgres + Kafka); no live Supabase connection; no MSK topic; the Kafka producer is unit-tested against a local broker. HOLD-AT-CUTOVER includes a mandatory integration test against the real Supabase pgbouncer before any live webhook is pointed at Brain. OR **(B) Full-runtime LOCAL+STAGING:** ingestion-service ships with a deploy target, MSK topic provisioned, and integration test against Supabase staging before HOLD-AT-CUTOVER. The choice MUST be recorded in the Stage-2 architecture plan and its test coverage implications bound explicitly. A third "let's figure it out during build" path is not acceptable — that is how Child 1's Shape-B trap happened.

---

### Concern 5 — MEDIUM: Meta Ads and Google Ads use pull-not-push patterns — "replay available via Insights API" is correct but the parity window assumes the API is idempotent, and Meta's reporting delay means the count parity check fires on stale numbers

- **Severity:** medium
- **Evidence:**
  - A1.3 (`06-architecture-plan.md` line ~199): "Meta Ads: YES — Insights API window. Google Ads: YES — Ads API window."
  - M-A5-Q3 answer: "Meta/Google rollback window N: 8 hours. Parity check: COUNT(meta_ads_daily_metrics WHERE date >= transfer_date) parity; spend sum within 0.01% (API rounding)."
  - `legacy project/backend/src/lib/integrations/meta-sync.ts:46`: `INCREMENTAL_SYNC_DAYS` (imported) determines the rolling window; the cron at `cron.ts:62-71` calls `syncAllMetaAds(CRON_SYNC_DAYS=5)`, meaning legacy re-fetches the LAST 5 DAYS on every hourly run.

- **Concern:** The M-A5-Q3 parity check compares `COUNT(meta_ads_daily_metrics WHERE date >= transfer_date)` between legacy and Brain. But Meta Ads reporting has a **24-48 hour attribution window** (documented in the architecture: "Meta/Google often have 24–48h reporting delay, so yesterday's data may appear late" — `cron.ts:44`). This means:
  - At the token transfer instant, the "last 8 hours of data" in Meta Ads likely contains INCOMPLETE rows for yesterday and the day before (Meta will update them later via late attribution).
  - The parity COUNT check will likely PASS (both Brain and legacy have the same rows for `date >= transfer_date`) but the SPEND SUM check may fail or appear equal at the moment, with the actual final numbers only materializing 24-48h later.
  - After Brain takes ownership, legacy is no longer calling the Insights API for this workspace. If Brain's daily cron also runs `days=5` on a rolling window, it will catch the late attribution updates for the past 5 days. But if Brain's first cron run is scoped to `days=1` (the cutover day), the previous 4 days' late-arriving attribution data will be missed until the next rolling-window run.

  This is a LOW-severity data quality issue in isolation but becomes MEDIUM because the 8h rollback window decision criterion ("spend sum within 0.01%") will likely show a false PASS at T+8h, followed by a silent data quality degradation 24-48h later when Meta finalizes its attribution numbers and Brain's rolling window may not cover the gap.

- **Proposed binding constraint:** `CF-C3-META-GOOGLE-ATTRIBUTION-WINDOW-1` — For Meta and Google connectors, the parity check MUST include a 48h re-validation window (not just the 8h rollback window). On first Brain-owned cron tick, sync `days=7` (not `days=1`) to cover the attribution window. Document in the runbook that the 8h parity window is for event COUNT parity only; SPEND SUM parity is only confirmbale 48h post-cutover when Meta finalizes attribution. Do not use spend sum as a hard rollback trigger within 48h of cutover.

---

## One-liner for the CTO Advisor

**The five concerns in severity order:**

| # | Concern | Severity |
|---|---------|----------|
| 1 | Shopify "per-connector" cutover is actually an all-shops endpoint flip — the HMAC secret is app-level (`SHOPIFY_CLIENT_SECRET` env var), the callback URL is shared infrastructure, and re-registering all shops is O(shops × 14 topics) API calls subject to Shopify rate limits. CF-C3-SINGLE-OWNER-1 as written implies per-shop reversibility that does not exist at the code level. | CRITICAL |
| 4 | `ingestion-service` has zero Python dependencies and zero source files. The first live Brain ingest runtime needs psycopg3/asyncpg, httpx, aiokafka, pydantic, a Python-native equivalent of the `withWorkspace` session-context primitive (the TS version cannot be imported), and a Kafka topic that does not exist. This is the Shape-B scope explosion named by CF-C3-FIRST-RUNTIME-1 but underweighted in the requirement text. Stage-2 MUST make a binding LOCAL-only vs. STAGING decision before build begins. | CRITICAL |
| 2 | A4 rollback ("restore legacy token + re-register webhook") silently requires the legacy app to be running and the legacy plaintext credential to exist. CF-SEC-SECRETS-1 requires deleting the legacy plaintext AT cutover — making rollback require manual credential re-entry, not a flag flip. The credential delete must be sequenced AFTER the rollback window closes, not at token-transfer time. | HIGH |
| 3 | Shiprocket is a polling connector, not a webhook connector. "No replay" is understated: there is no webhook to re-register; the cutover is a cron disable + Brain first-poll. The 72h window is a polling-parity window, not an event-replay window. Additionally, `discoverChannels` uses the bare `prisma` singleton (not `withWorkspace`), making it a live bare writer the Child-1 FORCE-unlock grep will find — and it stays a live bare writer until the Shiprocket connector is fully decommissioned (the last one). The "bare-write ZERO hits" precondition is not satisfied by building a Brain replacement for it; it is satisfied by retiring the legacy caller. | HIGH |
| 5 | Meta/Google 8h parity window measures event COUNT against a platform with 24-48h attribution delay. The spend sum parity check will produce a false PASS at 8h and a silent data quality gap 24-48h later when Meta finalizes attribution. The rollback trigger must not be spend-sum-based within 48h of cutover. | MEDIUM |

---

## Highest-risk single step

**Shopify token transfer + webhook re-registration at HOLD-AT-CUTOVER execution.**

Specifically: the step where the legacy Shopify webhook `callbackUrl` is updated to Brain's endpoint for ALL connected shops simultaneously. This step is:
- Irreversible-in-the-instant (Shopify's own API confirms the new URL and starts routing within seconds)
- Affects all workspaces at once (not per-workspace reversible)
- Requires Brain's ingest endpoint to be receiving HTTP before the first webhook arrives (race condition if endpoint startup is slow)
- Requires the Brain environment to have `SHOPIFY_CLIENT_SECRET` before any HMAC verification can succeed (a plaintext-credential dependency that CF-SEC-SECRETS-1 does not cover, because this is an app-level secret, not a per-brand OAuth token)
- Has a rollback path that requires re-executing O(shops × 14 topics) GraphQL mutations against Shopify's rate-limited API

If Brain's webhook endpoint is not responsive at the moment the callbackUrl is flipped, every Shopify order event during the startup window is silently dropped (Shopify will retry a fixed number of times over 48h before marking the webhook as failed, but the retry behavior depends on the response code Brain returns — a 500 causes retry; a 200 with failed processing does not).
