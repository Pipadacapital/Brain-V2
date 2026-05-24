# Feature journal — spike-legacy-migration-architecture

> Child 0 of EPIC chore-migrate-legacy-to-brain. Deep-audit + binding legacy->Brain migration architecture (strangler-fig). No production code; design-only deliverable.

## Stage 1 — 2026-05-24T01:01:04Z — Rohan (cto-advisor)

**Verdict:** ADVANCE → 2 personas requested (parallel) → re-synthesis → Stage 2 Architect (Aryan), co-owned with Maya (intelligence) on data/AI-surface mapping.

**Lane:** high-stakes (confirmed). No-code spike, but its decisions bind 9 trigger surfaces over live tenant data. Carve-out inapplicable. Code-specific gates honestly degrade to design-only analogues (mutation tests + real-network smoke = N/A; QA verifies artifact completeness/consistency); reasoning gates (Architect/Security/Final/Founder) run at full strength.

**Personas (2):**
- `migration-strangler-fig-realist` — adversarial read on the migration METHOD: is the sequence genuinely phased or a disguised big-bang? per-slice authoritativeness, reversible dual-write/dual-read, facade leakage, dependency-safe ordering.
- `india-data-isolation-compliance-officer` — no-RLS leak surface closed before data moves; PII + ap-south-1 residency + unmodeled DPDP consent; Decimal/Float->minor-units rounding-drift/dual-run mismatch as billing-base risk.
- Declined: ai-cost-realist (Child 5), generic-architecture (Aryan's job).

**Binding spike contract (acceptance):** A1 capability-map (zero orphans) · A2 strangler-fig-sequence (phased + per-slice reversible) · A3 facade/ACL design · A4 per-slice parity+rollback+decommission (measurable, zero money rounding-drift) · A5 dual-run shadow-compare (numeric, Maya) · A6 risk-register (6 non-negotiables + leak + PII/residency + money integrity). No-prod-code guardrail: ZERO legacy/product code change.

**Open:** slice boundaries/ordering + new-layer decisions (Zustand->Redux Toolkit, axios->tRPC) MAPPED here, BOUND in later children. No /escalate now — spike surfaces the DPDP/residency ambiguities that may escalate inside later slices.

## Stage 2 — 2026-05-24T01:11:34Z — Aryan (architect), co-owned with Maya (intelligence)

**Deliverable:** `06-architecture-plan.md` — the binding A1-A6 migration architecture. Design-only; ZERO legacy/product code touched (git: only .engineering-os/**).

**A1 capability-map:** every Prisma model (44 rows, zero orphans), backend route/lib groups, 7 connectors, ~204 tsx (33 `w/[slug]` route-groups) -> Brain bounded context + target service (api-gateway/core/ingestion/analytics/intelligence/web/mobile/lifecycle-service) + reuse|refactor|redesign + missing-NN tag (RLS/MU/OLAP/MP/GW/KAFKA). AuditLog null-workspaceId -> partial-refactor + system-workspace sentinel (C9). SystemSettings.ollamaUrl -> deprecate. **A1.5 = Maya stub** (rollup->metric-registry, ROAS->CM2 inversion, AI-surface->intelligence/Decision-Log).

**A2 strangler-fig:** 7 children (1 RLS -> 2 money -> 3 connectors[cutover] -> 4 metric+OLAP -> 5 AI -> 6 frontend -> 7 decommission). DAG proven acyclic. **C5 RLS+session HARD entry gate = explicit column** (blocks all dual-run; facade-enforced). **A2.0 armed residency tripwire (C6)** — region UNCONFIRMED from repo; if != ap-south-1 -> /escalate + freeze + pre-Child-1 residency migration. Child 5->Child 4 hard edge (C3); filtersHash cache-invalidation named step.

**A3 facade/ACL:** legacy authoritative per slice; Decimal-money + no-RLS-iso-model + single-owner-token leakage all blocked at ACL boundary; `workspace_daily_metrics` single-writer-at-a-time (C2); cutover routing flip per context.

**A4 parity/rollback/decommission:** money = EXACT-integer-equality, ROUND_HALF_EVEN, zero tolerance, per-workspace-date reconciliation (C7); per-connector rollback decision tree, Shiprocket longest N (no replay) (C1).

**A5 dual-run shadow-compare:** 6 binding rules (RLS-blocks-shadow C5; ClickHouse-shadow-never-Postgres-dual-write C2; FX-excluded-compare-in-primary-currency-fixed-snapshot C4; ROUND_HALF_EVEN shared TS<->Python C7; exact-equality cutover rule; filtersHash cache-invalidation gate C3). **A5.2 = Maya stub** (numeric design: money harness, CH metric shadow, FX-exclusion mechanics, mismatch triage, AI-input shadow).

**A6 risk register:** 6 NN (R-RLS/MU/OLAP/MP/GW/KAFKA-01) + R-LEAK-01 + R-RES-01(armed) + PII-boundary register (ShopifyCustomer/WoocommerceOrder/ShiprocketShipment/ShopifyOrder.email/Invitation.email) + R-FX-01 + R-FIN-01 + per-connector token-handoff ceremony (C1) + R-CRED-01(C8) + R-AUD-01(C9).

**Persona concerns:** 9/9 addressed + traceable.

**Next:** Maya deepens A1.5 + A5.2 (must flag plan-amendment, not silently change Aryan's dispositions/rules); then parallel Security (Shreya, reviews C1/C2/C5/C6/C8) + QA (Tanvi, artifact completeness/consistency).

---

## Stage 6 — Final review (Rohan, cto-advisor) — 2026-05-24T01:36:40Z

**Verdict:** PASS -> Founder gate. Recommend /approve (accept architecture as BINDING for the whole migration program + greenlight Child 1).

**Plan-binding:** 6/6 artifacts (A1-A6) delivered vs Stage-1 contract; 9/9 persona concerns C1-C9 bound with falsifiable rules, 0 hand-waved. Over-engineering audit CLEAN (the spike held the map/bind/DEFER discipline; no premature impl, no speculative abstraction, observability limited to parity reports + gate flags). Phased-not-bigbang reconfirmed (real DAG 0->1->2->4->5->6->7 + 1->3; Child 5->Child 4 the only hard sequential edge; Child 3 connectors correctly a single-owner cutover, not a pretend-shadow).

**Independent gate re-run (5, captured output):** no-prod-code guardrail HELD (.engineering-os/** only); secrets grep zero; no-RLS 0 policies (central premise real); cron fan-out cron.ts:65+:148; plaintext creds at cited lines (Shiprocket.password:498, Klaviyo.apiKey:559, Woo.consumerSecret:1014, Shopify:286/293, google:699, meta:763). All MATCH Shreya/Tanvi -> both reviews grounded in real code, no Stage-4/5 quality issue.

**Carry-forward ledger (11 binding child constraints — the load-bearing Stage-6 output):**
- CF-SEC-1 (Child 1): facade gate = fail-closed auditable predicate (RLS-probe-derived GREEN, RED-by-default, flips to Decision Log).
- CF-SEC-2 (Child 2/4): shadow-compare reads a physically-separate RLS-session-scoped replica/snapshot (read-only role alone insufficient).
- CF-SEC-3 (Child 1/3): migration-time PII lawful-basis (DPDP s4); /escalate if ambiguous at child-time.
- CF-SEC-4 (Child 3): oauth_states short-TTL/single-use/tamper-evident.
- CF-SEC-5 (all runtime children): correlation-ID 4-tuple end-to-end; missing-traceability = Stage-4 VETO at each child.
- CF-QA-1 (Child 2): TS roundHalfEven at Decimal precision, not float subtraction.
- CF-MAYA-1 (Child 4): Definitional-Delta Register as an explicit deliverable, Rohan signs off before cutover.
- CF-MAYA-2 (Child 2): WorkspaceCost currency-at-entry migration (primary currency, date-stamped rate).
- CF-RES-1 (Child 1 gate-zero): confirm region BEFORE Child-1 RLS DDL; != ap-south-1 -> /escalate + freeze A2 + Step-0 residency migration.

**Recommended Child 1:** child-1-tenancy-auth-rls-hardening (blocks:[child-0]; unblocked on approval) — runs CF-RES-1 gate-zero first, then establishes the universal RLS+session hard gate every later slice depends on.

**Why NOT self-approve Stage 8 (despite delegation):** program-shaping decision (accept architecture as binding + authorize Child 1); belongs to Founder's conscious ratification, as the epic decomposition did. PASS to the gate and STOP.

**Artifacts:** 10-cto-final-review.md, 14-retro.md. State -> awaiting-founder / stage 7 / owner founder / surface_to_founder true.

---

## Stage 7 — Founder decision — 2026-05-24T01:40:00Z

**Decision:** APPROVED — architecture accepted as BINDING for the 7-child migration program. Child 1 greenlit.
**Residency tripwire:** RESOLVED — Founder confirmed legacy Supabase/Postgres is in ap-south-1.
**Secrets:** NOT persisted to repo. Founder advised to rotate all exposed credentials. Child 1 provisions via AWS Secrets Manager.

---

## Stage 8 — Jatin (platform-devops) — 2026-05-24T07:14:41Z

**deploy_class:** spike-no-op (runtime_deployed: false)
**Readiness checks (6/6 PASS):**
- R1 no-prod-code guardrail: PASS
- R2 secret-hygiene: CLEAN (zero credential values; two region-fact identifiers correctly scoped)
- R3 residency: RESOLVED (ap-south-1; CF-RES-1 is now a positive-assertion gate-zero in Child 1)
- R4 architecture binding: CONFIRMED (A1-A6 + 9 concerns + 11 constraints)
- R5 carry-forward ledger: CAPTURED (13-deploy-report.md §5)
- R6 epic: READY (next_child_to_file: child-1-tenancy-auth-rls-hardening)
**48h monitor:** n/a-no-code-spike
**Status:** DONE (completed_at: 2026-05-24T07:14:41Z)
**Next:** Founder files /requirement for child-1-tenancy-auth-rls-hardening with the 11-constraint carry-forward ledger attached.
