# CTO Advisor Review — Stage 1 (intake)

| Field | Value |
|-------|-------|
| **req_id** | `epic-warehouse-medallion-wiring` |
| **Stage** | 1 |
| **Timestamp** | 2026-06-05T00:00:00Z |
| **Decision** | **ADVANCE — proceed with changes bound below** |

---

## Context note on prior workflow

The architecture proposal (`docs/data-warehouse-architecture-proposal.md`) and implementation plan (`docs/data-warehouse-implementation-plan.md`) were produced by a 28-agent review→research→brainstorm→judge→completeness workflow. This is materially more rigorous than a normal Stage-1 persona pass. I treat R1–R12 (the completeness resolutions), the per-gap G1–G6 resolutions, and the seven confirmed decision defaults (Q1–Q7) as the substantive persona analysis. My job here is the independent adversarial audit — not to repeat what 28 agents already covered.

---

## Made it less dumb first

**Could delete:**
- Any attempt to evaluate the stack. The spine (CH + PG, Kafka) is locked per ADR-CONVERGENCE-001 and the locked canon. The 28-agent workflow's candidate ranking correctly landed on Medallion-on-ClickHouse as the only compliant option.
- Any per-vendor transform consumer. The transform registry (`(vendor, event_type) → mapper`) is the Single-Primitive — adding vendor #2 = a registry row + a mapper, never a new consumer.
- Any Airbyte buy (rated 3.5/10 in the candidate ranking, violates the moat argument, correctly rejected).

**Could simplify:**
- The erasure orchestrator (P0-D) ships PG + bronze + S3 tiers without waiting for the P1-A codegen MV manifest. The plan already does this correctly — but the sequencing must be explicit in the build gate (P0-D's MV fan-out tier is completion work at P1-F, not a blocker on P0-D's core three tiers).
- The bronze BACKUP cron stopgap (R7) is a 1-day task; it should start on day zero of P0-C, not after P0-C is "done." The plan says this but it needs to be a hard acceptance criterion, not a note.

**Could defer:**
- Glue Schema Registry + Avro + BACKWARD CI gate — correctly deferred to integration #5 / 2nd-consumer trigger (Q7). No further deferral possible beyond that trigger.
- Probabilistic identity (Splink) — correctly deferred as opt-in, separately-scored, reversible. Good call; one false-positive edge permanently over-merges.

---

## Substantive challenges (anti-blind-agreement — the point of intake)

### Challenge 1: Should the two DPDP gates (P0-B and P0-D) be a fast-tracked mini-epic, separate from the 11-slice warehouse epic?

**The concern:** P0-B (PII tokenizer + `customer_ref`) and P0-D (erasure orchestrator) are DPDP prerequisites that could close the live-PII risk in isolation from the warehouse wiring. Today, with live data in `brain_dev` and the open P0 of zero RLS on the live Supabase, every day without a PII tokenizer at the chokepoint is a day the envelope carries raw PII on Kafka. This is the highest-likelihood, highest-impact risk on the board. A 4-slice DPDP mini-epic (P0-A → P0-B → P0-D → P0-R6) could ship in 2–3 weeks and close the live-PII exposure entirely, independently of whether the transform worker and identity stitcher land.

**My disposition:** BIND AS A CHANGE. Do not split into a separate epic — the run overhead is not worth it, and the DPDP gates are already the dependency root of the plan's critical path. But bind a structural rule: **P0-B and P0-D are MANDATORY FIRST MILESTONES; no P1 slice may be handed to the builder until both P0-B and P0-D have cleared Stage-4 (Security) review**. The Shreya VETO on P0-B and P0-D is not just a Stage-4 gate — it is the literal unlock condition for any P1 work. This is a stronger sequencing constraint than the plan currently states. Record it in the `build_gated_on` field of the epic's active.json entry.

### Challenge 2: Is P1-B (the transform worker, the keystone) the real long pole, and should it start in shadow mode earlier than the plan implies?

**The concern:** The critical path is `P0-A → P0-B → P0-C → P1-D → P1-B → P1-E`. P1-B is the longest-effort item (@maya, L-effort) and the only component that makes "new integration = registry row + mapper" true. The plan says it "must ship before integration #2" but does not force P1-B into shadow mode alongside P0-C. There is a window where P0-C has a bronze writer and P1-B does not exist — during this window, the silver layer still gets facts only from the preserved Shopify `realtime-facts-consumer.ts` path, not from the graduation worker. That bespoke path cannot be retired until P1-B shadow-parity is verified. If P1-B takes 3–4 weeks, the dual-write window (bronze + bespoke Shopify consumer both writing silver) extends that long, creating a reconciliation surface.

