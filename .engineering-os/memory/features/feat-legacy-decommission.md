# Feature journal — feat-legacy-decommission (Child 7 of EPIC chore-migrate-legacy-to-brain)

> Per-feature append-only journal. Title: Legacy decommission — final cutover sequence + retirement runbook. The FINAL child of the strangler-fig migration. A DESIGN/RUNBOOK child (no app code; execution is Stage-8 / Founder-gated).

## Stage 1 (intake) — 2026-05-25T07:30:00Z — Rohan (cto-advisor)

**Decision:** ADVANCE (1 persona requested first; synthesis after orchestrator re-invoke).

**Lane:** high-stakes (DPDP/india-compliance + auth/connectors + multi-tenancy + schema-proto + money), but **design/runbook-only shape** — no code build. Stages: 1 → 2 (decommission-runbook, Aryan) → 6 (Rohan final review = compliance + reversibility IS the gate, my VETO). No Stage-3/4/5 code build; Tanvi degrades to artifact-completeness, Shreya to design-level VETO on the irreversibility/PoNR/credential-destruction design (the Child-0 analogue). EXECUTION is Stage-8 / Founder-at-console, NOT this child.

**Persona:** 1 — `dpdp-decommission-safety-realist:sonnet`. Single dominant risk dimension = irreversible-decommission safety (PoNR ledger + plaintext-cred destruction + DPDP retention/erasure of the retired store). The ordering question collapses into the same reasoning (you can't reason about order without reasoning about what's irreversible at each step), so a 2nd persona would overshoot. NOT 0-persona: a wrong order destroys legacy plaintext creds or shuts the DB before Brain custody/parity is proven — irreversible data/access loss → conservative rule says spawn. Declined: generic india-compliance-officer (folded), connector-cutover-sequencing-realist (collapses into PoNR), runbook-completeness persona (Tanvi/Aryan job).

