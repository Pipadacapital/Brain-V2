# Architect — Journal

> Append-only. See /Users/rishabhporwal/.claude/plugins/cache/brain-engineering-os-marketplace/brain-engineering-os/0.23.0/docs/role-empowerment-model.md for entry shape.

## 2026-05-23T12:48:01Z — system — bootstrap
**Action:** Journal initialized by /eos init on 2026-05-23T12:48:01Z.

## 2026-05-23T23:24:49Z — Aryan (architect) — chore-scaffold-monorepo
**Stage:** 2
**Action:** Produced binding scaffold plan (06-architecture-plan.md) for the Brain monorepo root — §9.1 tree + working four-tool toolchain (Turborepo+pnpm / uv / Buf, Node 24 / Python 3.13) + DDD .gitkeep layers + day-one-non-negotiable homes. Resolved all 8 binding inputs from Rohan's synthesis.
**Paradigm:** n/a (no compute path — structure + toolchain only; confirms @paradigm decorator's home exists per Rohan's standing Stage-1 record).
**Tracks emitted:** 1 — scaffold-monorepo-root-and-toolchain (@vikram, single track; no parallel fan-out — web/mobile/intelligence dirs are .gitkeep homes only).
**8 inputs resolved:** (1) Python services as turbo root tasks docker:build:ingestion|analytics|intelligence with file-hash inputs globs (turbo --affected is blind to uv members); (2) buf.gen.yaml out: → packages/proto-ts + pylibs/proto_py as named workspace-member stub packages; (3) generated stubs gitignored + regenerated-in-CI; (4) enumerated pnpm members (not apps/**) + turbo/.tsconfig/.gitignore excludes for .venv/uv.lock/dist-info, commit both lockfiles; (5) all 5 pins (.node-version 24, packageManager exact pnpm, .python-version 3.13, requires-python >=3.13<3.14, buf v2) + TOOLCHAIN.md; (6) tools/check-metrics-parity.sh stub + check:metrics-parity turbo task; (7) DECISIONS.md records the irreversible choices; (8) acceptance contract tightened with both-sides import smoke + parity-stub run.
**Single-Primitive sweep:** all clean — one home per primitive, zero per-channel/region/vendor forks; only new packages are proto-ts/proto_py (implementation of proto-first non-negotiable, not new abstraction).
**Acceptance contract:** pnpm install / turbo graph (incl. docker:build:* tasks) / uv sync / buf lint+build / buf generate + TS & Python import smoke / import brain_metrics / turbo run check:metrics-parity exit 0 / structural assertion (9 apps dirs, 5 DDD folders each backend svc, NO controllers/, 5 pins, DECISIONS.md).
**Skills loaded:** architecture-patterns, domain-driven-design, region-adapter, engineering-discipline, verification-before-completion.
**Open questions:** none.
**Next:** @vikram (backend-developer) — Stage 3 (single track).

## 2026-05-24T01:11:34Z — Aryan (architect) — spike-legacy-migration-architecture
**Stage:** 2 (co-owned with Maya/intelligence)
**Action:** Produced the binding legacy->Brain migration architecture (A1-A6) in 06-architecture-plan.md. Design-only spike; ZERO legacy/product code touched (git status = only .engineering-os/**; verified).
**Paradigm:** n/a for the spike (no compute path); program is sql-dominant (Children 1-4 deterministic SQL; only Child 5 carries small/frontier-LLM @paradigm, deferred to Child 5).
**Artifacts:** A1 capability-map (44 models + routes/lib + 7 connectors + ~204 tsx grouped -> Brain service+context, reuse/refactor/redesign + missing-NN tags, ZERO orphans; AuditLog null-workspaceId dispositioned C9). A2 strangler-fig sequence (7 children, DAG no-cycle, RLS+session HARD gate column C5, armed residency tripwire A2.0 C6). A3 facade/ACL (no Decimal/no-RLS-model leakage; workspace_daily_metrics single-writer C2; routing flip). A4 per-slice parity+rollback+decommission (exact-integer-equality money C7; per-connector rollback tree C1). A5 dual-run shadow-compare (6 binding rules; STUB demarcated for Maya). A6 risk register (6 NN + leak + PII/residency register + money + per-connector token-handoff ceremony C1 + cred rotation C8).
**Ground-truth (file:line):** middleware/workspace.ts:30-52 (app-layer-only iso); cron.ts:65 + meta/google/shiprocket-sync findMany (cross-workspace fan-out); compute-daily.ts:32-65 float; pnl.ts:42-56 hardcoded INR:83.5 FX; ShopifyConnection.accessToken:286 single-owner; ai-engine/providers/router.ts:6-18 direct Claude SDK no gateway; insight-cache.ts:9-18 filtersHash; AuditLog.workspaceId? schema:658; plaintext creds (Shiprocket/Unicommerce/Klaviyo/Woo/Shopify). Residency UNCONFIRMABLE from repo (.env not committed; 0 region markers) -> tripwire ARMED.
**Single-Primitive sweep:** clean — facade/ACL is minimum for reversible strangler-fig; no speculative layers; no new deps (design-only).
**Persona concerns:** 9/9 addressed + traceable (C1-C9 mapped to A-artifacts).
**Maya-owned stubs (demarcated):** A1.5 (data/AI-surface mapping, Qs M-A1-Q1..Q3) + A5.2 (numeric shadow-compare, Qs M-A5-Q1..Q3). Constraint: extend, don't re-home models / don't relax the 6 A5.1 rules without a plan-amendment.
**Skills loaded:** architecture-patterns, domain-driven-design, multi-tenancy-isolation, integration-connectors, metric-engine, event-driven-kafka, region-adapter, data-residency-enforcement, audit-log-immutability, api-versioning-strategy, decision-log.
**Open questions:** residency region (armed tripwire — Maya/anyone confirms during deepening); Maya's M-* Qs.
**Next:** Maya (intelligence-engineer) deepens A1.5 + A5.2, then parallel Security (Shreya) + QA (Tanvi) review.

## 2026-05-24T07:43:15Z — Aryan (architect) — feat-tenancy-auth-rls-hardening
**Stage:** 2 (Child 1 of EPIC chore-migrate-legacy-to-brain — FIRST code-moving strangler slice; data-layer isolation gate)
**Action:** Produced the binding Child-1 build plan (06-architecture-plan.md). DESIGN ONLY — ZERO live data touched, ZERO legacy/product code edited (git status = only .engineering-os/**; verified). Build is HARD-GATED on the DPDP lawful-basis instrument (CF-SEC-3.HARD) — plan proceeds, build does not.
**Paradigm:** SQL/DDL + connection-handling (no ML/LLM) — Rohan Stage-1 sign-off; no Maya co-owner (no metric/money/AI/numeric-parity); FK-scope EXPLAIN surfaced no metric-rollup dependency.
**Scope:** 1a (data-layer isolation = C5-gate-establishing, ships first, additive+reversible) -> 1b (auth/role-claim contract, behind 1a). 1a independently committable/reversible with gate GREEN before 1b.
**Key decisions (all settled, not deferred):**
- CF-C1-POOL-1.a: rlsPrisma 2nd client on DIRECT_URL :5432 session-mode + tx-local set_config(app.workspace_id,$1,true) inside explicit $transaction via withWorkspace(); session-level SET banned; injection-safe bind param. Interleaved-tenant test on :6543 (bleed->0, contextless->0) is G1 gate.
- CF-C1-FK-SCOPE-1.a: ALL 45 models classified (21 direct / ~18 connId-FK 1-hop / 1 orderId-FK 2-hop WoocommerceLineItem / 4 global User/Workspace/SystemSettings/AuditLog). Default JOIN-policy + live EXPLAIN(ANALYZE,BUFFERS) decision-gate per table; escalate hot tables shopify_orders/shopify_line_items to workspace_id denorm via additive col + chunked(5000) online backfill + CONCURRENTLY index + IS-NULL=0 verify (reversible). Zero workspace-scoped table left unprotected.
- CF-C1-RLS-DEFAULT-1.a: USING/WITH CHECK = (col = current_setting(app.workspace_id,true)::uuid) -> NULL=>0 rows (proven fail-closed). Banned OR-IS-NULL / COALESCE / USING(true) / session-SET / bare-singleton-RLS-query (Tanvi static hard-fail). CF-SEC-1 probe RED-by-default -> GREEN on (cross-read=0 AND contextless=0) per table, Decision-Log transition with 4-tuple.
- Rollout (CF-C1-ROLLOUT-ORDER-1 + QUIESCE-1 + RES-1.a + R2 + R4): STEP0 region-assert(BOTH URLs, Postgres-level) -> STEP1 quiesce-crons-FIRST (harness asserts 0 cross-ws findMany) -> STEP2 deploy context-code (owner bypass, no RLS) -> STEP3 ENABLE+CREATE fail-closed policy -> STEP4 probe GREEN -> STEP5 FORCE per table -> STEP6 byte-identical smoke + clean cron tick. G1+G2 GREEN TOGETHER, one deploy. Rollback = NO FORCE+DISABLE+DROP POLICY (DDL, corrects A4 Child-1 text).
- CF-C1-CRON-SCOPE-1.a: wrap each syncAll* per-connection unit in withWorkspace(c.workspaceId); outer enumeration under withSuperadmin; preserve per-connection try/catch + proof-of-attempt log; Shiprocket no-replay -> attempted-vs-connected alarm (silent-drop detector).
- CF-C1-AUDITLOG-1.a: dual-policy (ws-scoped + SUPERADMIN-only app.is_superadmin for null rows) + §12 erasure under withSuperadmin userId-only; compatible with deferred Child-5 sentinel.
- CF-RES-1.a: STRENGTHENED by ground truth — .env.bak.singapore shows DB was previously ap-southeast-1 (Singapore); a region move ACTUALLY happened -> region must be LIVE-asserted on BOTH :6543 + :5432, never trusted.
- CF-SEC-5: 4-tuple {request_id,trace_id,workspace_id,user_id} via AsyncLocalStorage through withWorkspace + cron + probe. CF-SEC-SECRETS-1: both pool URLs via Secrets Manager (rotate exposed creds first).
**Single-Primitive sweep:** clean — withWorkspace/withSuperadmin = the minimum sanctioned context-setter (one home, not future-proofing); rlsPrisma implements canon layer-3, not a new layer; second client uses existing @prisma/client (no new deps).
**10/10 persona concerns homed** (R1 §2b, R2 §5, R3 §3, R4 §4, R5 §6, C1 §5 STEP1, C2 §11 BUILD-GATE, C3 §5 STEP0, C4 §7, C5 §12 PII-register).
**Tracks emitted (all BLOCKED on CF-SEC-3.HARD):** 1a-A..1a-F + 1b -> @vikram (backend; 1a-F exec @jatin Stage 8). @ananya NOT needed (no frontend auth wiring). No new service -> no deploy-pipeline track (runbook is the deploy artifact).
**Skills loaded:** database-design, multi-tenancy-isolation, auth-and-access, security-baseline, data-privacy-dpdp, data-residency-enforcement, audit-log-immutability, writing-plans, progressive-delivery, region-adapter.
**Open questions:** none for design. Build BLOCKED on Founder lawful-basis instrument (CF-SEC-3.HARD) + region-assert is an armed runtime tripwire.
**Next:** Orchestrator should STOP after Stage 2 + surface to Founder (escalation already in pending-founder-attention.md). Stage-3 @vikram only after gate lifted.
