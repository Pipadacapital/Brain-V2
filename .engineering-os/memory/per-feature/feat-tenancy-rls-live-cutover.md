# Per-feature journal — feat-tenancy-rls-live-cutover

> Per-feature continuity log. Each stage appends; previous stages preserved.

## 2026-05-26T12:48:53Z — Stage 1 (intake) — Rohan (cto-advisor)

**Slice purpose:** close the OPEN P0 (live Supabase shared Postgres in ap-south-1 has zero RLS, open since 2026-05-24) by designing + executing the live FORCE-flip ceremony for the Brain-native RLS that already shipped via PRs #1+#2 (predecessor `feat-tenancy-rls-brain-native`, HOLD-AT-FORCE).

**The load-bearing dimension:** the legacy Express/Prisma app still hits the same prod DB and does NOT call `set_config('app.workspace_id', …)` on its connections. Without explicit handling, FORCE = 0-row outage for every brand on the legacy frontend.

**Lane:** high-stakes. Trigger surfaces: multi-tenancy, pii, india-compliance, schema-proto, connectors.

**Paradigm:** sql.

**Persona count:** 2 (high-stakes cap) — compliance + strangler, both `:sonnet` (reasoning-heavy).

**Personas:**
- `india-data-isolation-compliance-officer:sonnet` — 5 concerns (1 escalation-recommendation on path choice).
- `live-rollout-strangler-realist:sonnet` — 7 concerns (1 CRITICAL on STEP-5 verify-the-verifier).

**Dependency check:** PASS. Predecessor `feat-tenancy-rls-brain-native` is `merged-on-development` (SHA `860aeee`, HOLD-AT-FORCE).

**Intake decision:** ADVANCE.

## 2026-05-26T12:55:00Z — Stage 1 (synthesis) — Rohan (cto-advisor)

**Synthesis decision:** ADVANCE → Architect (Aryan), Stage 2. Default Stage-2 design = Path C with exit deadline = Path B completion date.

**Escalation FIRED:** CF-CUT-PATH-1 (Founder picks {Path C with hard exit deadline, Path A2}; A1 barred by `feedback_legacy_is_reference_only.md`; B-as-immediate-close canon-incompatible with §8(6) notice timeline). Mirrored to `.engineering-os/pending-founder-attention.md`.

**Critical finding:** Persona 2's O2 — STEP-5's "legacy smoke renders the same row counts" gate is the canonical verify-the-verifier hazard (10th occurrence of the durable-rule's target class would have landed in prod if STEP 5 had shipped as a psql double of the bypass role). Bound CF-CUT-VERIFY-THE-VERIFIER-1 CRITICAL with 3 captured pre-ceremony kill-tests on the staging clone (STEP-5 kill, STEP-5 inverse-mutant, rollback-wrong-order) + Stage-6 disk re-mutation per durable-rule sub-rule 7.

**Binding contract (11 new/sharpened):** CF-CUT-PATH-1 / CF-CUT-RUNBOOK-AUG-1 / CF-CUT-VERIFY-THE-VERIFIER-1 / CF-CUT-ROLLBACK-ATOMIC-1 / CF-CUT-DRAIN-1 / CF-CUT-SHIPROCKET-RECONCILE-1 / CF-CUT-RESIDENCY-1 / CF-CUT-BYPASS-AUDIT-1 / CF-CUT-DPDP-ADDENDUM-1 / CF-CUT-IDEMPOTENT-1 / CF-CUT-CALENDAR-1. Inherited (Child-1, unchanged): CF-RES-1.a / CF-SEC-1 / CF-SEC-3.HARD / CF-SEC-5 / CF-C1-POOL-1.a / CF-C1-RLS-DEFAULT-1.a / CF-C1-CRON-SCOPE-1.a / CF-C1-AUDITLOG-1.a / CF-C1-ROLLOUT-ORDER-1 / CF-C1-ZERO-BEHAVIOR-1 / CF-BN-NOLEGACY-1.

**Build gated on:** CF-CUT-PATH-1.

**Open Stage-2 obligations (Aryan):** 10 named, headline = pick path (default C-with-deadline) + bind STEP-5 real-path + 3 kill-tests.

**Next:** Aryan picks up Stage 2 on default Path C. Intake artifacts on branch `chore/intake-feat-tenancy-rls-live-cutover` (off `origin/development`); the live-cutover code work itself ships on its own feature branch when Stage 2 begins.
