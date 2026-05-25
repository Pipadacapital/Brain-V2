# Stage 4 — Security Review (Shreya) — Slice E: connector data ingestion

**Verdict:** PASS (no CRITICAL/HIGH). Slice E is READ-only external pull + local SQL persistence.

## Threat surfaces reviewed (high-stakes: connectors, PII, multi-tenancy, secrets, residency)

| # | Surface | Finding | Disposition |
|---|---------|---------|-------------|
| S1 | **Token at use** | The custody token is read inside `syncConnector` and passed to the fetch seam as a request header only. NO `console.*` in any slice-E product file; NO `access_token`/`refresh_token`/`.content`/`credential_enc` in any log/return/throw (grep gate PASS). The sync result returns COUNTS only. | PASS — token never logged/echoed (P-006 proven; integration test asserts no token substring in output). |
| S2 | **Multi-tenancy (RLS)** | All 4 new fact tables ENABLE + FORCE RLS with the workspace-leading `ws_isolation` policy (slice-C/D shape). Context-less read = 0 rows (proven at the wire). Each workspace reads ONLY its own facts (wsA=1, wsB=1). No superadmin policy on fact tables (workspace-only) → even withSuperadmin = 0 (stronger). | PASS (P-003 proven). |
| S3 | **PII minimization (DPDP)** | The canonical order FACT stores NO email/name/full-address/phone — only an opaque `customer_ref` (sha256 of vendor customer id) + pincode/city (India RTO metric need). Raw PII stays in the slice-D/Child-3 raw landing under the PII manifest. Unit test asserts no email/raw-customer-id on the fact. | PASS — minimized to the metric need. |
| S4 | **NO outbound channel** | Every provider call is a READ (GraphQL query / insights GET / GAQL). NO send/post/dispatch to any provider or customer. NO DLT/NCPR/9am-9pm/WhatsApp surface. The live fetch impl is documented READ-only. | PASS — no telecom/compliance-send surface (no `/escalate` trigger). |
| S5 | **Idempotency / no double-count** | Every fact table keyed on a UNIQUE business key; UPSERT ON CONFLICT DO UPDATE. Re-sync → aggregate numbers byte-identical (P-002 proven at the analytics layer). | PASS. |
| S6 | **Error hygiene** | `syncConnector` returns a GENERIC error on failure ("Connector sync failed."); the provider body / token is never surfaced (P-007: a forced fetch error carrying a fake token did NOT leak it). last_sync_at unchanged on failure (no dishonest "synced"). | PASS. |
| S7 | **Secrets at rest** | No new secret introduced; reuses slice-D custody (AES-256-GCM). Real `.env` (both apps) git-ignored + untracked (check-ignore proven at S1 and re-proven at S5). `.env.example` names only. Production custody seal() remains HELD (CF-C7-CUSTODY-PROOF-1, unchanged). | PASS. |
| S8 | **SQL injection** | All fact UPSERTs use parameterized `$1..$n` placeholders; no string interpolation of user/vendor data into SQL. The CANCELLED predicate is a static const. | PASS. |
| S9 | **Role enforcement** | `connectors.sync` requires MANAGER (config-class action, mirrors slice-D initiate); enforced at the gateway before any core-service call. | PASS. |

## Residency note
Local dev → local Postgres now; ap-south-1 in production (carried forward from slices C/D). The live shared
Supabase production DB is UNTOUCHED by slice E (all writes go to the local dev DB). Stated.

## Verdict
**PASS — no CRITICAL/HIGH/MED open.** READ-only, RLS fail-closed, idempotent, token-safe, PII-minimized.
