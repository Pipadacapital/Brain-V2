# CTO Advisor Review — Stage 1 intake (slice #1 of epic-phase2-feature-parity)

| Field | Value |
|-------|-------|
| **req_id** | `feat-store-order-fact-layer` |
| **Stage** | 1 (intake) |
| **Timestamp** | 2026-05-25T13:30:00Z |
| **Decision** | **ADVANCE → Stage 2 (Aryan)** |
| **Reviewer** | Rohan (cto-advisor) |

## Semantic recall

Hits: the epic Stage-1 (`epic-phase2-feature-parity`) which authored this slice spec; Child-4
(`feat-metric-engine-olap-split`) which built the registry + DDR + query gateway this slice extends;
Child-6 (`feat-frontend-dashboard-morningbrief`) which built the BFF + `/store` scaffold + KPI strip
this slice wires. This is NOT a near-duplicate — it is the first feature slice that USES those layers.
The close match to shipped layer-patterns supports a clean ADVANCE with a low persona count.

## Pre-flight dependency check

Slice 1 `blocks`: the Phase-1 foundations it builds on — Child 1 (RLS), Child 2 (money MU + parity
harness), Child 3 (connector framework), Child 4 (metric registry + OLAP query gateway). State:
- `feat-tenancy-rls-brain-native` — committed-on-branch (shipped contract)
- `feat-money-minor-units-parity` — committed-on-branch (shipped contract)
- `feat-connector-framework-cutover` — awaiting-founder-commit (Stage-8 readiness; contract committed)
- `feat-metric-engine-olap-split` — approved (Stage-8 readiness; contract committed)

**No dependency violation.** This slice builds on COMMITTED contracts (the registry types, the query
gateway entry-point, the DataPlanePort, the format-money primitive, the parity harness) — the same
"build-on-committed-contract" situation ruled non-blocking on Children 4/6. Critically, this slice
does NOT execute any held cutover: it materializes ADDITIVE derived facts for ONE anchor workspace,
read-only, reversible. The connector framework's HELD-AT-CUTOVER state means live Shopify ingest
isn't flipped — so the fact layer for the smoke is seeded/fixture-backed through the SAME
DataPlanePort contract (exactly how Child-6 ran its runnable harness). No live credential, no live
cutover. NO refusal.

## Made requirements less dumb first

- **Delete:** re-deriving the legacy→Brain mapping (Child-0 A1.2 already did it; reuse).
- **Delete:** building a NEW fact-layer abstraction — the query gateway + registry + DataPlanePort
  already ARE the fact-read layer. This slice adds (a) revenue-ladder defs that don't yet exist in
  BOTH registries, (b) a `StoreSummary` use-case reading through the gateway, (c) two tRPC procedures,
  (d) the `/store` page wiring. Nothing structural is invented.
- **Simplify:** ONE anchor workspace (Sugandh Lok), additive/reversible, not all-tenants.
- **Defer:** live Shopify cutover (held), all-tenant backfill, the other 8 slices.

## Lane decision

- **feature_class:** `high-stakes`
- **feature_class_rationale:** Trigger-surface scan fires ≥4 hard surfaces — **multi-tenancy**
  (every new store query MUST carry `workspace_id` through the query gateway; a cross-workspace read
  = P0 leak), **money** (the entire revenue ladder is BIGINT minor units; a wrong edge-format or a
  blended-GST shortcut corrupts the honest billing base), **schema-proto** (new registry defs + new
  DataPlanePort method + new tRPC procedure contract = new contract surfaces), **india-compliance**
  (per-SKU GST 2.0 0/5/18/40 via RegionAdapter — never blended; in-region read; INR lakh/crore).
  Also touches **connectors** (reads facts derived from the connector framework). Foundational-
  scaffolding carve-out inapplicable (live presentation + multi-tenant money reads, not empty homes).
  Conservative tie-break moot — multiple hard surfaces force high-stakes outright. Inherited from the
  epic, which binds high-stakes on every slice.
- **trigger_surfaces_touched:** `["multi-tenancy", "money", "schema-proto", "india-compliance", "connectors"]`
- **Stages that will run:** 2 (Aryan) → 3 (Maya + Vikram) → 4 (Shreya) → 5 (Tanvi) → 6 (Rohan VETO) → 7 (Founder gate, signed under delegation).

## Persona-count decision