**The five intake rulings (fixed for Aryan):**
- **(a) Order:** ONE DAG-forced sequence (arch line 515): HOLD-AT-FORCE (RLS, gated on Child-3 residual-writer conversion + complete bare-write grep GREEN) → HOLD-AT-CUTOVER (connectors, Shiprocket LAST, no-replay) → HOLD-AT-READ-FLIP (metrics, → legacy-reads-decommissioned) → HOLD-AT-SERVE (AI, CACHE-PURGE-C4C5 fires + graduation) → HOLD-AT-ROUTE-FLIP (frontend, production JWT) → legacy DB shutdown. Per-hold PoNR row required: {hold, pre-req gate ref, reversibility action, explicit PoNR line, what's destroyed past it}. The PoNR ledger is THE load-bearing artifact. No PoNR crossed before its dependency's parity is signed.
- **(b) Irreversible steps:** plaintext-credential destruction (C8) — per-connector PoNR; reversible (token hand-back) until delete; `CF-SEC-SECRETS-1` requires Brain custody PROVEN first (authenticated Brain call + parity-in-window + secret sealed). Legacy DB shutdown — program terminal PoNR; gated on 100%-decommissioned + archive verified restorable + Founder authorization.
- **(c) DPDP archival:** retired PII store stays ap-south-1 (CF-RES-1; out-of-region = §16 transfer); retention-bounded then decommissioned; erasure-scopable per §12/§13 against the archive (or provably purged); AuditLog null-rows → system-workspace-sentinel carried (R-AUD-01). Canon answer, NOT an escalation; bound in runbook, reviewed Stage 6.
- **(d) 2 pending Child-4 DDR rows:** `total_tax_mu` (dep child-3-shopify-connector) + `fx_restatement` (dep child-3-workspace-cost-currency-migration) — both become signable post-Shopify-cutover. DDR full sign-off (mine) sequenced AFTER HOLD-AT-CUTOVER(Shopify) + BEFORE the read-flip `legacy-reads-decommissioned` transition (a named gate on the read-flip).
- **(e) Decommissioned in this child?** ~100% runbook + sign-offs. NO live cutover executed, NOTHING destroyed at runtime. Deliverable = decommission runbook + final-state verification checklist + PoNR ledger + DPDP close-out. Legacy already reference-only + untracked from git; this plans its RUNTIME retirement.

**Escalation:** none at intake. Production-cutover authorization + plaintext destruction = Stage-8 / Founder-at-console execution gate (the correct ratification point for irreversible execution), NOT a mid-pipeline /escalate (no canon ambiguity at intake). **Armed-not-fired:** IF Stage-2/6 reveals the archived store is neither erasure-scopable (§12) nor provably-purgeable without re-architecting the archive → /escalate ARMED to fire then (retention vs erasure obligation). Logged to pending-founder-attention.md.

**Pre-flight dependency check:** Children 1-6 ALL at Stage-8 readiness (committed-on-branch / awaiting-founder-commit / approved) behind their named holds. NO VIOLATION for the runbook (it plans against committed contracts + named holds). The HARD gate is on EXECUTION (each prior held cutover flipped + parity-signed at Stage 8) — this child SEQUENCES that, does not execute it.

**Semantic recall (k=6):** no near-duplicate; nearest = the spike (Child-0, the design-child analogue) + Child-1 RLS-hardening. Genuinely new shape (first decommission runbook).

**Paradigm:** sql/runbook (no compute, zero inference path; defends the cost model by confirming retirement of the legacy direct-SDK/Ollama path).

**Artifacts:** 02-cto-advisor-review.md.
**Next:** orchestrator spawns `03-persona-dpdp-decommission-safety-realist.md` → re-invokes Rohan for synthesis → Stage 2 (Aryan) decommission-runbook plan.

## Stage 1 (synthesis) — 2026-05-25T08:15:00Z — Rohan (cto-advisor)

**Decision:** ADVANCE → Stage 2 (Aryan: decommission runbook + PoNR ledger + final-state checklist + DPDP close-out).

**Persona quality gate:** PASS. `dpdp-decommission-safety-realist:sonnet` returned 5 grounded concerns (3 HIGH + 2 MED), each citing a specific artifact. All 5 ACCEPTED, none rejected/downgraded. Not a "looks complete" pass — it sharpened 3 of my intake rulings and surfaced 2 net-new gates (the serve→read dwell + festival-as-machine-gate).

**Folded CF-C7-* contract (binds Aryan's runbook):**
- **CF-C7-CUSTODY-PROOF-1 (HIGH)** — per-connector plaintext-delete PoNR needs real `seal()` (non-`NotImplementedError`) + a Brain call via the PRODUCTION custody path (not a direct legacy-DB read) returning vendor 200 + parity GREEN, signed, before DELETE. Shiprocket last (no replay). Owner: Aryan (gate) + Founder (real seal() impl).
- **CF-C7-DPDP-ERASURE-1 (HIGH)** — name a §12-satisfying archive format (live-read-only-until-retention-expiry OR per-workspace-partitioned S3 — NOT a flat pg_dump) + retention basis/period + decommission trigger; "archive" and "decommission" are TWO dates. Owner: Aryan. **Armed tripwire.**
- **CF-C7-SERVE-READ-COUPLING-1 (HIGH)** — min 24h dwell of stable Brain serving between HOLD-AT-SERVE flip and the `legacy-reads-decommissioned` PoNR; the PoNR isn't executable until the sustained-stability gate is signed. Else the AI rollback tree silently dies. Owner: Aryan.
- **CF-C7-DDR-GATE-1 (MED)** — two parity gates on the read-flip: P1 (legacy-sourced → licenses reversible fallback) vs P2 (Brain-Child-3-sourced + 2 DDR rows signed → licenses the PoNR). PoNR references P2, not P1. Owner: Aryan + Rohan (signs DDR between P1/P2).
- **CF-C7-FESTIVAL-WINDOW-1 (MED)** — machine query gate (`workspace_festivals` 14d-before/7d-after) on every irreversible step, not advisory prose; Shiprocket gets a pre-cutover blackout. Owner: Aryan + Founder/Jatin (calendar).

**Escalation ruling:**
- **C7-D-001 (custody seal() stub) — FIRED** as a build-gating prerequisite ADDENDUM to the already-open Child-3 custody escalation (not a separate /escalate). New fact vs intake: the seal()/get()/put() are `NotImplementedError` stubs in both backings; Child-3 deferred Option A/B "as a config swap" — but you can't config-swap between two stubs. A live-auth-test can pass by reading the legacy column directly, bypassing custody, then the plaintext is deleted forever (Shiprocket no-replay = dead connector). Founder ask = confirm the chosen Option A/B `seal()` is a REAL implementation (non-stub) before the Stage-8 plaintext-delete. Meets the rubric (irreversible/high-blast + Founder-only instrument). Stage 2 PROCEEDS; the Stage-8 delete is build_gated_on CF-C7-CUSTODY-PROOF-1.
- **C7-D-002 (archive format) — ARMED;** fires at Stage 2 iff Aryan cannot name a §12-satisfying archive format.
- C7-D-003/004/005 — no escalation; resolved in the runbook.

**Order/PoNR confirmed** (unchanged from intake, annotated with folded gates): HOLD-AT-FORCE → HOLD-AT-CUTOVER (PoNR=plaintext-delete, CF-C7-CUSTODY-PROOF-1) → HOLD-AT-READ-FLIP (PoNR=legacy-reads-decommissioned via Gate P2) → HOLD-AT-SERVE (24h dwell before the read PoNR) → HOLD-AT-ROUTE-FLIP → legacy DB shutdown (terminal PoNR; CF-C7-DPDP-ERASURE-1 + festival gate + Founder authorization). The PoNR ledger is THE load-bearing artifact. Paradigm sql/runbook confirmed.

**Artifacts:** 05-stage1-synthesis.md (full CF-C7-* table + escalation ruling + order/PoNR/dwell/DDR/festival gates).
**Next:** Stage 2 — Aryan authors the decommission runbook + PoNR ledger + final-state verification checklist + DPDP close-out. Rohan Stage-6 design review (compliance + reversibility) IS the gate. Execution Stage-8 / Founder-at-console.

## Stage 2 (binding runbook) — 2026-05-25T12:55:00Z — Aryan (architect)

**Decision:** Produced the binding decommission runbook. RUNBOOK-ONLY (no app code, no @paradigm decorator, no new runtime, no git commit, no legacy edit). Paradigm sql/runbook (Rohan sign-off carried). **Next: Rohan Stage-6 compliance + reversibility design review = the gate.** Execution = Stage-8 / Jatin + Founder-at-console.

**Artifacts:** `06-decommission-runbook.md` (the binding runbook: §5 ordered sequence, §6 PoNR ledger [load-bearing], §7 the 5 CF-C7 gates, §8 final-state checklist, §9 §12-archive format, §10 DPDP close-out) + `07-handoff-to-developer.md` (the Stage-8 operator/Jatin execution handoff + Founder-at-console authorization points + the build_gated_on custody item).

**Ordered hold-release sequence (DAG-forced, §5):** Step 0 pre-flight (festival + residency + custody readiness) → Step 1 **HOLD-AT-FORCE** (L0, no PoNR; a ramp completing at Shiprocket — reconciles C3 FR:148) → Step 2 **HOLD-AT-CUTOVER** (L1, per-connector, Shiprocket LAST/no-replay) → Step 3 **HOLD-AT-READ-FLIP** (L2 P1→fallback reversible / L3 P2→decommissioned PoNR) → Step 4 **HOLD-AT-SERVE** (L4, 24h dwell before L3; legacy Ollama retired) → Step 5 **HOLD-AT-ROUTE-FLIP** (L5, per-route-group, production JWT) → Step 6 **legacy DB shutdown** (L6, TERMINAL) → Step 7 **archive deletion** (L7, SEPARATE DATE).

**PoNR ledger summary (THE load-bearing artifact, §6):** 8 rows, exactly **4 PoNRs** — #1 per-connector plaintext-credential DELETE (L1; Shiprocket last/no-replay = highest irreversibility), #2 legacy-reads-decommissioned (L3; via Gate P2 + 24h dwell), #3 legacy DB shutdown (L6; TERMINAL), #4 archive deletion (L7; separate date at retention-expiry). L0/L2/L4/L5 cross no PoNR on their own. Invariant: no PoNR crossed before its dependency parity signed AND its CF-C7 gate GREEN AND festival gate GREEN AND Founder authorizes at console; every PoNR verification command is a positive proof, not a flag-read.

**The 5 CF-C7-* gates BOUND (§7):** CUSTODY-PROOF-1 (L1: real seal() + prod-path 200 + parity signed; Shiprocket last; build_gated_on Founder's real seal()) · DPDP-ERASURE-1 (L6/L7: §12 format named → tripwire NOT fired) · SERVE-READ-COUPLING-1 (L3 via L4: min 24h stable-serving dwell signed before the read PoNR) · DDR-GATE-1 (L3: P1 reversible-fallback / P2 PoNR; L3 references P2; Rohan signs the 2 rows between) · FESTIVAL-WINDOW-1 (machine query gate on every irreversible step + Shiprocket blackout).

**§12-satisfying archive format (CF-C7-DPDP-ERASURE-1 — TRIPWIRE NOT FIRED, §9):** Option **ALPHA** (primary) = legacy Postgres live-but-read-only in ap-south-1 until retention-expiry; §12 erasure = scoped live `DELETE WHERE workspace_id=? AND email=?` (canon mechanism, data-privacy-dpdp:80), then wholesale-delete. Option **BETA** (cost-bounded fallback) = S3 Parquet partitioned by workspace_id in ap-south-1 KMS; §12 erasure = `s3:DeleteObject` per partition. **Flat pg_dump REJECTED** (not scopable without full restore). Retention = shorter-of-canon-5y-or-legal; PII-free audit_log 7y; decommission trigger (L7) = retention elapsed AND §12-requests-pending=0. **"Archive" (L6) and "decommission" (L7) = TWO DATES.** AuditLog null-rows → system-workspace-sentinel (R-AUD-01) carried. Founder/Jatin pick ALPHA/BETA at Stage-8 (both §12-satisfying; NOT an escalation).

**Custody / dwell / DDR / festival gates (the four named precondition classes):** custody = real non-stub seal() + prod-custody-path 200 (build_gated_on Founder, FIRED addendum); dwell = min 24h stable Brain serving signed before the read-decommission PoNR; DDR = Rohan's full sign-off (total_tax_mu + fx_restatement) sequenced AFTER Shopify cutover (L1) + BEFORE the read-flip PoNR (L3) = Gate P2; festival = `SELECT name,festival_date FROM workspace_festivals WHERE festival_date BETWEEN NOW() AND NOW()+INTERVAL '14 days'` → ABORT, run before every irreversible step.

**Final-state verification (§8):** every bounded context Brain-authoritative + at parity; DDR 11/11 signed; zero Brain read path to legacy rollups; single-writer C2 final state (legacy-reads-decommissioned); legacy AI/Ollama/SystemSettings.ollamaUrl retired (cost-model defended); archive §12-erasure-executable ap-south-1; PII-free audit_log 7y preserved; CF-BN-NOLEGACY-1 held.

**What stays HELD / Founder-gated for Stage-8:** Founder's real seal() impl (build_gated_on); Rohan's DDR full sign-off (2 rows, between L1/L3); the ALPHA/BETA archive pick (Founder/Jatin); the cutover calendar (festival gate enforces); every PoNR Founder-authorization at console (AUTH-CUSTODY, AUTH-DELETE per-connector, AUTH-READ-DECOMMISSION, AUTH-SHUTDOWN, AUTH-ARCHIVE-DELETE).

**Over-engineering self-check:** 7/7 PASS (runbook; no code/deps/new primitive/net-new observability; per-child gates referenced not restated; two artifacts only).

**Paradigm:** sql/runbook (Rohan Stage-1 sign-off carried; affirmed, no re-invoke).
**Next:** Rohan (cto-advisor) Stage-6 compliance + reversibility design review (VETO) = the gate; Shreya design-level VETO + Tanvi artifact-completeness in support. Execution Stage-8 / Jatin + Founder-at-console. status → cto-review (Stage 6).

---

## 2026-05-25T13:10:00Z — Stage 6 FINAL REVIEW (Rohan, cto-advisor) — PASS

**Verdict:** PASS → Founder gate signed under standing delegation → Stage 8 readiness. **Recommendation:** APPROVE-WITH-CAVEATS. Runbook-only child: my compliance + reversibility design review IS the gate (Tanvi artifact-completeness + Shreya design-level VETO folded — no code to review).

**Reversibility review — PASS.** Audited the 8-row PoNR ledger (L0–L7). Exactly 4 PoNRs: L1 per-connector plaintext-DELETE (Shiprocket last/no-replay — highest irreversibility in the program), L3 legacy-reads-decommissioned, L6 DB shutdown (terminal), L7 archive deletion (separate date). Each names its precondition, a positive-proof verification (NO PoNR passes on a flag-read — prod-custody-path vendor-200, parity exit-0 on Brain-sourced data, archive restore-test, retention+zero-pending-§12 query), and a rollback tree valid until that exact line. No PoNR crosses before its dependency parity is signed. L0/L2/L4/L5 cross no PoNR on their own (correct).

**Compliance review (DPDP) — PASS.** CF-C7-DPDP-ERASURE-1 satisfied: the named archive format is genuinely §12 erasure-scopable AFTER the app is gone (ALPHA = legacy Postgres live-read-only ap-south-1, scoped live DELETE = canon erasure; BETA = S3 Parquet per-workspace, DeleteObject per partition; flat pg_dump REJECTED). ap-south-1 (§16 forbidden out-of-region). Retention-bounded (shorter-of-5y-or-legal; PII-free audit_log 7y). Archive (L6) vs decommission (L7) two dates. §12/§13 close-out + chore-security-governance-hardening-phase handoff present. ARMED tripwire DOES NOT FIRE.

**4 gate classes — all real machine-checkable.** Custody (real non-stub seal() + Brain call via PRODUCTION custody path returns vendor 200 + parity GREEN, signed before DELETE — the FIRED escalation, build_gated_on); dwell (24h serve-stability signed before L3); DDR (Gate P2 Brain-Child-3-sourced, L3 references P2 not legacy-sourced P1); festival (workspace_festivals 14d/7d query → ABORT).

**DDR sequencing — correct.** The runbook holds my signing of the 2 pending rows (total_tax_mu + fx_restatement) AFTER Shopify cutover (L1) + BEFORE the read-flip PoNR (L3). I do NOT sign them now (Shopify isn't cut over; rows not measurable on legacy-sourced data) — the runbook holds them correctly as a hard precondition on PoNR #2.

**Over-engineering — CLEAN.** 2 artifacts only; no app code, no @paradigm, no new runtime, no new dep, no new primitive, no per-child gate re-derived, legacy untouched. **Hard-rule deviation — CLEAN** → delegation exercisable.

**Independent re-verification (runbook-child analogue) 4/4:** custody seal()/get()/put() ARE NotImplementedError stubs in both backings (the FIRED escalation is code-grounded); workspace_festivals is a real table (model WorkspaceFestival @@map workspace_festivals, RLS-FORCE-protected); legacy AI path (module/ai/* + ollamaUrl schema:924) exists (cost-model-defense claim real); check-metrics-parity.sh exists (L3 verification command real).

**Artifacts:** 11-final-review.md, 14-retro.md (also the epic-wide retro), 12-founder-decision.json, pending-founder-commit.md. **No commit** (feature-branch-only + harness guard). status → approved, stage 8.

**EPIC CLOSE-OUT:** Child 7 is the FINAL child of chore-migrate-legacy-to-brain. All 7 children planned/built end-to-end; the only remaining work is the Founder-gated Stage-8 production cutover, executed against this runbook with the real-seal() prerequisite + the DDR sign-off as the two named pre-execution gates.
