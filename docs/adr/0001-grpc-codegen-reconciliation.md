# ADR-0001 — gRPC Codegen Reconciliation (Python stacks: betterproto/grpclib vs grpcio)

**Author:** Aryan (Architect) · **Date:** 2026-06-03 · **Status:** **ACCEPTED** (ratified by Founder 2026-06-03 → Option A, grpcio end-to-end)
**Ratification:** Founder approved Option A and authorized the analytics + intelligence grpcio migration (Steps 0/2/3 + the wire-RPC CI gate). Step 4 (betterproto decommission) stays deferred one release cycle per the plan.
**Surfaced by:** real-time ingestion epic (`docs/realtime-ingestion-plan.md`). **@paradigm:** sql + io/event-handling (no ML, no LLM — pure toolchain/contract decision).
**Blast radius:** all internal gRPC contracts in `protos/`, the 3 Python services, the api-gateway BFF client layer, `protos/buf.gen.yaml`, CI.
**Do NOT undo:** the interim webhook patch (`apps/ingestion-service/src/interfaces/grpc/_pb2/`) — it is the live ingestion server contract and this ADR formalizes its generalization, not its removal.

---

## 1. Context & Problem

`protos/` is the contract-first source of truth (TECH §1, rule 10). One `buf generate` is supposed to produce the client/server stubs for both languages. **It does not — the generated Python stub family and the actual Python runtime are two different gRPC stacks, so the generated server contract was never the one being served.**

### The mismatch (file evidence)

**Codegen says grpclib/betterproto.** `protos/buf.gen.yaml:17` pins the Python plugin to `buf.build/community/danielgtaylor-betterproto:v1.2.5`, emitting into `pylibs/brain_grpc/brain_grpc/_gen/`. The generated `…/brain/ingestion/v1.py:5-8` imports `betterproto` + `grpclib`; the service surface it produces is a **grpclib client stub** — `class WebhookIngestServiceStub(betterproto.ServiceStub)` (`v1.py:75`) with an `async def receive_webhook(...)` keyword-arg signature (`v1.py:83`). betterproto's server contract is a **grpclib `ServiceBase`** registered on a `grpclib.server.Server`.

**Runtime is grpcio (grpc.aio).** Every Python service runs a `grpc.aio.server()`:
- `apps/ingestion-service/src/interfaces/grpc/webhook_server.py:133` — `grpc.aio.server()`, and at `:157` registers via `ingestion_pb2_grpc.add_WebhookIngestServiceServicer_to_server(...)` — the **grpcio** registration symbol, which betterproto **does not generate** (acknowledged in the code's own comment, `:141-147`).
- `apps/analytics-service/src/interfaces/grpc/health_server.py:50` — `grpc.aio.server()`, health-only.
- `apps/intelligence-service/src/interfaces/grpc/health_server.py` — same shape, health-only.

grpcio servers require `add_<Svc>Servicer_to_server` + a grpcio `Servicer` base class. grpclib servers require a `ServiceBase` subclass on `grpclib.server.Server`. **These ABIs do not interoperate** — a betterproto/grpclib stub cannot be registered on a `grpc.aio.server()`. So the generated `pylibs/brain_grpc` stubs were never the server's contract for any business RPC.

**TS side is a third path.** `protos/buf.gen.yaml:11` generates `@bufbuild/protobuf` ES stubs into `packages/lib-grpc-clients/gen/`. But the only live gRPC client — `apps/api-gateway/src/interfaces/webhook-ingest-client.ts:27-28,85` — loads the `.proto` at **runtime** via `@grpc/grpc-js` + `@grpc/proto-loader` (its own comment, `:13-17`, says the ES stubs are "for TypeScript type usage; the runtime wire call goes through grpc-js + proto-loader"). So the generated ES stubs aren't the runtime path either. (This ADR's primary subject is the Python split; the TS divergence is documented here because the chosen Python wire format constrains the gateway client.)

### Why it stayed hidden (the dangerous part)

