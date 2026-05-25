# Retro — feat-frontend-dashboard-morningbrief (Child 6)

> Filled by CTO Advisor (Rohan) at the close of Stage 6. Append-only.
> Feeds the lessons-learned registry at `.engineering-os/lessons-learned.md`.

| Field | Value |
|-------|-------|
| **req_id** | `feat-frontend-dashboard-morningbrief` |
| **Parent req_id** | `chore-migrate-legacy-to-brain` (Child 6 of 7) |
| **Shipped at** | 2026-05-25T11:10:00Z (Stage-6 PASS; Founder gate signed under delegation; no commit) |
| **Author** | cto-advisor (Rohan), on Founder's behalf under standing delegation |

---

## What worked (concrete patterns to replicate)

- **Proto-first, in-process-bound data seam (CF-C6-DATA-SEAM-1).** Aryan ruled the gateway↔Python seam as gRPC contracts authored NOW (`metrics.proto` + `intelligence.proto`) but bound in-process/loopback for Phase-0, with ONE `DataPlanePort`. This avoided the Shape-B "figure-it-out-during-build" trap that bit Child-1, and makes the Phase-2 service split a config flip, not a rewrite. The contract source-of-truth lives in the protos; the BFF always speaks the contract.
- **The three killed-mutant integrity gates were genuinely non-vacuous.** I broke each one myself at Stage-6 (superjson removed → live wire breaks; traceability throw disabled → orphan test RED; dedup disabled → double-write RED). This is the 7th occurrence of the verify-the-verifier lineage and the gates held — the discipline (real-path test + killed mutant per gate, bound at Stage-2, captured at Stage-5, re-mutated at Stage-6) is now routine.
- **The runnable-harness was treated as a first-class acceptance bar, not a nicety.** Tanvi VETOed round-1 specifically because `pnpm dev` couldn't boot (B1). That forced `server.ts` into existence and made the Founder's "an app I can see" goal a captured, reproducible boot — which I independently re-ran (port open in ~1s, seeded ₹18.5L/₹3.2L with a live UUID). A UI that can't run fails its own acceptance; QA enforcing that was correct.
- **Render-only held end-to-end under grep.** Zero arithmetic outside formatMoney across web/mobile/gateway; the only `Number(_mu)` are documented SVG-pixel coercions. The UI literally cannot corrupt a number — money crosses the wire as superjson bigint and formatMoney is the sole transform.
- **Single-Primitive discipline survived three parallel builders.** ONE formatMoney, ONE idempotency primitive, ONE auth choke, ONE DataPlanePort — across Vikram (BFF) + Ananya (web) + Karan (mobile). The V1 handshake (typed contract) gating A/K was the right serialization point.

---

## What didn't work (concrete patterns to avoid)

- **A declared `dev` script with no entrypoint shipped to QA (B1).** `apps/api-gateway/package.json` had `"dev": "tsx src/interfaces/server.ts"` but `server.ts` did not exist. The whole point of this child was a runnable app, and the runnable seam was the one thing missing at first submission. The integrity-gate tests were green (they use `createCaller`, in-process) so the gap hid behind a green unit suite — the runnable surface was never exercised until QA tried to boot it.
- **The H1 errorFormatter fix's killed-mutant test asserts against a replica, not the live closure.** Mutating the production `errorFormatter` does NOT turn the test RED (I verified). The fix itself is correct (direct read + live success-path UUID), but the test can't catch a regression in the production file. Honestly logged by Shreya as SEC-C6-L2. A killed-mutant test that can't see the production code it guards is one notch above tautological.
- **`createCaller`-based gate tests don't exercise the serializer.** G-BIGINT's real protection is superjson on the HTTP wire, but the gate's vitest uses `createCaller` (in-process), which skips the transformer — so the test passes even with superjson removed. The true G-BIGINT verification is the live HTTP boot (which exists, in `server.test.ts` + my curl), but the gate test name overclaims relative to what it exercises.

---

## What surprised us

