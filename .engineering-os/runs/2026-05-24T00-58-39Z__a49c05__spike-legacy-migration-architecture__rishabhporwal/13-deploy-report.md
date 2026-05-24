# 13 — Deploy Report (Stage 8) — spike-legacy-migration-architecture

| Field | Value |
|---|---|
| **req_id** | `spike-legacy-migration-architecture` (Child 0 of epic `chore-migrate-legacy-to-brain`) |
| **Actor** | Jatin (platform-devops) |
| **Timestamp** | 2026-05-24T07:14:41Z |
| **deploy_class** | `spike-no-op` |
| **runtime_deployed** | `false` |
| **argocd_sync** | skipped — no service, no image |
| **ecr_push** | skipped — no service |
| **eas_build** | skipped — no mobile artifact |
| **cdk_deploy** | skipped — no infra stack |
| **48h_monitor** | `n/a-no-code-spike` |
| **rollback** | n/a — no runtime; architecture can be superseded by a new spike if the design is later found infeasible. File a new `/requirement` to reopen. |

---

## 0. What "deploy" means for a no-code spike

Per `gate_applicability_no_code_spike.deploy_stage8` (recorded at Stage 1 by Rohan): *"no-op readiness analogue (runtime_deployed:false); 'deploy' == accepting architecture as binding to spawn children."* There is nothing to push, sync, or monitor at the runtime level. Stage 8 here is a readiness/closeout pass:

1. No-prod-code guardrail re-verification
2. Secret-hygiene scan
3. Residency-resolution recording
4. Architecture binding confirmation + carry-forward ledger for Child 1
5. Spike marked done

---

## 1. No-prod-code guardrail check — PASS

**Gate:** `git status` and `git diff --stat` must show ONLY `.engineering-os/**` changes. Zero product code, zero legacy project changes.

**Result:** PASS

`git status` output (at time of Stage 8 check, 2026-05-24T07:14:41Z) showed:

- **Modified files (all `.engineering-os/`):** `decision-log/2026/05/2026-05-24.jsonl`, `memory/agents/architect.journal.md`, `memory/agents/cto-advisor.journal.md`, `memory/agents/intelligence.journal.md`, `memory/agents/platform.journal.md`, `memory/agents/qa.journal.md`, `pending-founder-attention.md`, `state/active.json`, `state/registry.json`, `usage.jsonl`
- **Untracked files (all `.engineering-os/`):** `memory/agents/security-reviewer.journal.md`, `memory/features/feat-chore-migrate-legacy-to-brain.md`, `memory/features/feat-spike-legacy-migration-architecture.md`, run folders for both `chore-migrate-legacy-to-brain` and `spike-legacy-migration-architecture`, and state `.bak` files.
- **`git diff --stat`:** 10 files changed, 628 insertions, 8 deletions — all under `.engineering-os/`.

Zero paths outside `.engineering-os/**`. Zero changes to `legacy project/**`, `apps/`, `services/`, `packages/`, `pylibs/`, `protos/`, or any product code. **Guardrail HELD throughout the entire spike pipeline (Rohan independently verified at Stage 6; this re-confirms).**

---

## 2. Secret-hygiene scan — CLEAN (with one classified finding)

**Patterns scanned:** `sk-ant-`, `shpss_`, `GOCSPX-`, `SMTP_PASS`, Anthropic API key, `postgres://` / `postgresql://` connection strings, JWT-style `eyJ` bearer tokens, Supabase DB password value, SMTP app-password value, Shopify/Meta/Google OAuth secret values.

**Results:**

| Pattern | Files matched | Verdict |
|---|---|---|
| `sk-ant-` | 0 | CLEAN |
| `shpss_` | 0 | CLEAN |
| `GOCSPX-` | 0 | CLEAN |
| `SMTP_PASS` (value) | 0 | CLEAN |
| `postgres://` / `postgresql://` | 0 | CLEAN |
| `eyJ` JWT tokens | 0 | CLEAN |
| DB password value | 0 | CLEAN |
| SMTP app-password value | 0 | CLEAN |
| Shopify/Meta/Google OAuth secrets | 0 | CLEAN |