1. **Servers degrade gracefully on a missing servicer.** A `grpc.aio.server()` with only a registered health servicer still starts, binds, and passes its liveness probe. Before the interim fix, the ingestion server fell into "stub-less mode" — the business RPC `ReceiveWebhook` was **never served**, only the grpcio health check ran. analytics + intelligence are *still* in exactly this state: `health_server.py` registers only `grpc_health.v1` (`analytics …:64-65`) and explicitly logs "HEALTH-ONLY mode" when the metrics stub import is absent (`:56-60`). Their `MetricsService` / `IntelligenceService` business RPCs have **never been exercised over a real wire.**
2. **Tests call servicers directly.** The servicer is unit-tested by instantiation + direct method call (`webhook_server.py:28`: "Tests bypass the server and test the servicer directly"). A servicer-direct test passes whether or not the servicer is reachable over gRPC — it proves the business logic, not that the contract is *served*. There is no test that opens a channel and round-trips a real RPC.
3. **HOLD-at-cutover masked it.** The live server start is a Stage-8 artifact (`webhook_server.py:12-17`), so "no real traffic yet" deferred the discovery until the realtime epic actually dialed the wire.

The result is a latent **"never served"** class of bug: the contract compiles, the stubs generate, the health probe is green, the unit tests pass — and the RPC does not exist on the wire.

### Interim fix already shipped (webhook path only — KEEP)

For ingestion only, grpcio-style stubs for `ingestion.proto` were generated via `grpcio-tools` and committed at `apps/ingestion-service/src/interfaces/grpc/_pb2/brain/ingestion/v1/ingestion_pb2{,_grpc}.py` (pins `grpcio>=1.80.0`). `webhook_server.py:151-166` puts that dir on `sys.path`, registers via the grpcio symbol, and now **raises (fail-fast) instead of silently skipping** if registration fails. The gateway loads the same `.proto` via proto-loader with a `protos/` copy baked into its image (`webhook-ingest-client.ts:37-40`). This is correct and live — but it is a **localized, hand-generated patch**, not the repo-wide codegen standard. analytics + intelligence have no equivalent and remain health-only.

---

## 2. Options

### Option A — Standardize on **grpcio** end-to-end (Python), keep grpc-js on TS

- **Python:** replace the betterproto plugin in `buf.gen.yaml` with `protocolbuffers/python` (messages) + `grpc/python` (service `_pb2_grpc`), or drive `grpcio-tools` from buf via a local plugin. Regenerate into `pylibs/brain_grpc`. Servers stay `grpc.aio.server()`; servicers become grpcio `Servicer` subclasses registered with `add_<Svc>Servicer_to_server` — exactly what ingestion already does. Delete the interim `_pb2/` once the shared package ships the same symbols.
- **TS:** keep `@grpc/proto-loader` + grpc-js as the runtime (already proven on the webhook path), OR move to `protoc-gen-grpc-js`/`ts-proto` generated grpc-js stubs for type-safety. Either way the wire format is grpcio-canonical protobuf — fully interoperable with the Python grpcio servers.
- **Trade-offs:** (+) servers are *already* grpc.aio; the interim fix is *already* grpcio; zero runtime rewrite; grpcio is the mainstream, well-maintained, AWS-supported path. (+) `grpc_health.v1` is grpcio-native — no health reconciliation needed. (−) loses betterproto's dataclass ergonomics; `_pb2` message API is less idiomatic-Python. (−) `buf` has no first-party `grpc/python` remote plugin → likely a local `grpcio-tools` plugin in `buf.gen.yaml`, slightly more toolchain config.

### Option B — Standardize on **grpclib/betterproto** end-to-end (Python)

- Keep betterproto codegen. **Rewrite all three Python servers** from `grpc.aio.server()` to `grpclib.server.Server`; servicers become betterproto/grpclib `ServiceBase` subclasses. Re-do the health service the grpclib way (betterproto/grpclib does not consume `grpc_health.v1` grpcio servicer — needs a grpclib health impl). Revert + re-shape the interim ingestion patch.
- **Trade-offs:** (+) idiomatic dataclass messages; one plugin, clean buf config. (−) **highest blast radius** — rewrites every server we already have, including the live ingestion path. (−) betterproto is **lower-activity / lighter-maintained** than grpcio; pins us to a smaller ecosystem for a core internal transport. (−) grpclib + uvloop/asyncio + AWS ALB/EKS health-check tooling is the less-trodden path; `grpc_health.v1` and most observability/interceptor middleware assume grpcio. (−) throws away the already-shipped, already-correct interim fix.

### Option C — Betterproto for **messages/clients**, grpcio for **service** stubs (formalize the interim patch)

