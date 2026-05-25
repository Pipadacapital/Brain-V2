# Stage-8 Operator Execution Handoff — `feat-legacy-decommission` (Child 7, FINAL)

> This is the `07-handoff-to-developer.md` equivalent for a **runbook child**. There is no Stage-3 builder. The "developer" here is the **Stage-8 operator: Jatin**, executing at the eventual production cutover, with the **Founder at console** for every irreversible step. This handoff tells Jatin exactly what to run, in what order, what to verify, and where the Founder must authorize. It binds to the PoNR ledger in `06-decommission-runbook.md` §6.

| Field | Value |
|-------|-------|
| **req_id** | `feat-legacy-decommission` |
| **Handoff lane** | high-stakes (irreversible retirement + credential destruction + DPDP) → separate `07` file (prescriptive) |
| **Executor** | Jatin (operator) + Founder (authorization at console) |
| **Gate before execution** | Rohan Stage-6 sign-off of `06-decommission-runbook.md` (compliance + reversibility) + the DDR full sign-off (the 2 remaining rows) |
| **Source of truth** | `06-decommission-runbook.md` §5 (sequence), §6 (PoNR ledger), §7 (CF-C7 gates), §8 (final-state checklist), §9 (archive format) |

---

## 0. Before you start (Stage-8 pre-flight — run ONCE per session)

1. **Confirm Rohan signed `06-decommission-runbook.md`** (Stage-6 compliance + reversibility = the gate). Do not execute an unsigned runbook.
2. **Festival pre-flight (CF-C7-FESTIVAL-WINDOW-1)** — run and require an empty result:
   ```sql
   SELECT name, festival_date
   FROM   workspace_festivals
   WHERE  festival_date BETWEEN NOW() AND NOW() + INTERVAL '14 days';
   ```
   **Any row → ABORT the whole session.** Re-run before EACH irreversible step (L1 Shiprocket, L3, L6), not just at the start.
3. **Residency assert** — Brain stores (Supabase, ClickHouse Cloud, MSK, S3) + the planned archive all `ap-south-1`. An out-of-region archive is a DPDP §16 violation → ABORT.
4. **Custody readiness (FOUNDER GATE — build_gated_on, see §1)** — confirm the chosen Option A/B `seal()`/`get()` is a **real implementation (non-`NotImplementedError`)**. If still a stub → the connector cutover (Step 2 / L1) is BLOCKED. (FORCE / L0 may still proceed.)
5. Open the **Stage-8 execution log**: for every PoNR row you will record `{step, verification command, captured output, operator sign, Founder sign, timestamp}`.

---

## 1. Founder-at-console authorization points (the irreversible gates)

The Founder must be at console and explicitly authorize EACH of these. None is a default or a delegated auto-approve.