- **Count chosen: 0.**
- **Rationale (classifier rule fired):** "a clear repeat of a prior pattern in the lessons registry."
  Every risk dimension on this slice was ALREADY decided by a shipped layer-child and is REUSED, not
  re-decided:
  - RLS / 4-layer isolation → settled by Child-1 + Child-4's query-gateway `UnscopedQueryError`
    (the persona-tested `CF-C4-QUERY-SCOPE-ISOLATION-1`). This slice applies it; Shreya VETOs per-query.
  - Money MU + parity → settled by Child-2 (parity harness) + Child-4 (registry). This slice adds defs
    that ride the SAME gate.
  - Per-SKU GST def-delta → ALREADY has a DDR row (`total_tax_mu`, `child-3-shopify-connector`,
    persona-tested by Child-4's definitional-delta-finance-semantics-realist). This slice references
    that row; it does not re-open the question.
  - Cost/paradigm (the one net-new epic dimension) → the epic's `ai-cost-realist:sonnet` persona
    already pressure-tested it and confirmed slices 1–8 are SQL-only; slice 9 is the cost-gated one.
    Slice 1 has zero inference path — nothing for a cost persona to add.
  CTOA proceeds alone, synthesizing from owned skills + canon + the four shipped layer-children's
  decisions + journal continuity. There is no single dominant UNSETTLED risk dimension that a persona
  would sharpen — spawning one would duplicate settled work and burn tokens for no marginal signal.
- **Conservative check:** 0 is within the high-stakes cap (≤2) and is the floor. I considered 1
  (`india-data-isolation-compliance-officer` for the GST-per-SKU angle) and DECLINED it: the GST path
  is already bound by the existing DDR row + RegionAdapter requirement, and the honest-CM2 economics
  are settled canon. The rigor here lands on Aryan's binding plan (per-SKU not blended), Shreya's
  per-query RLS VETO, Tanvi's parity gate, and my Stage-6 — not on a Stage-1 brainstorm of a
  well-understood pattern. If Aryan's Stage-2 plan surfaces a NEW GST/residency ambiguity, that routes
  to `/escalate`, not a retroactive persona.

## Paradigm recommendation

- **Recommended:** `@paradigm("sql")` — epic-dominant, slice-1 confirmed. The revenue ladder is pure
  deterministic integer aggregation over structured facts. ZERO ML, ZERO LLM. Any `@paradigm` LLM
  decorator or new runtime in this slice = violation → BOUNCE. The query gateway already carries
  `@paradigm: sql`; the new use-case + defs inherit it.

## India context check

| Lens | Impact on slice 1 |
|------|-------------------|
| **GST** | Net-of-tax (`net_sales_net_tax_mu`) MUST be extracted **per line item by SKU GST 2.0 slab (0/5/18/40)** via the India RegionAdapter — NEVER blended. This is the headline correctness constraint. The legacy `compute-daily.ts` path uses a ShopifyQL day-level blended `taxes` aggregate — that is the anti-pattern. The DDR already carries `total_tax_mu` as a registered delta blocked on `child-3-shopify-connector` (the per-SKU ingest). Aryan must either (a) source per-SKU tax through the connector fact path for the anchor workspace, or (b) carry the def as the registered DDR delta with the per-SKU formula pinned and the blended legacy value NOT silently matched. |
| **RTO/COD** | Not in slice 1 (slice 3). The ladder stops at realized revenue; RTO provision is True-CM2 (already a Brain-native DDR row, not this slice). |
| **Festival seasonality** | N/A (read-only, no cutover scheduling). |
| **Telecom compliance** | Not triggered — analytics read surface, no outbound channel. |
| **Residency** | ap-south-1; in-region read; CF-RES-1 carried. |

## Decision

**ADVANCE → Stage 2.** Sound, planable, foundation-first, ratified by the Founder's "start Phase 2".
Not a CHALLENGE-BACK (the spec is complete and the slice is the forced dependency root). Not a KILL.

## Decision log entry (mirrored)

```json
{
  "ts": "2026-05-25T13:30:00Z",
  "actor": "cto-advisor",
  "type": "intake-decision",
  "req_id": "feat-store-order-fact-layer",
  "parent_epic": "epic-phase2-feature-parity",
  "stage": 1,
  "decision": "ADVANCE",
  "feature_class": "high-stakes",
  "persona_count": 0,
  "needs_personas": [],
  "paradigm": "sql",
  "rationale": "Slice-1 foundation = shared store/order fact layer + revenue ladder. Reuse Child-1/2/3/4 plumbing; add revenue-ladder defs (TS+Py parity), a StoreSummary use-case through the query gateway, store.summary/store.revenueLadder tRPC, /store wiring. 0 personas: every risk dimension settled by a shipped layer-child + the epic cost persona; clear repeat of a registry pattern. Per-SKU GST never blended; DDR delta registered, not float-matched."
}
```