**Classified finding (non-secret, expected):**

The Supabase project reference `pavcgecgciamejdcysjx` and the pooler hostname `aws-1-ap-south-1.pooler.supabase.com` appear in **2 files**:
- `.engineering-os/runs/.../12-founder-decision.json` — intentionally recorded as the REGION FACT confirming ap-south-1; no password, no token, no key.
- `.engineering-os/pending-founder-attention.md` — resolution notice for the armed tripwire; same region-fact, no credential value.

**Classification:** These are host identifiers (equivalent to knowing the project exists in ap-south-1), not credentials. They carry zero authentication capability in isolation. The 12-founder-decision.json design intent is precisely to record only the region fact + "secrets-not-persisted" note — confirmed correct. No secret value leaked into any committed or staged file.

**Verdict: CLEAN.** No credential, password, API key, or token value of any kind is present in the `.engineering-os/` tree.

---

## 3. Residency-resolution recording — RESOLVED

**Prior status:** ARMED-unconfirmed (R-RES-01 / A2.0 tripwire). The legacy Supabase/Postgres region was undetectable from the repo (DATABASE_URL lived in an uncommitted `backend/.env`; 0 region markers in code or docs).

**Resolution (2026-05-24T01:40:00Z — Founder confirmation):**
- **Legacy Supabase/Postgres region confirmed:** `ap-south-1` (DATABASE_URL host: `aws-1-ap-south-1.pooler.supabase.com`)
- **DPDP §16 cross-border-transfer escalation:** NOT required — legacy data is already in-region. No data-residency-migration step is needed before Child 1.
- **No `/escalate` fired** — the tripwire resolved cleanly on the pass-through branch (ap-south-1 confirmed).

**What this means for Child 1:**
- CF-RES-1 (`GATE-ZERO`) status changes from "confirm-or-escalate" to "confirm-as-assertion": Child 1 must assert that the pooler host resolves to ap-south-1 BEFORE its RLS DDL touches the DB. This is now a verification step, not a blocker.
- `pending-founder-attention.md` residency item marked RESOLVED.
- A6 risk register item R-RES-01: RESOLVED (armed tripwire discharged on ap-south-1 confirm; residency constraint remains for any future DB migration).

---

## 4. Architecture binding confirmation

**Status:** BINDING as of Founder `/approve` at 2026-05-24T01:40:00Z.

The A1–A6 legacy->Brain migration architecture (`06-architecture-plan.md`) is now the authoritative reference for the 7-child migration program. All children must implement against it; amendment requires a new spike or a formal plan-amendment back to architect.

**What is binding:**

| Artifact | Status |
|---|---|
| A1 — Capability map (zero orphans, 44 models, 7 connectors, AI surface) | BINDING |
| A2 — Strangler-fig sequence (7-child DAG, RLS+session hard gate C5, residency tripwire Step-0 now confirmation) | BINDING |
| A3 — Facade / ACL design (no model leakage, single-writer, no-dual-homed-token) | BINDING |
| A4 — Per-slice parity + rollback + decommission (exact-integer-equality money, per-connector rollback tree) | BINDING |
| A5 — Dual-run shadow-compare (6 rules + Maya numeric harness + TS/Py ROUND_HALF_EVEN + ClickHouse shadow DDL) | BINDING |
| A6 — Risk register (6 absent NNs, PII boundary register, R-RES-01 resolved, R-FX-01, R-FIN-01, R-CRED-01, R-AUD-01) | BINDING |
| 9 persona concerns C1–C9 | BINDING (embedded in A1–A6) |

---

## 5. Carry-forward ledger for Child 1 (and named later children)