**My disposition:** BIND AS A CHANGE. P1-B's development should START in parallel with P0-C (flag it `TRANSFORM_GRADUATION_WORKER=OFF`, shadow-reads only, no cursor advance) so the build time overlaps with the P0-C → P1-D → S3-live sequence. The current plan's ordering puts P1-B at position #8 in the suggested build order, after P1-A (codegen). That is sequentially correct for the codegen-dependency on `raw_event_id` DDL, but the shadow-mode shell of the transform worker (the consumer + registry + cursor-read loop, no mappers yet) can start at P0-C + 1 day. Bind this as a plan amendment: **@maya begins the shadow-mode transform consumer shell in parallel with P0-C; the first mapper (Shopify order) is wired once P1-A codegen produces the `raw_event_id` DDL**.

### Challenge 3: The over-engineering audit — is 11 slices as one epic right for a 1-brand reality?

**The concern:** Brain currently has exactly 1 anchor customer (Sugandh Lok, ~83k orders) and is pre-revenue on the %-of-GMV model. The full 11-slice epic as designed is the right end state, but it assumes a team of 5+ concurrent builders (@maya, @vikram, @jatin, @ananya, @karan). In a 1-brand reality, identity stitching (P1-C) and the `email_hash`/`phone_hash` cross-vendor stitch have no second vendor to stitch against until integration #2 ships. The union-find (P1-C) produces a cluster graph where every customer is a singleton cluster — it does nothing useful until there are at least 2 vendor connections per workspace.

**My disposition:** REGISTER, DO NOT SPLIT. P1-C is the right architecture and it is cheap (Paradigm-1, SQL, ~₹0). The concern is not that it is over-engineered — it is not, the salted HMAC and per-workspace salt are needed even with 1 vendor to fix the bare SHA-256 cross-workspace collision. But **P1-C must not block P1-B or P1-E from closing the billing-correctness gap**. The dependency graph already shows P1-C and P1-E as parallel post-P1-B, so no change needed to the plan structure. Register this as: the P1-C acceptance criterion for the identity cluster is relaxed to "singleton cluster per customer with correct salt isolation" for Sugandh Lok until integration #2 ships; the test harness must cover the 2-vendor merge path in a mock but we do not block Stage-6 sign-off on a live 2-vendor stitch.

### Challenge 4: The transform-worker SPOF — the incident/on-call realist angle (a NET-NEW angle the 28-agent workflow did not fully close)

**The concern:** The proposal names the transform worker as "a new critical-path SPOF" and says it "needs lag alerting, retry/backoff, and DLQ." R5 and R11 provide the per-tenant circuit breaker and `transform_lag_seconds` CloudWatch metric. But there is a subtler SPOF: the PG cursor (`raw_event_transform_state`) is the durability boundary for "what has been graduated." If the PG primary goes down (RDS restart, failover, maintenance window), the transform worker cannot read or advance its cursor. During that window, Kafka offset advances — the consumer does NOT pause on PG failure — so when PG recovers, the worker re-reads bronze from the last cursor, but the Kafka consumer-group offset may have moved past the poisoned window. The plan does not specify whether the transform worker reads bronze from PG cursor OR Kafka consumer-group offset. If it uses Kafka offsets for the read-loop and PG cursor for the graduation checkpoint, a PG outage during a large batch could leave a gap.

**My disposition:** BIND AS A CHANGE. The plan (B7, P1-B task 1) says "reads bronze WHERE received_at > cursor (PG raw_event_transform_state)." This is CH-read driven, not Kafka-offset driven — which means a PG cursor outage stalls but does not corrupt (the transform worker simply pauses). But this must be made explicit in the acceptance criteria: **the transform worker's CH-read loop must fail-closed on PG cursor unavailability (no progress, no data loss) rather than advancing past the cursor without recording**. Add to P1-B acceptance criteria: test that a PG cursor table unavailability produces a logged stall (no bronze rows consumed without a cursor advance; no silent gap).

### Challenge 5: The billing-integrity realist angle — replay-vs-%-of-GMV is the highest-stakes correctness surface, and it is under-specified (a NET-NEW angle)

**The concern:** The proposal acknowledges "Replay double-counting" as a risk and states "ReplacingMergeTree dedup is eventual; make every fact sink keyed + idempotent, read with FINAL." This is the right architectural answer. But %-of-GMV billing is computed from `recompute_daily.py` → gold → KPIs. If a workspace replays 30 days of bronze (e.g., after a mapper bug fix), `recompute_daily.py` re-runs over re-derived silver for 30 days. During the re-derivation window (before FINAL collapses the ReplacingMergeTree versions), if billing reads gold before the dedup converges, the brand could be billed for 2x-3x GMV. The plan does not specify a "billing read is gated on silver freshness" mechanism.

