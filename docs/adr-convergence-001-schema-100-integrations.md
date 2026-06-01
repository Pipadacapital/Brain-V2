# ADR-CONVERGENCE-001 — Schema Foundation Review for 100+ Integrations

**Author:** Aryan (Architect) · **Date:** 2026-06-02 · **Status:** BINDING
**Method:** 5 expert personas (integration-platform, ClickHouse-at-scale, Postgres/multi-tenant-evolution, commerce/identity domain, data-correctness/governance) → architect synthesis. Commissioned by the Founder.

## Headline verdict
**The foundational model is SOUND for 100+ integrations. No re-foundation required.** The three load-bearing decisions are correct: (1) generic `connector_raw_events` landing → typed-fact graduation; (2) vendor-discriminator generic fact model (NOT per-vendor tables); (3) OLTP-hot-subset / OLAP-full split. The legacy per-vendor-table model was the anti-pattern; the migration is converting it to the scalable model. The findings are **single-source-of-truth gaps + correctness bugs on a correct skeleton** — all bounded fixes, not architecture flaws.

Two binding conditions on that verdict:
- **C1 — Single-source the PG↔CH fact schema before integration #8.** Hand-maintained dual DDL is already wrong at 7 vendors; it will not survive 100.
- **C2 — The missing India archetypes are a Founder product-scope decision** (the model accommodates them; whether to build is positioning).

## Binding per-issue rulings
| # | Issue | Ruling | Pri | Design | Owner | Escalate |
|---|---|---|---|---|---|---|
| A | `net_sales_mu` double-subtracts tax (`phase8:37`) | FIX-NOW | P0 | `net_sales = gross − discount − returns` (NO tax; tax at `net_net_tax`). Match the registry (canonical). | Maya | — |
| B | `raw_events` mutable `transform_status` on append-only CH | FIX-NOW | P0 | raw_events → append-only `MergeTree`; transform cursor → PG table. | Maya+Vikram | — |
| C | 90-day purge drops long-lifecycle COD/disputed webhooks | FIX-NOW | P0 | Status-gated purge (keep open/unfulfilled/disputed) + dead-letter 0-row webhook updates. | Vikram | — |
| 2 | PG↔CH fact column drift | FIX-NOW (CI gate) / P1 (codegen) | P0 | Canonical fact-schema registry (YAML→proto) declaring per-store projection; CI drift test now; DDL codegen P1. | Maya+Vikram | — |
| 1 | PG `vendor` ENUM vs TEXT | FIX-NOW | P1 | `vendor TEXT REFERENCES connector_definitions(vendor)` (registry vendor = TEXT PK). Additive swap, drop enum. | Vikram | Rohan (contract) |
| D | RMT `version` = 1s resolution | FIX-NOW | P1 | `version = toUnixTimestamp64Milli(...)` / vendor `updated_at`. | Maya | — |
| E | FINAL not enforced (comment only) | FIX-NOW | P1 | Auto-append FINAL at BOTH TS + Python CH gateways. | Maya+Vikram | — |
| F | TS subunit table ⊂ Python (OMR/TND/VND/…) | FIX-NOW | P1 | One canonical ISO-4217 subunit source + CI parity. | Vikram+Maya | — |
| G | No FX normalization before CM waterfall | FIX-NOW guard / P2 full | P1 | Block/flag multi-currency workspaces from CM now; daily-FX write path P2 (scale-gated). | Maya | Founder (P2 timing) |
| I | `daily_metrics_computed` MV un-applied + duality no sunset | FIX-NOW clarify / P1 | P1 | MV is RUNBOOK-GATED (not "failed") — apply via runbook + double-fire guard; define legacy-vs-base parity sunset gate. | Maya | Rohan (sunset) |
| 3 | New archetypes need new tables | DEFER tables / FIX-NOW protocol | P1 | Add required `archetype` field to connector_definitions; raw→typed graduation rule; grants via `ALTER DEFAULT PRIVILEGES` (not static list). | Vikram | — |
| 4 | Cross-vendor customer identity | DEFER graph / FIX-NOW cols | P1 | Add `phone_hash`/`email_hash`/`identity_cluster_id` to customer_pii now; single-vendor-filter cohort/LTV for multi-ecom workspaces. | Vikram+Maya | — |
| 5 | CH sharding seam inactive | ACCEPT defer / DESIGN-NOW | P2 | `Replicated*MergeTree` from day one; `PREWHERE workspace_id`; Distributed = workspace-scoped-only. | Maya+Jatin | — |
| J | Missing India archetypes (settlement, marketplace-fee, returns-first-class, inventory ledger, COD-remittance) | DEFER build / DECIDE scope | P0-product | Model accommodates all; building = product-surface expansion. | **Founder** | **Founder** |

## In-flight migration triage (the ETL running now)
- **A (net_sales double-tax) — migrated CH order data is WRONG.** Action: halt the order backfill, fix `phase8:37` (drop `- total_tax_mu`), bump version→ms, **rerun the ORDER step only** (RMT version-collapse fixes it). Other steps unaffected — let finish.
- **H (customer_ref .slice(0,32))** — NOT broken (ACL + phase9 truncate identically → joins work). Forward-fix to full sha256; no migration patch.
- **Refund** — phase8 maps `subtotal_mu`→`refund_amount_mu` POSITIONALLY → correct; add the canonical-name CI test to prevent the name-based variant.

## Prioritized roadmap
- **P0 (now, correctness + migration):** P0-1 migration triage (A); P0-2 raw_events append-only + PG cursor (B); P0-3 status-gated purge + dead-letter (C); P0-4 canonical-fact CI drift test + refund-name + subunit parity (2, F).
- **P1 (pre-100-integration hardening):** vendor ENUM→TEXT+FK + ALTER DEFAULT PRIVILEGES grants + archetype field (1, 3); FINAL auto-enforce + PREWHERE (E, 5); customer_pii identity cols + cohort guard (4); fact-schema codegen + MV apply/sunset (2, I); multi-currency CM guard (G).
- **P2 (scale/triggered):** Replicated engine activation; FX write path; identity graph.
- **Product-gated (Founder):** settlement / marketplace-fee / returns-first-class / inventory-ledger / COD-remittance archetypes (J).

## ADRs to record
1. vendor discriminator = TEXT + connector_definitions FK (supersedes enum).
2. canonical fact-schema single-sourcing (one registry → per-store DDL + CI drift gate).
3. connector_raw_events append-only; transform cursor in PG.
4. status-gated retention for long-lifecycle India orders.
5. `net_sales` canonical = gross − discount − returns (tax excluded until net_net_tax); ETL must match the registry, never re-derive.
6. Replicated-engine-from-day-one for ClickHouse.

## Escalations
- **Founder (product scope):** J — marketplace-fee + payment-settlement archetypes expand the product surface (new vendor classes Razorpay/Cashfree/Amazon/Flipkart/Meesho; TDS/TCS reconciliation = India moat depth). Go/scope/sequence is a positioning call, not architecture. Also G P2 FX timing.
- **Rohan (CTOA gates):** vendor ENUM→TEXT changes a typed contract (additive/reversible) — wants sign-off; legacy_aggregates sunset criterion is a parity-gate contract; confirm these migrations don't regress the Child-1 RLS work (OPEN-P0 overhang).
- **Destructive ops (reversible):** dropping the enum (1) + rerunning the order backfill (A). No data loss.