These 11 binding constraints from `10-cto-final-review.md §7` MUST be inherited by each named child. They are ADDITIONAL to the 9 concern-bindings C1–C9 already embedded in A1–A6. Each child's Stage-1 intake and Stage-4 security review must pick up the relevant rows. Missing one is a Stage-4 VETO at that child.

Plus one additional constraint arising from the secrets handling in this spike (see §5.6 below).

### 5.1 Security constraints (from Shreya, Stage-4 review)

**CF-SEC-1** — Binds: Child 1
Facade RLS+session gate must be a fail-closed, auditable predicate: GREEN derived from a live RLS-verification probe + cron-session-scope assertion (NOT a manually-toggled boolean); RED-by-default on unknown state; flip events written to the immutable Decision Log.
VETO surface: Stage-4 @ Child 1.

**CF-SEC-2** — Binds: Child 2, Child 4
Shadow-compare read path must be a physically-separate read replica or PITR snapshot AND the analytics read connection must be RLS-session-scoped per workspace (read-only role alone does NOT prevent cross-workspace `findMany` without RLS context). The G1+G2 gate applies to the analytics read connection, not only write paths.
VETO surface: Stage-4 @ Child 2/4.

**CF-SEC-3** — Binds: Child 1, Child 3
Establish the lawful basis for migration-time PII processing (DPDP §4) before consent primitive exists (likely DPDP §7 legitimate-use / existing-consent continuity). Document whether fresh notice/consent is required at cutover. If ambiguous at child-time → `/escalate` to Founder.
VETO surface: Stage-4 @ Child 1/3; `/escalate` candidate.

**CF-SEC-4** — Binds: Child 3
`oauth_states` (schema:843) reuse must be confirmed short-TTL + single-use + tamper-evident at connector cutover.
VETO surface: Stage-4 @ Child 3.

**CF-SEC-5** — Binds: Children 1, 2, 3, 4, 5, 6, and decommission (every runtime child)
Correlation-ID 4-tuple (`request_id` + `trace_id` + `workspace_id` + `user_id`) must propagate end-to-end through: the facade, every per-workspace-session cron invocation, every connector ingest event, every shadow-compare job, every Decision-Log / AI write. Missing-traceability is a Stage-4 VETO at every child that ships runtime.
VETO surface: Stage-4 @ each child.

### 5.2 QA constraint (from Tanvi, Stage-5 review)

**CF-QA-1** — Binds: Child 2
TS `roundHalfEven` must NOT use intermediate float arithmetic. Child 2 must implement TS rounding at Decimal precision (BigDecimal-equivalent, or scaled integers from the start) so TS↔Python byte-identity holds for large money values. The 6 CI test vectors are necessary but not sufficient; the implementation must be precision-safe by construction.
VETO surface: Stage-5 parity gate @ Child 2.

### 5.3 Maya pre-conditions (from A1.5 / A5.2 deepening)

**CF-MAYA-1** — Binds: Child 4
The Definitional-Delta Register is an explicit Child-4 deliverable: one row per (metric, source) where `legacy_formula != brain_formula` (e.g., P&L lagged-shipping CM2 vs `compute-daily.ts` actual-cost CM2). Each row reviewed + signed off by Rohan before Child-4 cutover. Money-exact-equality is insufficient where the CM2 definition itself changes.
VETO surface: Stage-6 sign-off @ Child 4.

**CF-MAYA-2** — Binds: Child 2
`WorkspaceCost` currency-at-entry migration is a Child-2 pre-condition: costs stored in workspace primary currency (date-stamped historical rate at entry), NOT relying on hardcoded `EXCHANGE_RATES` FX conversion at compute time. `WorkspaceCost.currency @default("USD")` mismatch (schema:256) is the contamination source.
VETO surface: Stage-2/4 @ Child 2.

### 5.4 Residency gate-zero (CF-RES-1, now a confirmation step)

