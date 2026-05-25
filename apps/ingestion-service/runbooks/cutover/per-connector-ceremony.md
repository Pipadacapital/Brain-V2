# Per-Connector Cutover Ceremony — HOLD-AT-CUTOVER State

> **Stage-8 artifact. DO NOT EXECUTE in a normal pipeline run.**
>
> CF-C3-HOLD-AT-CUTOVER-1: live per-connector token transfer + webhook re-registration
> + legacy-plaintext-delete DEFERRED to this Stage-8 gated ceremony.
> One connector at a time, lowest-risk first, Shiprocket LAST.
> Requires Founder at the console + A4 rollback tree armed.

---

## Connector sequencing (risk order)

| Order | Vendor | Rollback window | Replay | Notes |
|-------|--------|----------------|--------|-------|
| 1 | Shopify | 4h | FULL_60D | All-shops-atomic; see shopify-cutover-runbook.md |
| 2 | WooCommerce | 4h | FULL_60D | Similar to Shopify |
| 3 | Klaviyo | 12h | PARTIAL | Aggregates only; no individual PII |
| 4 | Unicommerce | 12h | PARTIAL | Catalog sync |
| 5 | Meta | 8h (+48h attr) | WINDOW | 48h attribution re-validation (CF-C3-META-GOOGLE-ATTRIBUTION-WINDOW-1) |
| 6 | Google | 8h (+48h attr) | WINDOW | Same as Meta |
| **7** | **Shiprocket** | **72h + ≥2-week pre-shadow** | **NONE** | **HIGHEST RISK — sequenced LAST** |

---

## Shared ceremony steps (all connectors)

```
STEP 0   Startup gates GREEN (residency assert + workspace allowlist)
STEP 0.5 Real-pooler integration test (MANDATORY — Option A gap-closer per §A0.1)
STEP 1   Write credential to custody (CredentialCustody.put())
STEP 2   Live HTTP round-trip auth test (vendor API probe — READ-ONLY)
           ↳ FAIL → ABORT (cred still in legacy, no token moved)
STEP 3   Token transfer / webhook re-registration
           Shopify: bulk webhookSubscriptionCreate all shops × 14 topics
           Shiprocket: disable legacy syncAllShiprocket cron
STEP 4   First Brain ingest (days=7 for backfill)
STEP 5   Count-parity + field spot-check within window N
           ↳ FAIL → rollback (STEP 3 reverse + backfill gap from API where available)
STEP 6   Seal / delete legacy plaintext (LAST — AFTER parity sustained)
           CredentialCustody.seal()
```

**STEP 6 is IRREVERSIBLE for Shiprocket** (`email/password` pair — no Shiprocket-side regeneration).
For all other vendors, STEP 6 is reversible via vendor key rotation.

---

## Shiprocket-specific notes (CF-C3-SHIPROCKET-POLL-MODEL-1)

Shiprocket is a **polling connector, NOT a webhook connector**.
There is NO event replay (ReplayCapability.NONE).

```
STEP 3 (Shiprocket):
  → disable legacy syncAllShiprocket cron (verify no legacy Shiprocket cron scheduled)
  → verify the legacy cron is NOT running (grep scheduled jobs)
  → Brain first poll: ingest_batch(days=7) — covers the polling gap
STEP 5 (Shiprocket):
  → shipment-count parity within 72h window
  → ≥2-week pre-shadow recommended before cutover
Rollback window: 72h (accept documented gap OR extend shadow period)
```

**Shiprocket MUST be the last connector** because:
- No replay: a botched cutover loses events permanently
- `email/password` credentials are unrecoverable once sealed (no vendor reset flow)
- Sequencing last lets all other connectors prove the framework reliable first

---

## Meta / Google attribution window (CF-C3-META-GOOGLE-ATTRIBUTION-WINDOW-1)

```
First Brain cron: ingest_batch(days=7)
Parity window: 8h for COUNT parity only
48h re-validation window: spend-sum is NOT a hard rollback trigger within 48h of cutover
  (24-48h attribution finalization delay — incomplete data is expected)
After 48h: spend-sum divergence IS a rollback trigger
```

---

## Festival / cutover scheduling constraint (CF-C3-NO-CUTOVER-AT-FESTIVAL-1)

DO NOT schedule any connector cutover during:
- Diwali (October/November)
- Holi (March)
- New Year (December 31 – January 1)
- Major sale events (Big Billion Days, Great Indian Festival, etc.)
- IPL season peak traffic windows

RTO/COD volume amplifies the data-loss window for Shiprocket.

---

## Credential-custody delete sequence (CF-C3-ROLLBACK-CRED-WINDOW-1 + CF-C3-DELETE-SEQUENCE-1)

```
write to custody (STEP 1)
  → live HTTP auth test passes (STEP 2)
  → parity confirmed within window N (STEP 5)
  → THEN seal/delete legacy plaintext (STEP 6)

A4 rollback branches BEFORE the delete:
  failed auth test = abort (cred still in legacy, no restore needed)
  failed parity within window = rollback STEP 3 (token flip only; cred still in both)
  ONLY AFTER parity sustained = STEP 6 seal
```

---

## Workspace allowlist for this ceremony

Before starting any connector cutover, verify:
```bash
echo $ALLOWED_WORKSPACE_IDS  # must contain Sugandh-Lok workspace ID only
```

CF-C3-WORKSPACE-ALLOWLIST-1: Sugandh-Lok-only until WS-2 governance fires.
CF-SEC-3 re-fires before any second workspace's PII enters prod.
