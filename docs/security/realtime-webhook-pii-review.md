# Security Review — Real-time Shopify Webhook Ingestion (DPDP / PII)

**Reviewer:** Shreya (security-reviewer) · **Stage:** 4 · **Mode:** FULL
**Scope:** S2.4 / real-time webhook epic (merged to development)
**Verdict:** **APPROVED-WITH-CONDITIONS**
**VETO-level violations:** None. The raw DDL is HOLD-AT-CUTOVER (not live), so no
finding is a violation of currently-running code. Conditions below become blockers
if Stage-8 live apply is attempted without them.

## Finding summary

| Severity | Count |
|---|---|
| CRITICAL | 0 |
| HIGH | 1 — Kafka envelope `payload` carries raw PII (email/first_name/last_name) to every consumer of `integrations.shopify.v1` |
| MED | 2 — (1) FORCE RLS deferred to Stage-8 step-b-force; (2) DDL/adapter drift: `tags`/`total_price_raw` declared but never populated |
| LOW | 2 — (1) module-level `assert isinstance` (Bandit B101, stripped under `-O`); (2) PII double-stored (columns + `raw_payload` JSONB) — erasure must cover both |
| INFO | 1 — `normalize()` deliberately extracts only first/last name from `billing_address` (city/zip/street suppressed) — correct minimisation; document it |

## Per-point findings

1. **Consent columns (CF-C3-CONSENT-COLUMN-1): PASS.** `raw_shopify_orders` carries `workspace_id`/`lawful_basis`/`purpose_code` NOT NULL with CHECK enums + `ingested_at` NOT NULL; `_upsert_event` stamps all four at write (ingestion clock, atomic). No backfill path.
2. **PII manifest coverage: PASS (LOW).** `email`/`first_name`/`last_name` all declared in `SHOPIFY_PII_MANIFEST` (owner_brand_controller / analytics_performance); `check_pii_fields` is genuinely fail-closed on both pull + push paths. LOW: a duplicate manifest exists (`shopify_adapter.py` vs `pii_manifest.py`) — currently in sync; consolidate to one authoritative instance.
3. **RLS on raw table: PASS for dev; condition for live.** `ENABLE ROW LEVEL SECURITY` + `ws_isolation` policy present, banned shapes (IS NULL/COALESCE/USING(true)) absent. FORCE RLS is held to Stage-8 `step-b-force.sql` — until then the table OWNER bypasses RLS (acceptable with no live PII). **S8-C1: apply step-b-force before live.**
4. **Minimisation — first_name/last_name as columns: APPROVED-WITH-CONDITIONS.** DPDP-defensible: owner_brand_controller basis, analytics_performance purpose, already present in `raw_payload`, and column-form *aids* Right-to-Erasure (§12) targeting. The residual risk is the `raw_payload` JSONB, which carries the **full** `billing_address` (street/city/zip) — beyond the "full address never" rule. **S8-C3: erasure runbook must scrub the JSONB (incl. `billing_address.address1`), not just the columns.**
5. **NEVERLOG: PASS.** All webhook/intake/servicer log lines emit only ids/outcomes/exception-types; raw body + buyer name/email/address never formatted into a log string. `external_identity` (shop domain) is logged — not customer PII, acceptable.
6. **BRAIN_ENV=local residency escape: PASS.** Activates only for exact `BRAIN_ENV=local`; default/unset/typo/staging/production all run the full ap-south-1 check and refuse-to-start. **S8-C4: add a STEP-0 runbook gate confirming `BRAIN_ENV` is unset/`production` in the deployed pod** (string check, so a deploy misconfig is the only risk — LOW).

## HIGH — Kafka envelope carries raw PII

`ingest.py` serializes the full `event.columns` (incl. email/first_name/last_name + `raw_payload`) into the `integrations.shopify.v1` envelope `payload`. Every consumer of that topic receives buyer PII; broker retention holds it at rest. Not a DPDP violation per se (lawful_basis/purpose_code propagate), but it widens the blast radius. The facts consumer needs `raw_payload` (line-items + customer id) so this is an **envelope-minimisation design, not a quick strip**. Mitigated now by MSK TLS + at-rest encryption + short retention + lineage. **S8-C2.**

## Conditions before Stage-8 live apply

| # | Condition | Severity if missed |
|---|---|---|
| S8-C1 | Apply `step-b-force.sql` (FORCE RLS) at runbook Step 5 after the four pre-conditions. | HIGH |
| S8-C2 | Add `integrations.shopify.v1` to the PII data catalog + lineage; document retention vs the 5-year raw window. | HIGH |
| S8-C3 | DPDP erasure runbook covers columns + `raw_payload` JSONB (incl. embedded address) + Kafka log for the workspace/customer. | HIGH |
| S8-C4 | `BRAIN_ENV` unset/`production` in prod pods — named STEP-0 runbook gate. | MED |
| S8-C5 | Resolve DDL/adapter drift on `tags`/`total_price_raw` (remove or annotate reserved). | MED |
| S8-C6 | Consolidate duplicate `SHOPIFY_PII_MANIFEST`/`SHOPIFY_MANIFEST` to one authoritative instance. | LOW |

## Verification validity (O11)

Both DB-backed integration probes are genuine negative controls: `test_cross_workspace_read_returns_zero` runs under a NON-BYPASSRLS role (asserts 0 cross-tenant rows); `test_undeclared_pii_rejected_before_db_write` asserts `PiiManifestViolation` + 0 rows upserted. No inert/bypass-green tests found.

---
*Builder follow-ups (Maya/ingestion): HIGH (Kafka PII lineage + erasure) and MED items. Conditions S8-C1..C6 are Stage-8 runbook/Founder gates, not local-demo blockers.*
