# Persona Review — dpdp-decommission-safety-realist

> Run folder: `.engineering-os/runs/2026-05-25T07-12-38Z__1be105__feat-legacy-decommission__rishabhporwal/`
> Persona type: `dpdp-decommission-safety-realist`
> Spawned for: Stage-1 brainstorm of Child 7 (legacy decommission runbook — the FINAL migration child)
> Timestamp: 2026-05-25T07:45:00Z

---

## Framing

My obsession is one question: **at which exact step could a runbook operator cause irrecoverable data or credential loss, or a DPDP violation, because the PoNR was crossed before its precondition was proven?**

I read the requirement, Rohan's Stage-1 review, the Child-0 architecture (A1–A6), and each child's 11-final-review.md to reconstruct the actual state of each named hold. Every concern below is grounded in evidence from those artifacts — not from assumptions. I performed a targeted WebSearch to confirm the current DPDP §12/§13 erasure obligation structure.

I found five distinct concerns. One (C7-D-004, the Shiprocket credential PoNR) is the single step most likely to cause irrecoverable loss. Two concerns (C7-D-001 and C7-D-004) require explicit constraints in the runbook; two (C7-D-002 and C7-D-003) require the runbook to name mechanisms that do not yet exist in the architecture artifacts; one (C7-D-005) is a medium-severity ordering hazard.

---

## Concern 1 — HIGH — "Brain custody proven" is an under-specified precondition for per-connector plaintext deletion

**CF constraint proposed: `CF-C7-CUSTODY-PROOF-1`**

### What the architecture currently says

`CF-SEC-SECRETS-1` (arch A6.4, R-CRED-01) requires "Brain custody PROVEN first" before the legacy plaintext credential is deleted. Rohan's Stage-1 review (02-cto-advisor-review.md §b) restates this as: "authenticated Brain API call + parity within window + secret sealed in Brain secrets manager."

### The gap

Child 3's final review (11-final-review.md §What stays HELD) records that BOTH custody backings (`aws_secrets_manager_custody.py`, `supabase_column_custody.py`) raise `NotImplementedError` in `get()`, `put()`, and `seal()`. The Founder credential-custody **Option A vs B decision (CF-C3-SECRETS-INTERIM-1) is unresolved at Stage 6** and was deferred to the Stage-8 ceremony as "a config swap." The Child-3 final review explicitly: "credential-custody mechanism still undecided (Founder Option A vs B)."

This means at the time this runbook is written, the definition of "Brain custody proven" is:

- If Option A: "sealed in AWS Secrets Manager" — but `aws_secrets_manager_custody.seal()` is `NotImplementedError`; the `seal()` path is not yet callable.
- If Option B: "encrypted column in Supabase DB under RLS" — but `supabase_column_custody.seal()` is also `NotImplementedError`; AND the seal semantics for Option B are not defined in any artifact.

**The runbook operator has no machine-checkable definition of "Brain custody proven" to test before deleting the legacy plaintext.** If the runbook says "verify Brain custody, then delete" but "verify custody" means manually checking that a `NotImplementedError` has been replaced with a real implementation — and the operator proceeds on a partial implementation or a silent stub — the legacy plaintext is destroyed and Brain's connector call fails: **connector dead, no rollback to legacy auth, and Shiprocket has no replay.**

The live-auth-test requirement is partially mitigated (Child-3 Stage-8 STEP 2 specifies "live vendor HTTP auth test" as a predicate), but that test is not the same as "the seal() pathway is implemented and verified to be the production call path." A live auth test against a credential that was fetched from a legacy Postgres column directly (bypassing the Brain custody path entirely) would pass STEP 2 and still leave the custody path unproven.

### Proposed constraint

`CF-C7-CUSTODY-PROOF-1`: the per-connector PoNR (plaintext delete) is NOT crossable until ALL of:
1. The Founder Option A or B custody decision is on record AND the corresponding `seal()` / `get()` pathway is confirmed non-`NotImplementedError` (i.e., the real implementation has replaced the stub — not just "the config swap has been made").
2. A Brain connector call is made via the production custody path (not a direct DB column read) and returns HTTP 200 from the vendor.
3. Parity (event count + key field spot-check per A5 M-A5-Q3) is GREEN within the connector's rollback window N.

**All three must be recorded in the runbook's per-connector PoNR checklist, signed by the operator, before `DELETE`.**