- Keep betterproto generating message dataclasses + client stubs; *additionally* generate grpcio `_pb2_grpc` service stubs (a second Python plugin in `buf.gen.yaml`) and use those as the server contract everywhere. This is the interim webhook patch promoted to repo-wide standard.
- **Trade-offs:** (+) keeps betterproto dataclass ergonomics for client-side/message code. (−) **two parallel Python message representations** (betterproto `betterproto.Message` vs grpcio `_pb2`) for the same proto — the server speaks `_pb2`, any betterproto client speaks dataclasses; mapping/serialization seams and drift risk between them. (−) two plugins, two generated trees, double the "which one is canonical" confusion that caused this bug. (−) doesn't actually resolve the split — it institutionalizes it.

### Option D (considered, rejected) — Keep both, document the boundary

Leave betterproto for `pylibs/brain_grpc`, keep grpcio `_pb2` per-service, just write down "servers use grpcio." Rejected: this is the status quo that produced a never-served RPC and two more latent ones. No single source of truth = the bug recurs by construction.

---

## 3. Recommendation — **Option A (grpcio end-to-end on Python; grpc-js on TS)**

**Rationale:**
1. **The runtime is already there.** All three servers are `grpc.aio.server()`. Option A makes the *codegen* match the *runtime* instead of rewriting the runtime to match a codegen choice nobody is using. Option B rewrites three working servers (one of them live) to chase ergonomics.
2. **The interim fix is already grpcio.** Ingestion's live, fail-fast, correct path is grpcio `_pb2_grpc`. Option A generalizes a proven pattern; B reverts it; C freezes it as a special case.
3. **Maintenance + ecosystem.** grpcio is the mainstream, actively-maintained gRPC-for-Python; betterproto/grpclib is lower-activity. For a core internal transport carrying every BFF fan-out, pick the boring, supported stack. `grpc_health.v1` (already used by all three servers), interceptors, OTel gRPC instrumentation, and EKS/ALB health tooling all assume grpcio — no health-service reconciliation work.
4. **Single representation.** Option A gives one Python message type per proto (`_pb2`), one server ABI, one client ABI. Option C keeps two and is a drift trap — the exact failure mode of this ADR.
5. **TS stays on grpc-js + proto-loader** for the runtime (proven on the webhook path); the `@bufbuild/protobuf` ES stubs remain available for compile-time types. grpcio Python servers and grpc-js clients share canonical protobuf wire format — interoperable. (A follow-up may move TS to generated grpc-js stubs for type-safety, but that is not blocking and is out of scope here.)
6. **India/residency:** not a factor — this is transport/codegen only; no data-locality or RegionAdapter implication.

**Non-negotiable condition on whichever option is ratified:** the contract MUST be **exercised over a real wire in CI** — open a channel, dial the server, round-trip the business RPC, assert the response — not a servicer-direct unit test. This is what makes the "never served" class structurally impossible to reintroduce (§4 CI gate).

---

## 4. Migration Plan (safe, reversible, per-service behind the existing health gate)

**Sequencing principle:** the interim ingestion patch already proves the target shape; generalize it service-by-service, never big-bang. Each step is independently revertable and gated by the existing health probe + a new wire-RPC CI gate.

**Step 0 — Toolchain (no behavior change).**
Add the grpcio plugins to `protos/buf.gen.yaml` (`protocolbuffers/python` + a `grpc/python` / `grpcio-tools` local plugin) emitting into `pylibs/brain_grpc/brain_grpc/_gen_grpcio/` **alongside** the existing betterproto output. Pin every plugin to a **real, resolved-latest-stable** version (`grpcio` + `grpcio-tools` ≥ the `1.80.0` the interim `_pb2_grpc.py` already pins; resolve `protocolbuffers/python` + `grpc/python` to current at codegen time — do not invent a version). Do **not** delete betterproto output yet. CI: `buf generate` is reproducible. *Revert = drop the plugin block.*

**Step 1 — Ingestion (lowest risk; already grpcio).**
Point `webhook_server.py` import at the shared `pylibs/brain_grpc` grpcio stubs instead of the per-service `_pb2/` copy. Keep the fail-fast registration (`:160-166`). Leave the local `_pb2/` in place until the shared package is verified, then delete it as a separate commit. *Revert = re-point the import at `_pb2/`.*