| # | Authorization point | What the Founder is authorizing | Precondition that MUST be GREEN first |
|---|---|---|---|
| **AUTH-CUSTODY (build_gated_on)** | **Real `seal()` confirmed** | That the chosen Option A (AWS Secrets Manager ap-south-1, `aws_secrets_manager_custody.{put,get,seal}` real) OR Option B (Supabase-column encrypt-in-place, `supabase_column_custody.{put,get,seal}` real, Sugandh-Lok-only, AES-256 at-rest ap-south-1) is a **real implementation, not a config swap between two stubs**. | The Child-3 stubs are replaced; a real `seal()`→`get()` round-trip succeeds. **This is the FIRED escalation addendum to the open Child-3 custody escalation — see `pending-founder-attention.md`.** |
| **AUTH-DELETE (per connector, Shiprocket last)** | Each legacy plaintext-credential DELETE (PoNR #1) | The CF-C7-CUSTODY-PROOF-1 checklist (§2 L1) is fully signed: real `seal()` + prod-custody-path vendor-200 + parity GREEN. | Festival gate empty; the connector is lowest-risk-first; Shiprocket LAST. |
| **AUTH-READ-DECOMMISSION** | The `legacy-reads-decommissioned` transition (PoNR #2) | Gate P2 GREEN on Brain-Child-3-sourced data + **Rohan signed DDR rows `total_tax_mu` + `fx_restatement`** + the 24h serve-dwell signed. | Festival gate empty. |
| **AUTH-SHUTDOWN** | Legacy `looqus` app + DB shutdown (PoNR #3, terminal) | The full final-state checklist (§8 of the runbook) GREEN + archive verified restorable + archive option (ALPHA/BETA) chosen. | Festival gate empty. |
| **AUTH-ARCHIVE-DELETE** | Archive deletion (PoNR #4, SEPARATE DATE) | Retention window elapsed + `§12-requests-pending = 0`. | This is months after AUTH-SHUTDOWN. Do not confuse the two. |

---

## 2. The execution sequence (per the PoNR ledger §6 — run in this order)

> For each step: run the verification command, capture the output into the execution log, get the sign-offs, THEN proceed. Reversibility action is your rollback IF the step's verification fails before its PoNR.

### Step 1 / L0 — Release HOLD-AT-FORCE (Child-1 RLS) — NO PoNR
- **Verify pre-req:** complete bare-write grep = **0 hits** (incl. `backfill*`/`discoverChannels` — the legacy grep was defective, do NOT use the `grep -v` that excludes them); per-table `EXPLAIN` shows the RLS predicate.
- **Execute:** per Child-1 6-step rollout (`down.sql` is your rollback). FORCE is a **ramp** — it begins here and *completes* only after Shiprocket cutover (Step 2, last) removes the final legacy writer.
- **Rollback (fully reversible):** `NO FORCE → DISABLE ROW LEVEL SECURITY → DROP POLICY`.
- **Sign:** operator. (No Founder authorization — not a PoNR.)

### Step 2 / L1 — Release HOLD-AT-CUTOVER (Child-3 connectors) — per-connector PoNR #1
For EACH connector, **lowest-risk first, SHIPROCKET LAST (no replay):**
1. Run the festival gate (must be empty).
2. **write → live-auth-test via the PRODUCTION custody path** (NOT a direct legacy-DB-column read) → must return vendor **HTTP 200**.
3. **parity GREEN** (event-count + key-field spot-check, Child-3 A5 M-A5-Q3) within the rollback window N.
4. **seal** the credential in Brain custody (the real `seal()`).
5. Sign the per-connector CF-C7-CUSTODY-PROOF-1 checklist (operator + **Founder AUTH-DELETE**).
6. **DELETE the legacy plaintext credential (PoNR #1).**
- **Rollback (UNTIL the DELETE):** hand the token back to legacy + re-register the legacy webhook (or re-enable the legacy poll cron, Shiprocket polling-gap days=7) + replay from the vendor API where supported (Child-3 A4 tree).
- **Shiprocket note:** longest pre-cutover shadow (≥2 weeks); explicit pre-cutover festival blackout (72h); no replay → if the Brain Shiprocket connector has a silent ingest defect, there is no event-recovery path. This is the single highest-irreversibility step in the program. Do not rush it after the other connectors succeed.

### Step 3 / L2 → L3 — Release HOLD-AT-READ-FLIP (Child-4 metrics)
- **L2 (reversible):** with **Gate P1** GREEN (legacy-sourced parity), flip to `Brain-writes/legacy-reads-fallback`. Rollback: flip the read flag back.
- **BEFORE L3:** ensure Step 4 (HOLD-AT-SERVE) has been flipped AND its **24h sustained-stability dwell is signed** (CF-C7-SERVE-READ-COUPLING-1). Do NOT cross L3 in the same session as the serve-flip.
- **L3 (PoNR #2):** require **Gate P2** GREEN — `bash tools/check-metrics-parity.sh` exit 0 on **Brain-Child-3-sourced** input (after Shopify cutover) AND **Rohan's full DDR sign-off (11/11 rows, incl. `total_tax_mu` + `fx_restatement`)**. Run the festival gate. Get **Founder AUTH-READ-DECOMMISSION**. THEN flip to `legacy-reads-decommissioned`.
- **Past L3:** the metric rollup (billing base, single-writer C2) is Brain-authoritative-only; the AI rollback tree (Step 4) is also gone.

### Step 4 / L4 — Release HOLD-AT-SERVE (Child-5 AI) — flip BEFORE crossing L3
- **Pre-req:** Child-4 at `legacy-reads-fallback` (L2), NOT yet `legacy-reads-decommissioned`.
- **Execute:** Brain AI reads ClickHouse-authoritative + **fire CACHE-PURGE-C4C5** → verify **post-purge stale-narration count = 0** (the serve-gate blocks otherwise) + per-agent graduation. **Retire the legacy AI path:** `legacy project/backend/src/module/ai/*`, `SystemSettings.ollamaUrl` (schema.prisma:924), `OLLAMA_*` env.
- **Dwell (CF-C7-SERVE-READ-COUPLING-1):** observe **≥24h of stable serving** (zero user-visible error escalation), then **sign the sustained-stability gate**. Only after this signature may L3 (PoNR #2) be crossed.
- **Rollback (ONLY while Child-4 not yet `legacy-reads-decommissioned`):** re-enable the legacy AI read path + re-enable legacy reads.

### Step 5 / L5 — Release HOLD-AT-ROUTE-FLIP (Child-6 frontend) — per route group, reversible
- Per route group: flip the facade from legacy to the Brain surface; confirm **production JWT-verify + membership lookup** (reject an unsigned/foreign-workspace token); land M1+M2 (gRPC tenancy/trace); real cert-pin hashes for the mobile build. Rohan re-signs at the cutover gate.
- **Rollback:** per route group, re-point the facade to legacy (Child-0 A4). Reversible until Step 6.

### Step 6 / L6 — Legacy `looqus` app + DB SHUTDOWN — TERMINAL PoNR #3
- **Verify the full final-state checklist (`06-decommission-runbook.md` §8) — every line GREEN.**
- **Produce the archive (§9):** Option ALPHA (Postgres live-but-read-only in ap-south-1) OR Option BETA (S3 Parquet partitioned by `workspace_id`, ap-south-1). **Run the archive restore-test:** restore a sample workspace partition, assert row-count + checksum match. Carry `AuditLog` null-rows as system-workspace-sentinel.
- Run the festival gate. Get **Founder AUTH-SHUTDOWN**.
- **Shut down the legacy app + DB (PoNR #3).** This is "archive" — record the date.
- Write the PII-free `audit_log` entry for the shutdown.

### Step 7 / L7 — Archive DELETION at retention-expiry — PoNR #4 (SEPARATE DATE)
- **This is months after Step 6.** Do not delete the archive at shutdown.
- **Trigger:** retention window elapsed (§9: shorter-of-5y-or-legal-obligation, whichever law requires longer) **AND** `§12-requests-pending = 0`.
- **During retention:** a DPDP §12 request = a scoped `DELETE WHERE workspace_id=? AND (email=? OR customer_email=?)` (ALPHA) or `s3:DeleteObject` on the workspace partition (BETA), then keep the PII-free audit entry.
- Get **Founder AUTH-ARCHIVE-DELETE.** Delete the archive (PoNR #4). Write the PII-free `audit_log` entry. The 7y `audit_log` survives this.

---

## 3. What stays HELD / Founder-gated going into Stage-8 (summary)

- **Real `seal()` implementation (build_gated_on, CF-C7-CUSTODY-PROOF-1)** — Founder confirms Option A/B is a real non-stub impl before AUTH-DELETE. FIRED escalation addendum (open Child-3 custody escalation).
- **Rohan's full DDR sign-off** (the 2 remaining rows `total_tax_mu` + `fx_restatement`) — sequenced AFTER Shopify cutover (L1), BEFORE the read-decommission PoNR (L3).
- **The archive option (ALPHA/BETA)** — Founder/Jatin pick at Stage-8; both satisfy §12 (NOT an escalation).
- **The cutover calendar** — Founder/Jatin own it; the festival machine gate enforces the 14d/7d window.
- **Every PoNR** — Founder authorizes at console (§1).

---

## 4. Acceptance contract for the Stage-8 execution (what "done safely" means)

Jatin's execution is complete and safe iff:
1. Every PoNR (#1 per-connector, #2 read-decommission, #3 shutdown, #4 archive-deletion) was crossed only after its named CF-C7 gate GREEN + festival gate empty + Founder authorization, each captured in the execution log.
2. The 24h serve-dwell was signed before PoNR #2.
3. Shiprocket was last; each plaintext-delete was preceded by a signed CF-C7-CUSTODY-PROOF-1 checklist (real `seal()` + prod-path-200 + parity).
4. The final-state checklist (§8) is fully GREEN; the archive is §12-erasure-executable in ap-south-1; "archive" (L6) and "decommission" (L7) are two dated steps.
5. Legacy AI (`module/ai/*`, `SystemSettings.ollamaUrl`, Ollama env) is retired; zero Brain read path to legacy rollups; single-writer C2 final state reached; `CF-BN-NOLEGACY-1` held (legacy never edited).

---

## 5. Confirm: this child is runbook-only

No app code. No `@paradigm` decorator. No new runtime. No git commit. No legacy edit. The only artifacts are `06-decommission-runbook.md` + this handoff. **Next: Rohan Stage-6 compliance + reversibility sign-off (the gate).** Execution is Stage-8 (Jatin + Founder at console).