- **The error-path client-body `requestId` is absent on the Zod input-validation path** (I found this booting the mutant and the real server). The correlation id IS logged by `server.ts onError` with the real UUID, and post-context errors carry `request_id=` in the message string — so operator traceability is met — but the `error.data.requestId` field the web ErrorDisplay binds to is not populated on a pre-procedure Zod failure. This refines SEC-C6-L2 and is narrower than feared (it's a surface-completeness gap, not a traceability loss).
- **The "missing-entrypoint" bounce is a fresh root cause, not a recurrence.** A semantic search lit up 4 prior runs, but on inspection those are migration *parity/reconciliation* harnesses — unrelated. Child-6's B1 (declared-script-no-entrypoint) is a single occurrence → a lesson, not yet a rule.
- **Header-trust context factory is acceptable Phase-0 precisely because the HOLD is binding.** Normally a client-controlled `x-workspace-id` would be a P0 tenancy VETO. It's in-scope-acceptable here ONLY because CF-C6-HOLD-AT-ROUTE-FLIP guarantees zero live traffic + single local workspace, and the production JWT-verify path is documented as the cutover requirement. The discipline that makes this safe is the explicit, enforced HOLD — not the code.

---

## Lessons to file in the registry

| # | Lesson (one-line) | Applies to | Evidence |
|---|---|---|---|
| 1 | A declared `dev`/`start` script whose entrypoint file does not exist must be a Stage-3 self-check failure, not a Stage-5 discovery — for any "runnable" deliverable, the builder boots it once and captures output before handoff. | `process`, `pipeline-mechanics`, `code` | B1 VETO: `10-qa-review.md` (blocked smoke), `08b-bounce-fix-report-vikram.md` §2, fixed in `server.ts` |
| 2 | A killed-mutant test must invoke the SAME production code path it guards; a test that asserts against a replica/`_config` structural double can be green while the production closure is wrong. | `code`, `security`, `agent-discipline` | SEC-C6-L2: `trpc.errorformatter.test.ts` (replica `buildFormatterOutput`); confirmed by Rohan — mutating prod `trpc.ts` did not turn the test RED |
| 3 | tRPC `createCaller` skips the serializer transformer; serializer-level gates (e.g. bigint via superjson) must be verified over a real HTTP boot, not only via `createCaller`. | `code`, `numeric-parity` | G-BIGINT: `createCaller` test passes with superjson removed; the live HTTP curl (`server.test.ts` + Rohan's boot) is the true gate |
| 4 | Header-trust auth is acceptable in a LOCAL Phase-0 harness ONLY behind an explicit, binding HOLD with the production JWT-verify path documented as the cutover requirement. | `security`, `migration` | `server.ts:84-93`, `HARNESS.md §M2`, CF-C6-HOLD-AT-ROUTE-FLIP; Shreya `09b` disposition |
| 5 | Render-only is enforceable by grep when the contract puts the ONE transform (formatMoney) in one home and bans arithmetic on `_mu` everywhere else; pixel coercions need a named `< 2^53` invariant comment. | `single-primitive`, `code` | `format-money.ts`, `registry-mapper.ts`, CF-C6-BIGINT-PIXEL-INVARIANT in `cm-waterfall-chart.tsx` |

---

## Action items for next child (Child 7 / 6b long-tail)

- Before handing off any "runnable" deliverable, **boot it and capture `/health` + one real query** — make this a Stage-3 DoD line, not a Stage-5 catch.
- When a gate guards a framework-internal closure (errorFormatter, serializer, middleware), **prefer a real-HTTP/integration fixture over a replica double**; if the framework genuinely can't expose it (tRPC v11 createCaller), say so explicitly AND add a live-path assertion (don't let the replica be the only evidence).
- At the route-flip cutover gate (Child-7/Stage-8): wire production JWT-verify + membership lookup (kill header-trust), wire M1 `buildGrpcMetadata` + M2 gRPC-boundary trace, install real cert-pin hashes, and re-sign (Rohan). The runnable PASS does NOT authorize a live flip.
- Confirm ONE mobile chart lib for 6b (victory-native vs the web's Visx) and re-affirm the no-AsyncStorage-for-tokens invariant when offline state grows.

---

## verify-the-verifier lineage note (NOT self-adopted)

This is the **7th occurrence** of the verify-the-verifier-mutation-on-gate lineage (Children 1/2/3/4/4/5 = 6 prior; Child-6 = 7th). Here it was **beaten**: all three named gates (G-BIGINT/G-IDEMPOTENT/G-REGISTRY-ONLY) were mutated by Rohan at Stage-6 and went RED. The standing rule-proposal `.engineering-os/rule-proposals/2026-05-25__verify-the-verifier-mutation-on-gate.md` already exists with 6 evidence points; Child-6 is appended as the 7th. **NOT self-adopted** — it becomes a durable rule only when a human runs `/adopt-rule`. Surfaced in `pending-founder-attention.md`. The secondary Child-6 data point (lessons #2/#3 above) sharpens the rule: the killed-mutant must invoke the production path, and serializer-level gates need a real-HTTP fixture — a `createCaller`/replica test can be vacuous in the same way an inert SQL probe was.