**Severity:** HIGH — would block a Stage-6 design review if the PoNR ledger does not incorporate this. A runbook that only requires "live auth test" (STEP 2) without separately verifying the custody path is the gap.

---

## Concern 2 — HIGH — DPDP §12 erasure-scopability of the retired archive is unresolved for the specific PII table structure

**CF constraint proposed: `CF-C7-DPDP-ERASURE-1`**

### What the architecture currently says

Rohan's Stage-1 review (02-cto-advisor-review.md §c) states the canonical answer: "archive stays ap-south-1; retention-bounded; erasure-scopable per workspace/data-principal." The requirement scope names "DPDP accountability for the retired PII store" as in-scope. The armed `/escalate` condition is documented: if the archived store is "neither erasure-scopable nor provably-purgeable," escalate.

### The gap

The architecture has never described the **physical archive format** of the retired legacy DB. "Archive then decommission" appears in the requirement and the intake rulings but the mechanism is unnamed. The legacy DB is a Postgres instance in Supabase ap-south-1 — the two standard retirement paths are:

- **Path A — Supabase project pause/export + pg_dump:** produces a `.sql` or `tar` dump that is a flat file. A flat `.sql` dump is not directly erasure-scopable per data-principal — you cannot execute a §12 erasure request against a `.sql` file without restoring the entire DB.
- **Path B — Keep the Supabase project live in a "read-only" state, deprovisioning the app:** the DB remains addressable; erasure is a live `DELETE WHERE workspace_id = ? AND (email = ? OR customerEmail = ?)` — erasure-scopable. But a "live" project accrues Supabase compute costs indefinitely and is not "decommissioned."
- **Path C — Partial export into a structured erasure-capable store** (e.g., S3 Parquet with per-workspace partition): erasure = `s3:DeleteObject` on the partition, which is a real §12-satisfying mechanism but requires design work not currently in any artifact.

**DPDP §12 (verified via WebSearch):** a data fiduciary must erase personal data on a data-principal request unless retention is necessary for the specified purpose or for compliance with law. There is no "archived and unreachable" exception — if the data still exists in the archive, the §12 obligation applies. The DPDP Rules 2025 require the fiduciary to have a "readily available means of grievance redressal" (§13) — which implies the erasure mechanism must be operationally executable, not theoretical.

**The current architecture leaves the archive format undefined.** If Path A (flat dump) is chosen and an erasure request arrives within the retention window, the only way to honor it is to restore the entire DB, run the DELETE, and re-export — an operational burden that may be impractical, and creates a second PoNR risk: a re-export after selective deletion may reintroduce the data if the original dump is not securely overwritten.

The AuditLog null-workspace rows (R-AUD-01 / A1.4 system-workspace sentinel disposition) compound this: if the archive is a flat dump, system-workspace sentinel rows mixed into the flat file can complicate per-data-principal scope filtering.

### Proposed constraint

`CF-C7-DPDP-ERASURE-1`: the runbook must:
1. Name the specific archive format and its erasure-query mechanism before naming the DB shutdown as a PoNR.
2. Confirm the chosen format satisfies §12: either (a) the DB remains live-but-read-only until retention period expires and then is deleted wholesale (permitted if the retention purpose is bounded and documented), OR (b) a per-workspace-partitioned erasure-capable format is used.
3. Name the retention basis/period explicitly (DPDP requires it) and the trigger for the final decommission ("when retention period expires + no active §12 requests pending").
4. If Option (a) is chosen, the "decommission" step in the runbook is NOT the DB shutdown — it is the end of the retention window + confirmation of no pending requests. The Stage-8 executor must understand this: "archive" and "decommission" are two separate dates, potentially months apart.

**Severity:** HIGH — a runbook that names "archive then decommission" without specifying the archive format and erasure mechanism is not DPDP-compliant. The armed `/escalate` from Rohan's intake review fires exactly here: if the team reaches Stage 2/6 and cannot name a concrete archive format that is §12-satisfying, `/escalate` to Founder must fire. This concern makes the tripwire concrete rather than abstract.

---

## Concern 3 — HIGH — The AI-serve rollback window creates a cross-hold timing trap for HOLD-AT-SERVE vs HOLD-AT-READ-FLIP

**CF constraint proposed: `CF-C7-SERVE-READ-COUPLING-1`**

### What the architecture says

Arch A4 (Child 5 rollback) states: "Re-enable legacy AI read path (only valid while Child 4 legacy-reads not yet decommissioned)." This means the HOLD-AT-SERVE rollback is only executable IF the HOLD-AT-READ-FLIP `legacy-reads-decommissioned` transition has NOT yet been crossed. Once `legacy-reads-decommissioned` is reached, the rollback for AI serve is permanently unavailable.

