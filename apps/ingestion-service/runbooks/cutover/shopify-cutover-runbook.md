# Shopify Connector Cutover Runbook

> **HOLD-AT-CUTOVER — Stage-8 artifact. DO NOT EXECUTE in a normal pipeline run.**
>
> This runbook is executed ONE connector at a time, Shopify first (lowest risk), Shiprocket LAST.
> Requires the Founder at the console + the A4 rollback tree armed.
> CF-C3-SHOPIFY-ENDPOINT-ATOMIC-1, CF-C3-ROLLBACK-CRED-WINDOW-1, CF-C3-DELETE-SEQUENCE-1.

## Pre-conditions (must ALL be true before starting)

- [ ] Founder Secrets Option A or B decision is on record in the run folder
- [ ] `ALLOWED_WORKSPACE_IDS` is set and verified to contain only Sugandh-Lok workspace ID
- [ ] `SHOPIFY_CLIENT_SECRET` (app-level HMAC secret) is present in Brain's env
- [ ] Brain webhook endpoint is RESPONSIVE and returning 200 (test with a synthetic payload)
- [ ] HMAC verification passes for a synthetic Shopify payload (verify_shopify_hmac test)
- [ ] `DIRECT_URL` and `DATABASE_URL` both target ap-south-1 (startup gate GREEN)
- [ ] No known festival traffic window in the next 48h (CF-C3-NO-CUTOVER-AT-FESTIVAL-1)
- [ ] ≥2 engineers present (Founder + one other)

---

## Rollback window: 4 hours

Per CF-C3-PER-CONNECTOR-N-1 (M-A5-Q3): Shopify rollback window = 4h.
Within the 4h window, count-parity is verified. Shopify has 60-day order-API backfill
(ReplayCapability.FULL_60D) so atomic cutover ≠ irreversible.

---

## STEP 0 — Startup gates GREEN

```bash
# Verify startup gates pass
INTEGRATION_TEST=1 pytest tests/unit/test_startup_gates.py -v
```

Expected: all gates PASS. The ingestion-service startup gate (run_all_gates) must
return green before proceeding.

---

## STEP 0.5 — Real-pooler integration test (Option A gap-closer)

> This is the mandatory real-pooler integration test per §A0.1 (Option A).
> Proves a Python service can connect to the real Supabase :6543 pooler AND
> :5432 direct, execute set_config('app.workspace_id', ..., true), and SELECT 1.

```bash
# Requires DIRECT_URL and DATABASE_URL pointing to live Supabase ap-south-1
python -c "
import asyncio, os
from src.infrastructure.db.session_context import with_workspace

async def probe(conn):
    row = await conn.fetchone('SELECT 1 AS ok')
    print('Pooler probe: ok =', row['ok'])
    return row['ok']

asyncio.run(with_workspace(os.environ['TEST_WORKSPACE_ID'], probe))
print('STEP 0.5 PASS')
"
```

Expected: `STEP 0.5 PASS`. If it fails → ABORT. Do not proceed.

---

## STEP 1 — Write Shopify credential to custody

```bash
# Founder runs: write the Shopify OAuth access token for the shop to CredentialCustody
# Option A: via AWS Secrets Manager put()
# Option B: via Supabase column put()
# The specific script depends on the Founder's Option A/B decision.
echo "Write credential for shop_domain=${SHOP_DOMAIN} workspace=${WORKSPACE_ID}"
# python scripts/write_shopify_credential.py --workspace-id $WORKSPACE_ID --shop-domain $SHOP_DOMAIN
```

> NOTE: Shopify HMAC secret (`SHOPIFY_CLIENT_SECRET`) is the app-level secret, NOT a per-brand OAuth token.
> It must be present in Brain's environment BEFORE any webhook arrives.
> This STEP covers per-brand OAuth tokens (per-shop access_token).

---

## STEP 2 — Live HTTP round-trip auth test

```bash
# Verify Brain can authenticate to Shopify using the credential from custody
# This is a READ-ONLY probe — fetch 1 order to prove auth works
# python scripts/probe_shopify_auth.py --workspace-id $WORKSPACE_ID --shop-domain $SHOP_DOMAIN
```