**CF-RES-1** — Binds: Child 1 (gate-zero)
GATE-ZERO: assert that the live Postgres/Supabase pooler host resolves to ap-south-1 BEFORE Child-1 RLS DDL touches the database. Region confirmed at spike-close as ap-south-1; gate-zero now runs as a positive confirmation, not a blocker-or-escalate fork. If region has changed (e.g., Supabase migration since this spike) → immediate `/escalate` to Founder + freeze A2.
VETO surface: Child-1 gate-zero; R-RES-01 armed (now confirmation mode).

### 5.5 Summary table

| ID | Binds | VETO surface |
|---|---|---|
| CF-SEC-1 | Child 1 | Stage-4 @ Child 1 |
| CF-SEC-2 | Child 2, Child 4 | Stage-4 @ Child 2/4 |
| CF-SEC-3 | Child 1, Child 3 | Stage-4 @ Child 1/3; /escalate candidate |
| CF-SEC-4 | Child 3 | Stage-4 @ Child 3 |
| CF-SEC-5 | Every runtime child | Stage-4 @ each |
| CF-QA-1 | Child 2 | Stage-5 @ Child 2 |
| CF-MAYA-1 | Child 4 | Stage-6 @ Child 4 |
| CF-MAYA-2 | Child 2 | Stage-2/4 @ Child 2 |
| CF-RES-1 | Child 1 (gate-zero) | Child-1 gate-zero |
| CF-SEC-SECRETS-1 (new) | Child 1 (first runtime child) | Stage-4 @ Child 1 |

**Total: 10 rows in this table (11 unique constraints counting CF-SEC-SECRETS-1 separately).**

### 5.6 New constraint: Secrets provisioning (from Stage 8 secrets handling)

**CF-SEC-SECRETS-1** — Binds: Child 1 (and every subsequent child that needs legacy connector credentials)
Founder shared live legacy environment secrets in the approval chat (Supabase DB password, SMTP app-password, Shopify/Meta/Google OAuth secrets, Anthropic API key). These are NOT in the repo (hygiene confirmed above). Child 1 MUST provision all legacy credentials through AWS Secrets Manager — never committed to git. Founder was advised to rotate all exposed credentials; Child 1 should verify rotation has occurred before using any legacy credential in its dual-run phase.
VETO surface: Stage-4 @ Child 1.

---

## 6. Epic state update

| Epic field | Value |
|---|---|
| `chore-migrate-legacy-to-brain.architecture_binding` | `true` |
| `chore-migrate-legacy-to-brain.next_child_to_file` | `child-1-tenancy-auth-rls-hardening` |
| `spike-legacy-migration-architecture.status` | `done` |
| `spike-legacy-migration-architecture.completed_at` | `2026-05-24T07:14:41Z` |

---

## 7. Readiness checks summary

| # | Check | Result |
|---|---|---|
| R1 | No-prod-code guardrail: git status shows only .engineering-os/** | PASS |
| R2 | Secret-hygiene: no credential values in .engineering-os/ tree | CLEAN |
| R3 | Residency resolved: legacy DB confirmed ap-south-1 | RESOLVED |
| R4 | Architecture binding confirmed: A1-A6 + 9 concerns + 11 constraints | CONFIRMED |
| R5 | Carry-forward ledger captured for Child 1 | CAPTURED |
| R6 | Epic ready to spawn Child 1 | READY |

All 6 checks PASS / resolved. Spike is done.

---

## 8. Rollback

Not applicable — no runtime artifact deployed. The architecture is a set of documents. If the design is found infeasible or needs reshaping, the mechanism is:
1. File a new `/requirement` to reopen the architecture (a new spike or an amendment).
2. Architect (Aryan) + co-owners produce an amended A1–A6 plan.
3. Run through the full pipeline again (including Founder ratification as a program-shaping gate).

No infra, no blast radius. No `git restore` needed (no product code was staged).