**My disposition:** BIND AS A CHANGE. Add to P1-B acceptance criteria (the transform worker): a `silver_freshness{workspace_id, date}` metric is emitted indicating when silver graduation is complete for a given date partition. Gold recompute (`recompute_daily.py`) must gate on `silver_freshness` for any date being computed during a replay window. The billing surface must never read gold for a date whose silver is mid-replay. This is a 1-day add to P1-E (wire the gate) and a design-time constraint Aryan must spec at Stage 2. If this is not specified, the first mapper bug + replay = a billing integrity incident.

---

## Epic structure and gates decision

**Single epic, not split.** The 11 slices are interdependent enough that a separate DPDP mini-epic would have 90% of the same artifacts and coordination overhead. The DPDP gates are the first milestone within this epic.

**Mandatory build gates within the epic:**

1. **P0 exit gate (DPDP clearance):** PII-grep clean + COUNT=0 erasure artifact + bronze has a writer + Shiprocket is a data row + full-column drift gate green. **No P1 work begins until all P0 slices clear Stage-4 (Shreya VETO).**
2. **P1-B shadow-parity gate (Shopify path retirement):** transform worker shadow-diff == 0 over a soak period before the `realtime-facts-consumer.ts` bespoke path is retired. This is a hard sequencing gate — retiring the Shopify path prematurely is the highest-likelihood live-data corruption risk.
3. **Bronze single-copy window SLA (≤14 days):** P1-D (S3 BronzeStorageStack) must land within 14 days of P0-C. If not, `BRONZE_RAW_ARCHIVER` is feature-flagged OFF per R7. This is a hard calendar gate.
4. **Billing-freshness gate (new, from Challenge 5):** `silver_freshness{workspace_id, date}` metric must be live and gold recompute must gate on it before P1-E is considered Stage-6 complete.

**Escalation (held Stage-8 console ceremonies):** S3 bucket provisioning (`cdk deploy BronzeStorageStack`), KMS CMK creation, MSK graduation. These are NOT escalations for me — they are Founder-at-console ceremonies already defined in the plan. No `/escalate` is warranted now.

**One non-blocking Founder attention item:** the pre-bronze historical provenance question (R12, Q6 Option a vs b). The plan's default (Option a, legacy_etl marker) is the correct call for Day 1. But the billing-provenance implication — that the anchor customer's first 83k orders have no `raw_event_id` traceability — needs the Founder's eyes before Stage-8.

---

## Lane decision

- **feature_class:** `high-stakes`
- **feature_class_rationale:** Every trigger surface fires. Multi-tenancy (per-workspace erasure, per-workspace salt). Money (%-of-GMV billing correctness, replay double-count risk). PII (DPDP tokenization, erasure ladder). India-compliance (DPDP §12 gates, ap-south-1 residency assert). Connectors (the entire 100-integration surface). Schema-proto (canonical-facts codegen, Glue Registry deferred but scoped). Auth (KMS, per-workspace DEK). Outbound-channel (Morning Brief reads gold). No carve-out available.
- **trigger_surfaces_touched:** `["multi-tenancy", "money", "pii", "india-compliance", "connectors", "schema-proto", "auth", "outbound-channels"]`
- **Stages that will run:** 2 (Aryan, already done — plan is pre-built) → 3 (Maya/backend, Vikram/core, Jatin/CDK) → 4 (Shreya VETO on P0-B, P0-D, P1-C, P1-D, P0-A) → 5 (Tanvi VETO on P0-A, P1-B, P1-E) → 6 (Rohan final, cross-slice conformance) → 7 (Founder gate, delegated) → 8 (Founder-at-console: S3/KMS provisioning, MSK graduation, HELD).

---

## Paradigm recommendation

**Primary paradigm:** `sql` (+ io / event-handling + infra)

**Why:** the entire transform-graduation worker, identity stitcher (union-find), recompute_daily, and erasure orchestrator are Paradigm-1 SQL + IO. Zero LLM tokens per day on the warehouse wiring itself. The `@paradigm` decorator enforcement (P1-E) closes the gap where the runtime is built but undecorated. Transform mappers all carry `@paradigm("sql")`.

---

## India context check

| Lens | Impact |
|---|---|
| **DPDP / residency** | CRITICAL. This is the primary compliance surface. PII tokenizer (P0-B), erasure orchestrator (P0-D), ap-south-1 CDK residency assert (P1-D), crypto-shred per Q5 default. All three DPDP gates must clear Stage-4 before any live customer data enters the warehouse. |
| **RTO** | HIGH. RTO inputs are currently hard-coded to 0 in `recompute_daily.py`. P1-E closes this; True-CM2 is wrong on live data until P1-E ships. |
| **COD** | MEDIUM. COD flag propagates through the silver facts correctly today (it is in the silver schema); the issue is the missing shipment-fact graduation (P1-E), not the COD field itself. |
| **GST** | MEDIUM. Per-SKU GST is downstream of the vendor ENUM fix (P0-R6). Shiprocket's GSTIN-based RTO/logistics cost is the downstream consumer. |
| **Festival seasonality** | LOW at build time; relevant at Stage-8 cutover: do not flip `BRONZE_RAW_ARCHIVER` live during a festival freeze. |
| **Pincode** | LOW directly; pincode intelligence feeds RTO scoring which feeds True-CM2. Correct silver → correct gold. |
| **COD-remittance / settlement archetypes** | ADR-J, deferred per Q3. Bronze accommodates any vendor class. No build now. |