Rohan's Stage-1 review (02-cto-advisor-review.md §a, hold #4) acknowledges: "this is why AI serve-flip must not outrun the metric read-flip rollback window."

### The gap

The DAG release order is:
```
HOLD-AT-FORCE → HOLD-AT-CUTOVER → HOLD-AT-READ-FLIP → HOLD-AT-SERVE → HOLD-AT-ROUTE-FLIP → shutdown
```

The HOLD-AT-READ-FLIP has three internal states: `legacy-writes/Brain-reads-shadow → Brain-writes/legacy-reads-fallback → legacy-reads-decommissioned`. The runbook's PoNR for Child 4 is the `legacy-reads-decommissioned` transition.

**The trap:** If a Founder-at-console execution does the following:
1. Flips HOLD-AT-READ-FLIP to `Brain-writes/legacy-reads-fallback` (correct, reversible).
2. Flips HOLD-AT-SERVE (Brain AI serving — correct sequencing).
3. Flips HOLD-AT-READ-FLIP all the way to `legacy-reads-decommissioned` (the read-flip PoNR).
4. Discovers the Brain AI narration is wrong or a cache miss is causing user-visible errors.

At step 4, the rollback for HOLD-AT-SERVE requires re-enabling the legacy AI read path, which requires `legacy-reads` to still be available. But step 3 has already crossed the `legacy-reads-decommissioned` PoNR — the legacy read path is gone. **The rollback tree for HOLD-AT-SERVE has been silently destroyed by advancing HOLD-AT-READ-FLIP past its PoNR.**

No artifact currently documents a required minimum dwell time between flipping HOLD-AT-READ-FLIP to `legacy-reads-decommissioned` and confirming HOLD-AT-SERVE stability. An operator executing both hold flips in a single session (which is the likely execution pattern — you are at the console, one connector has just cut over, you want to complete the sequence) will cross both PoNRs with no forced pause.

### Proposed constraint

`CF-C7-SERVE-READ-COUPLING-1`: the runbook must:
1. Enforce a **required dwell period** (minimum 24 hours of stable Brain AI serving, with zero user-visible error escalation) between HOLD-AT-SERVE flip and the `legacy-reads-decommissioned` transition.
2. The `legacy-reads-decommissioned` transition must not be executable from the runbook until the HOLD-AT-SERVE stability gate is explicitly signed (not just "AI is serving" — sustained stability over the dwell period).
3. If HOLD-AT-SERVE is flipped and a P1 AI serving issue emerges within the dwell period, the rollback path is: re-enable legacy reads (still available at `legacy-reads-fallback`) + re-enable legacy AI path. The runbook's rollback tree for HOLD-AT-SERVE must include this coupling as an explicit precondition.

**Severity:** HIGH — the dwell period is the only structural protection against destroying the AI rollback tree before Brain AI is proven stable. Without it, the most natural execution sequence (advance both holds in sequence) causes a hidden irreversibility.

---

## Concern 4 — MEDIUM — The two unsigned Child-4 DDR rows create a hidden re-ordering pressure that could rush the HOLD-AT-READ-FLIP PoNR

**CF constraint proposed: `CF-C7-DDR-GATE-1`**

### What the architecture says

