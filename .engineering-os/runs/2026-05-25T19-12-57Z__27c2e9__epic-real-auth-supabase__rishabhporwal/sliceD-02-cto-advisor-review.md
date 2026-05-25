# Stage 1 — CTO Review (Rohan) — Slice D: live integrations (Shopify, Meta, Google) OAuth + token custody

**Reviewer:** Rohan (CTO Advisor) · **Date:** 2026-05-26 · **Decision: ADVANCE**
**Epic:** epic-real-auth-supabase · **Slice:** D (FINAL slice — live integrations)
**Prior slices A/B/C:** DONE + COMMITTED (identity / signup+recovery / onboarding+membership+local-RLS).

## Raw deliverable (Founder-binding)

Build the OAuth **connect/callback code + token custody** for **Shopify, Meta Ads, Google Ads**,
BUILT and MECHANICALLY VERIFIED. The Founder configures the provider dashboards. Slice D does NOT
require live provider calls to pass — verify the flow mechanically (initiate builds correct auth URL
+ state nonce; callback exchanges code, persists custody, is idempotent + RLS-scoped) and state
exactly the redirect URIs the Founder must register.

## Lane decision

- **feature_class: high-stakes** (no carve-out).
- **feature_class_rationale:** Trigger-surface scan fires multiple hard surfaces outright —
  **connectors** (external Shopify/Meta/Google OAuth), **auth** (OAuth tokens = access credentials),
  **multi-tenancy** (per-workspace connector tables + RLS), **PII** (these read store/ad data; the
  callback persists tokens that grant access to PII-bearing vendor data). Conservative tie-break moot.
- **trigger_surfaces_touched:** [connectors, auth, multi-tenancy, PII, secrets]
- **Stages that run:** 2 (Architect) → 3/4 (Build) → 4 (Security VETO) → 5 (Verification VETO) → 6 (Final).

## Domain / canon check

- **Cost model:** @paradigm **sql/io** — pure OAuth handshake + DB persistence + vendor HTTP. ZERO
  inference path. Any @paradigm LLM/ML decorator on slice-D code = violation → BOUNCE. Defends the
  %-of-GMV cost model (no per-call LLM cost on the connect path).
- **Compliance (Shreya surface):** OAuth tokens are SECRETS → must be **encrypted-at-rest**,
  **RLS-scoped**, **never logged/echoed**. These are READ integrations (pull ad/store data) — **NO
  outbound send, NO DLT/NCPR/9am–9pm/WhatsApp surface**. DPDP: connector tables hold tokens + minimal
  account metadata; data-ingestion (which lands PII-bearing order/customer rows) is the heavier DPDP
  surface and is explicitly DEFERRABLE per the directive (Child-3 PiiManifest gate already owns it).
- **Least-privilege scopes:** carry the legacy scope sets verbatim (read-only families): Meta
  `ads_read,ads_management,business_management,read_insights`; Google `.../auth/adwords`; Shopify
  `read_orders,read_all_orders,read_products,read_customers,read_analytics,read_inventory,read_reports`.
- **Custody:** the production `seal()` decision (CF-C7-CUSTODY-PROOF-1: AWS Secrets Manager ap-south-1
  vs Supabase encrypt-in-place — both NotImplementedError stubs) REMAINS HELD. Slice D builds a
  **real-enough LOCAL-DEV custody** behind the same interface (authenticated symmetric encryption,
  key from git-ignored .env), flag-gated + marked local-only. Production seal() is NOT faked.

## Architecture decision (Stage-1 ruling, refined at Stage 2)

The Child-3 connector framework + custody Protocol is **Python (ingestion-service)** and is HELD at
Stage-8 (NotImplementedError stubs). Slice C established the live runtime path in **TypeScript**
(web Next.js route handlers → api-gateway tRPC → core-service use-cases on the `withWorkspace`/
`withSuperadmin` Single-Primitive). Slice D's OAuth connect/callback is an **interactive browser
redirect flow that issues + persists tokens at runtime** — it MUST live on the TS runtime path, NOT
in the held Python framework.

**Ruling:** slice D mirrors the Child-3 *custody contract* (get/put/seal Protocol; Credential never
logged; production backings held) as a **TS port in core-service**, and adds a **real LOCAL-DEV
custody backing** (AES-256-GCM, key from `.env`). This is NOT a Single-Primitive violation: the
Python framework is a separate (held) service runtime; the TS custody mirror is the FIRST TS custody
implementation and is the single TS custody seam (every TS connector token read/write goes through it).
The production seal() (CF-C7-CUSTODY-PROOF-1) is carried unchanged as the held item.

## Persona-count decision

- **Count: 1** (within the high-stakes cap of 2). 
- **Rationale:** single dominant UNSETTLED risk dimension = **token-custody-at-rest correctness**
  (encrypt/decrypt round-trip + tamper-reject + key-handling + never-log, on the local backing that
  becomes the template the production seal() must satisfy). The OAuth/CSRF/idempotency/RLS dimensions
  are SETTLED patterns — the legacy oauth-state (hashed state, TTL, one-time consume) + slice-C RLS
  (`withWorkspace` FORCE-RLS) + Child-3 idempotent-UPSERT are proven; they collapse into "apply the
  known pattern", not an independent unsettled dimension. NOT 0-persona: getting local custody subtly
  wrong (e.g. ECB, no auth tag, key in repo, decrypt-on-tamper) would set a dangerous template + leak
  secrets — conservative rule spawns one. NOT 2: no second independent unsettled dimension.
- **Persona spawned (I am a subagent with no Agent tool — I synthesize its angle inline at Stage 2):**
  `token-custody-at-rest-realist:sonnet` (reasoning-heavy: AEAD correctness, key custody, tamper
  semantics, the local→production seal() boundary).
- **Persona quality gate:** the custody persona MUST surface ≥1 concrete concern (a "looks fine" pass
  is rejected). Synthesized concerns recorded in the Stage-2 plan.

## First-pass paradigm

**sql/io** — OAuth handshake (vendor HTTP) + deterministic DB persistence + symmetric crypto. No LLM,
no ML. Architect to affirm.

## Deferrals (honest, named)

- **Data ingestion / backfill** (pull orders/spend → analytics): DEFERRED to a clearly-named sub-step.
  The connect/callback + custody is the slice-D deliverable; ingestion lands behind the Child-3 framework
  (Python, held). Status surfaced honestly as "connected · sync pending" — NOT a stub that pretends to sync.
- **Production seal()** (CF-C7-CUSTODY-PROOF-1): HELD, Founder-gated, unchanged.
- **Live provider round-trip** of the token exchange: requires Founder dashboard config + real consent;
  verified mechanically via a mock/fixture token-exchange seam. Exact redirect URIs handed off below.

## Decision: ADVANCE → Stage 2 (Architect plan).