---

## Persona set for Stage 2 (net-new angles only)

The 28-agent workflow absorbed: cost/scale, DPDP/identity, governance/erasure, streaming/CDC, lakehouse/Iceberg, ELT-platform, multi-tenant isolation, schema single-sourcing. Those lenses do NOT need re-running.

**Net-new angles for the persona stage (0 personas recommended):**

I recommend **0 additional personas** at the persona stage. My rationale: the two substantive net-new angles I surfaced (transform-worker SPOF under PG outage, billing-integrity during replay) are both concrete enough to bind directly as plan amendments (Challenge 4 and Challenge 5 above) without a persona elaboration pass. Running personas on a plan this fully specified by a 28-agent workflow would produce diminishing returns and process overhead for a 1-brand reality. The binding changes I've added (Challenges 1–5) go directly into the Stage-2 plan as amendments.

If the Founder or Aryan feels a specific angle deserves a full persona pass (e.g., the billing-integrity realist or a dedicated on-call/incident-response realist for the transform-worker SPOF), I will spawn them. But my default is: the plan is actionable as-is with the five bound changes; advance to Stage 3 build with zero additional persona overhead.

---

## Plan amendments I bind before Stage 2 (the builder's obligations)

1. **P0-B and P0-D clear Stage-4 (Shreya VETO) before any P1 slice begins.** Record as `build_gated_on` in active.json.
2. **P1-B shadow-mode shell begins in parallel with P0-C** (not after P1-A). The consumer + registry + cursor-read loop (no mappers, no cursor advance) is development-startable the day P0-C lands.
3. **P1-B acceptance criteria adds:** test that PG cursor table unavailability produces a logged stall (no bronze consumed without cursor advance; no silent gap). Fail-closed on PG unavailability.
4. **P1-E adds `silver_freshness{workspace_id, date}` metric;** `recompute_daily.py` gates gold recompute on silver freshness during any replay window. This is a Stage-2 design obligation on Aryan, not a Stage-3 builder obligation.
5. **P0-C acceptance criteria adds:** BACKUP cron is live and verified as day-zero of P0-C go-live, not an afterthought. The R7 ≤14-day window is documented + risk-accepted in a named artifact (not just a comment in the plan).

---

## Escalation

**NO `/escalate` warranted.** All decisions are within the confirmed Q1–Q7 defaults. The DPDP gates are architecture-grounded and confirmed. The crypto-shred Q5 default is Founder-accepted. The Stage-8 console ceremonies (S3/KMS provisioning, MSK graduation) are Founder-at-console ceremonies, not escalations to me.

**One non-blocking Founder attention item** written to `pending-founder-attention.md`: pre-bronze historical provenance (R12/Q6) — the billing-provenance gap for the anchor customer's first 83k orders.

---

## Decision log entry

```json
{
  "ts": "2026-06-05T00:00:00Z",
  "actor": "cto-advisor",
  "type": "epic-intake-advance",
  "req_id": "epic-warehouse-medallion-wiring",
  "stage": 1,
  "decision": "ADVANCE — proceed with changes bound",
  "feature_class": "high-stakes",
  "lane": "high-stakes",
  "personas": [],
  "persona_rationale": "28-agent workflow absorbed all standard lenses; 5 net-new challenges bound directly as plan amendments; 0 additional persona overhead warranted",
  "paradigm": "sql",
  "amendments_bound": [
    "P0-B/P0-D Stage-4 gate before any P1 work",
    "P1-B shadow-mode shell starts parallel with P0-C",
    "P1-B fail-closed on PG cursor unavailability",
    "silver_freshness metric + gold-recompute gate on replay",
    "BACKUP-cron is P0-C day-zero acceptance criterion"
  ],
  "escalation": "none",
  "founder_attention": "R12/Q6 pre-bronze historical provenance (billing-provenance gap for 83k orders) — non-blocking",
  "rationale": "Architecture is sound (28-agent reviewed, Q1-Q7 confirmed); 5 substantive challenges surfaced and bound; DPDP gates are the unconditional dependency root; transform-worker and billing-integrity gaps are the only net-new angles vs the 28-agent pass"
}
```
