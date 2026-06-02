# Real-time ingestion — design + build plan

**Goal:** move from click-to-sync (batch pull) to real-time, event-driven ingestion —
new data from an external source lands in Brain (and the dashboard) as it happens.

**Decisions (Founder, 2026-06):** full event-driven · prove end-to-end on local-dev ·
intake feeds facts via a true event bus (Redpanda/Kafka).

## What already existed (connector-webhook-intake, Stage-8, held)

- `POST /webhooks/:vendor` gateway receiver (rate-limited, body-capped) — **held** behind
  an unregistered plugin in `server.ts`.
- Verify-first HMAC state machine (default-deny) → forwards byte-identical over gRPC to the
  Python ingestion-service (`WebhookIngestService.ReceiveWebhook`).
- Identity resolution (`connector_identity_map`: `(vendor, external_identity) → workspace_id`).
- `receive_webhook` lands the event in `raw_shopify_orders` (idempotent on
  `(workspace_id, vendor_event_id)`) and **produces to Kafka** `integrations.{vendor}.v1`.

## The gap this feature closes (from the code trace)

1. The local dashboard reads **ClickHouse first** (`READ_FROM_CH=true`), PG only on CH error —
   so a PG-only write is invisible.
2. **Nothing in app code writes CH facts** at runtime — only the one-time backfill migration.
   (So even click-to-sync doesn't refresh the local dashboard.)
3. The Python ingestion-service has **no ClickHouse client**; the fact-mapping + CH client both
   live in **TS core-service**.
4. **No Kafka broker** in the local stack — `_produce_kafka` is currently a no-op locally.

## Architecture (target)

```
Shopify ──HTTP(HMAC)──▶ gateway POST /webhooks/shopify ──gRPC──▶ ingestion-service
  (verify-first, default-deny)                                     │
                                                                   ├─▶ raw_shopify_orders (PG, idempotent)
                                                                   └─▶ Kafka  integrations.shopify.v1
                                                                                       │
                                              ┌────────────────────────────────────────┘
                                              ▼
                         NEW: core-service Kafka consumer (TS)  ── single fact writer ──▶
                              · PG  connector_order_facts / connector_line_item_facts
                              · CH  brain.connector_order_facts / brain.connector_line_item_facts
                              (idempotent upsert; CH version = unix(synced_at))
                                              │
                                              ▼
                                   dashboard (reads CH-first) shows the order in real time
```

The TS consumer is the single runtime writer of facts for the event path — it also fixes
gap #2 (the pull path can later route through the same writer to stay CH-fresh).

## Build steps (each independently verifiable)

- **S1 — Event-bus + identity foundation.** Add Redpanda to local compose; wire
  `KAFKA_BOOTSTRAP_SERVERS` into ingestion + core; add `connector_identity_map` as a tracked
  local migration + seed the Sugandhlok shop domain. *Verify:* broker up, table seeded.
- **S2 — Activate webhook intake (local).** Register the held webhook plugin behind
  `BRAIN_WEBHOOKS_ENABLED` (prod stays gated); wire the gRPC target + a local Shopify HMAC
  secret; wire a real Kafka producer into the servicer path. *Verify:* signed `orders/create`
  → 200 → row in `raw_shopify_orders` + message on `integrations.shopify.v1`.
- **S3 — TS Kafka→facts consumer.** New core-service consumer of `integrations.shopify.v1`:
  map envelope payload → `OrderFact`/`LineItemFact` (reuse the pull-path mapping) → upsert PG
  (`upsertOrder`/`upsertLineItem`) **and** CH (mirror `phase8-ch-backfill` columns). Idempotent.
  *Verify:* produce an event → facts in PG + CH.
- **S4 — End-to-end demo + tests.** Signed webhook → order visible in the dashboard read path.
  Tests: consumer mapping, idempotency (re-delivery = no-op/version-bump), HMAC verify.
- **S5 — Ads near-real-time polling (separate slice).** Scheduler periodically runs
  `syncConnector` for META/GOOGLE per connected workspace (their APIs can't push). Honestly
  labelled "polled every N min". Also fills the "no scheduler today" gap.

## Production note (out of scope for the local demo, Founder/Stage-8 gated)

Live go-live still needs: public webhook ingress, seeding `connector_identity_map` for real
shops, registering webhooks in the Shopify Partner portal, Kafka/MSK in prod, and HMAC-secret
custody. The local build proves the full flow without those ceremonies.