**Step 2 — analytics-service (`MetricsService`).**
Promote `health_server.py` to register the real `MetricsService` grpcio servicer over the same `grpc.aio.server()` (health stays). Wire the servicer to the existing `query_gateway` use-cases via `interfaces/grpc/` per DDD (servicer is a thin adapter; no business logic). *Revert = unregister the servicer; server falls back to health-only — same safe state as today.*

**Step 3 — intelligence-service (`IntelligenceService`).**
Same shape as Step 2 (`GetMorningBrief` / `SubmitInsightResponse` / `RegisterPushToken`). *Revert = unregister → health-only.*

**Step 4 — Decommission betterproto.**
Once all three services serve real RPCs over the wire AND the gateway clients are green, remove the betterproto plugin from `buf.gen.yaml` and delete `pylibs/brain_grpc/.../_gen` betterproto output (rename `_gen_grpcio` → `_gen`). Update any betterproto client imports (audit: only the generated tree imports `betterproto` today; no hand-written service code does). *Revert window: keep betterproto output one release cycle before deletion.*

**Step 5 — TS confirmation.**
Confirm grpc-js + proto-loader interoperates with each new grpcio server via the CI wire test (Step CI). No gateway code change required for ingestion (already grpc-js); add grpc-js clients for metrics/intelligence as those gateway fan-outs land (separate Vikram tracks, out of scope for this ADR).

**CI gate (the recurrence-killer) — applies from Step 1, blocking from Step 4:**
For each Python service, a CI job that:
1. starts the real `grpc.aio` server on a loopback port (the actual entrypoint, not a mock),
2. waits on `grpc_health.v1` Check = SERVING,
3. opens a gRPC channel (grpc-js from the gateway client AND a Python grpcio client) and **round-trips at least one business RPC**, asserting the typed response,
4. fails the build if the business RPC returns `UNIMPLEMENTED` or the servicer is unregistered.

This converts "never served" from a silent runtime degradation into a red build. Add it to `tests/` (cross-service) per the monorepo layout; it is REQUIRED-pass-1 for any service that adds/changes a gRPC service.

---

## 5. Risks & Non-Goals

**Risks**
- **Regenerated `_pb2` message API differs from betterproto dataclasses** — any code constructing betterproto messages by keyword must move to `_pb2` constructors. Audit shows the betterproto types are referenced only inside the generated tree today, so the surface is small; verify before Step 4 deletion.
- **`buf` + `grpcio-tools` integration friction** — no first-party remote `grpc/python` buf plugin; a local plugin/`grpcio-tools` shell step is likely. Mitigation: pin versions in `TOOLCHAIN.md`; reproducibility test in Step 0.
- **Health-service double-registration** — ensure exactly one `grpc_health.v1` servicer per server when adding business servicers (Steps 2–3). Covered by the CI health check.
- **Stage-8 HOLD interaction** — live server starts are HELD until cutover; the CI wire test runs the server in-job on loopback, so it validates the contract WITHOUT lifting any production HOLD. No cutover decision is implied by this ADR.
- **gateway proto-copy drift** — the gateway image bakes a `protos/` copy (`webhook-ingest-client.ts:37-40`); ensure CI rebuilds it from the canonical `protos/` so the wire test catches proto drift.

**Non-goals (explicitly out of scope here)**
- Moving the TS runtime off `@grpc/proto-loader` onto generated grpc-js stubs — allowed later, not decided here.
- Adding new gateway gRPC fan-outs for metrics/intelligence (separate Vikram builder tracks).
- Kafka/event-schema codegen, MCP tool-schema generation, or any non-gRPC contract.
- Lifting any Stage-8 NO-LIVE HOLD or making a production-cutover call.
- Re-evaluating the locked microservices/contract-first pattern — this ADR operates *within* it.

---

## Ratification

**Status: ACCEPTED — ratified by Founder, 2026-06-03.** Option A (grpcio end-to-end) approved; the analytics + intelligence migration (Steps 0/2/3) + the wire-RPC CI gate are authorized and in progress. Step 1 (ingestion re-point to the shared stubs) and Step 4 (betterproto decommission) remain deferred per the sequencing — the interim ingestion `_pb2/` patch stays in force until then. The toolchain-contract concerns (`api-discipline`, `tech-stack-evaluation`) are accepted with grpcio/grpcio-tools pinned ≥ the resolved stable used by the interim patch.