**If STEP 2 FAILS: ABORT. Credential still in legacy. No token has moved. No restore needed.**
The A4 rollback branch sits BEFORE the delete (CF-C3-ROLLBACK-CRED-WINDOW-1).

---

## STEP 3 — Atomic webhook re-registration (all shops × 14 topics)

> CF-C3-SHOPIFY-ENDPOINT-ATOMIC-1: Shopify cutover is ALL-SHOPS-ATOMIC.
> One shared callbackUrl — all shops must be re-registered at once.
> Rate limit: 2 mutations/sec/shop.

```bash
# Bulk webhookSubscriptionCreate across ALL connected shops × 14 topics
# Topics: orders/create, orders/updated, orders/paid, orders/fulfilled,
#         orders/cancelled, refunds/create, products/create, products/update,
#         products/delete, customers/create, customers/update, shop/update,
#         app/uninstalled, fulfillments/create
#
# Rate-limited script (2/sec/shop):
# python scripts/shopify_bulk_register_webhooks.py \
#   --workspace-id $WORKSPACE_ID \
#   --brain-callback-url https://brain.pipadacapital.com/webhooks/shopify \
#   --rate-limit 2
```

**Rollback (if STEP 3 fails mid-flight):**
```bash
# Run the reverse script: re-register ALL shops back to legacy endpoint
# python scripts/shopify_bulk_register_webhooks.py \
#   --workspace-id $WORKSPACE_ID \
#   --brain-callback-url https://legacy.pipadacapital.com/api/webhooks/shopify \
#   --rate-limit 2
```

---

## STEP 4 — First Brain ingest (backfill days=7)

```bash
# Run ingest_batch for Shopify with a 7-day backfill window
# python scripts/run_ingest.py \
#   --vendor shopify \
#   --workspace-id $WORKSPACE_ID \
#   --days 7
```

Expected: IngestResult.events_received > 0, events_upserted > 0.

---

## STEP 5 — Count-parity + field spot-check (within 4h window)

```bash
# Run the parity harness against the live Brain raw store vs legacy counts
# CF-C3-PARITY-COUNT-1: count-based + field spot-check ONLY (no numeric shadow)
INTEGRATION_TEST=1 pytest tests/parity/ -v -k shopify
```

**If parity FAILS within 4h window → ROLLBACK:**
1. Re-register legacy webhooks (STEP 3 reverse script)
2. Use 60-day order-API backfill to fill any event gap
3. Document the gap window

---

## STEP 6 — Seal / delete legacy plaintext (LAST STEP, AFTER parity confirmed)

> CF-C3-ROLLBACK-CRED-WINDOW-1 / CF-C3-DELETE-SEQUENCE-1:
> Legacy plaintext is SEALED (not deleted) until parity sustained + window N elapsed.
> THEN call custody.seal() to delete/encrypt-in-place.

```bash
# Call seal() on the CredentialCustody backing
# python scripts/seal_credential.py --workspace-id $WORKSPACE_ID --vendor shopify
```

**This is irreversible.** Ensure parity has been sustained for the full 4h window
and both Founder + CTOA have signed off before running STEP 6.

---

## A4 Rollback tree (ARMED — from Child-0 §A4-LOCAL)

```
STEP 2 live auth test FAILS
  → ABORT (cred still in legacy, no token moved, no restore needed)

STEP 5 parity FAILS within 4h window
  → restore legacy Shopify webhook (all-shops bulk reverse, STEP 3 rollback script)
  → use 60-day order-API backfill to fill event gap
  → document gap window
  → DO NOT run STEP 6 (cred still in legacy)

Legacy plaintext SEALED only after parity sustained + 4h window elapsed
  → THEN run STEP 6 (delete/seal)
```

---

## Festival / allowlist constraints

- CF-C3-NO-CUTOVER-AT-FESTIVAL-1: NO cutover during known festival windows
  (Diwali, Holi, New Year, major sale events — RTO/COD volume amplifies data-loss window).
- CF-C3-WORKSPACE-ALLOWLIST-1: Sugandh-Lok only until WS-2 governance fires (CF-SEC-3).