Child-4's DDR has 2 UNSIGNED-PENDING rows: `total_tax_mu` (dep: child-3-shopify-connector) and `fx_restatement` (dep: child-3-workspace-cost-currency-migration). Rohan's Stage-1 ruling: DDR full sign-off (Rohan's authority) must be sequenced AFTER HOLD-AT-CUTOVER (Shopify) AND BEFORE the `legacy-reads-decommissioned` transition.

### The gap

The unsigned DDR rows represent metrics where Brain-sourced shadow data has NOT been compared against legacy-sourced data. `total_tax_mu` feeds the CM1→CM2→CM3 ladder (it is a waterfall input: `cm1 = net_sales - cogs - shipping - packaging - website_charges - total_tax`). If `total_tax_mu` has a systematic per-SKU GST error (the known potential delta, estimated at 0–10% on mixed-slab days), the parity gate for the read-flip will have been run on legacy-sourced data where both sides used the same incorrect aggregation — producing a false GREEN.

Once Child-3 Shopify per-SKU connector is live and the DDR rows are signable, a second parity run is required on Brain-sourced data. **The runbook must name this second parity run as a distinct gate, not as a repetition of the original HOLD-AT-READ-FLIP parity.** If the operator assumes the first parity pass (on legacy-sourced data) is sufficient for the `legacy-reads-decommissioned` transition, they may cross the PoNR before the one parity measure that actually matters (Brain-sourced data parity) has been verified.

The time pressure is real: Child-3 has a 72-hour Shiprocket rollback window (the longest), and the natural desire after a successful Shopify connector cutover is to proceed quickly through the remaining holds. The runbook must explicitly prevent the operator from interpreting the first parity GREEN (legacy-sourced) as license to cross the read-flip PoNR.

### Proposed constraint

`CF-C7-DDR-GATE-1`: the runbook must name TWO distinct parity gates on HOLD-AT-READ-FLIP:
1. **Gate P1 (legacy-sourced parity):** the original Child-4 shadow-compare GREEN on legacy-sourced data. Required for the `Brain-writes/legacy-reads-fallback` transition (the reversible step).
2. **Gate P2 (Brain-sourced parity, including DDR rows):** a second parity run on Brain-Child-3-sourced data, run AFTER Shopify connector cutover AND after DDR rows 8/9 are signed by Rohan. Required for the `legacy-reads-decommissioned` transition (the PoNR step).

The runbook's PoNR ledger row for HOLD-AT-READ-FLIP must reference Gate P2, not Gate P1, as the gate that must be GREEN before the PoNR is crossable.

**Severity:** MEDIUM — the first-parity-GREEN-as-cutover-license error is the most common class of migration cutover mistake. The DDR structure was explicitly designed to prevent it (Rule 2 block), but the runbook can undermine it if it conflates the two gates.

---

## Concern 5 — MEDIUM — The festival-window constraint is advisory, not a runbook gate

**CF constraint proposed: `CF-C7-FESTIVAL-WINDOW-1`**

### What the architecture says

Rohan's Stage-1 review (02-cto-advisor-review.md §India context check) notes: "the irreversible cutovers + DB shutdown must NOT be scheduled in a festival peak window." The `pending-founder-attention.md` entry for Child-7 also records this as a Founder/Jatin calendar concern.

### The gap

The current framing is advisory ("should not be scheduled"). For an irreversible operation (DB shutdown = program terminal PoNR), "advisory" is not a gate. Brain's primary customer is a DTC brand with peak GMV during Diwali/Dussehra/Navratri/Holi windows. A wrong cutover during a peak window is maximum blast radius for Sugandh Lok specifically (the anchor brand). Even if the Founder knows this, the runbook itself — which will be executed at Stage-8 by Jatin at console — must include a machine-checkable calendar gate, not a note.

There is also a subtler issue: the HOLD-AT-CUTOVER (Shiprocket) has a 72-hour rollback window. If the Shiprocket token transfer happens at the start of a festival peak (e.g., Diwali eve), and COD shipment volume is 4x normal, and a parity failure surfaces during those 72 hours, the rollback (re-register legacy webhook + accept documented gap) causes a real COD reconciliation gap during peak. The runbook should name a pre-cutover calendar blackout for Shiprocket specifically.

### Proposed constraint

`CF-C7-FESTIVAL-WINDOW-1`: the runbook must include, as a named Stage-8 pre-flight check item (not a design note):
1. A calendar check: no irreversible hold-flip (including HOLD-AT-CUTOVER Shiprocket and the `legacy-reads-decommissioned` transition and the DB shutdown) may be executed within 14 calendar days before or 7 days after any Indian festival that is in the `WorkspaceFestival` calendar for any active workspace.
2. This check is machine-checkable: query `SELECT name, festival_date FROM workspace_festivals WHERE festival_date BETWEEN NOW() AND NOW() + INTERVAL '14 days'` against the Brain DB before each irreversible step execution.
3. The runbook's per-hold PoNR row must include this calendar gate as a named precondition.

**Severity:** MEDIUM — not a blocking safety concern at design time, but without this being a named gate in the runbook it will be forgotten at Stage-8. A festival-window rollback during Diwali is a Founder-escalation event by definition.

---

## The single highest-irreversibility-risk step

**HOLD-AT-CUTOVER (Shiprocket) — the legacy-plaintext-credential-delete for the Shiprocket connector.**

This is the intersection of every risk factor:

1. **No historical replay:** every other connector (Shopify 60-day, Meta/Google Insights API, WooCommerce REST) has a replay window. Shiprocket does not. If Brain custody is not proven before the delete, or if the Brain Shiprocket connector has a silent ingest defect that only manifests at COD volume, there is no recovery path for the event gap.

2. **Custody path unproven (Concern 1):** the `seal()` stub means the operator cannot be certain the credential was sealed into the production custody path before deletion. A live auth test (STEP 2) passes even if the credential was read directly from the legacy DB column, bypassing the sealed custody path entirely.

3. **COD economic impact:** Shiprocket webhooks carry shipment-status events that feed `rto_value_mu`, `cod_amount_mu`, and the True-CM2 RTO provision. A missed webhook during a COD-heavy day creates a billing-base error that is invisible until the next parity run.

4. **72-hour window:** the rollback window is already the longest (3× Shopify); it is the most demanding connector for the operator to correctly maintain rollback readiness.

5. **Ordering trap (Concern 3):** if the operator crosses the `legacy-reads-decommissioned` PoNR too quickly after the Shiprocket cutover, the AI rollback path is destroyed. Because Shiprocket is last in the connector sequence, the `legacy-reads-decommissioned` transition becomes tempting immediately after Shiprocket succeeds.

**This step needs Founder escalation not because of a canon ambiguity, but because the specific precondition — "Brain custody proven via the production seal() pathway, not a live-auth test on a direct DB read" — cannot be verified without the Founder's Option A/B decision being implemented (not just decided, but implemented and confirmed non-NotImplementedError) before Stage-8 execution.** The runbook must make this explicit as a Stage-8 preflight gate.

---

## Summary table

| ID | Concern | Severity | PoNR relevance | Founder escalation? |
|----|---------|----------|---------------|---------------------|
| C7-D-001 | "Brain custody proven" is under-specified — live auth test ≠ production seal() path verified; Shiprocket no-replay = maximum exposure | HIGH | Per-connector plaintext delete (direct PoNR) | **YES — Option A/B must be implemented (not just decided) before Stage-8 Shiprocket step** |
| C7-D-002 | Archive format undefined — DPDP §12 erasure-scopability unresolvable against a flat pg_dump | HIGH | DB shutdown is NOT the terminal event if retention window is ongoing — "archive vs decommission" are two dates | NO at design time; `/escalate` ARMED at Stage 2/6 if no §12-satisfying format is named |
| C7-D-003 | HOLD-AT-SERVE rollback tree destroyed if `legacy-reads-decommissioned` PoNR crossed without dwell period | HIGH | `legacy-reads-decommissioned` transition destroys AI rollback | NO — resolvable by a named dwell gate in the runbook |
| C7-D-004 | Two unsigned DDR rows create hidden pressure to use legacy-sourced parity as cutover license; Gate P1 vs Gate P2 conflation | MEDIUM | `legacy-reads-decommissioned` PoNR (the read-flip's terminal step) | NO — runbook gate naming resolves it |
| C7-D-005 | Festival-window constraint is advisory prose, not a machine-checkable runbook gate; Shiprocket COD + Diwali = maximum blast radius | MEDIUM | All irreversible hold flips | NO — `WorkspaceFestival` calendar query is the gate |

**Highest irreversibility risk: C7-D-001 (Shiprocket plaintext delete with unproven custody path) requires Founder escalation.**

**Armed `/escalate` condition: C7-D-002 (archive format) fires at Stage 2/6 if the runbook cannot name a §12-satisfying archive format — mirrors the Child-0 residency tripwire.**

---

## One-liner for synthesis

"Five concerns: (C7-D-001 HIGH) the `seal()` custody path stub means Brain-custody-proven is unverifiable before Shiprocket plaintext delete — the highest single irreversibility risk, requires Founder's Option A/B to be implemented not just decided; (C7-D-002 HIGH) archive format is undefined and a flat pg_dump is not DPDP §12 erasure-scopable — the `/escalate` tripwire fires at Stage 2/6 if this is not resolved; (C7-D-003 HIGH) a cross-hold dwell period between HOLD-AT-SERVE flip and the `legacy-reads-decommissioned` PoNR is required or the AI rollback tree is silently destroyed; (C7-D-004 MEDIUM) two unsigned DDR rows require a second Brain-sourced parity gate (P2) distinct from the first legacy-sourced one (P1) to guard the read-flip PoNR; (C7-D-005 MEDIUM) the festival-window constraint must be a machine-checkable calendar gate in the runbook, not advisory prose."
