# Architecture Compliance — actual vs. target spec

Audit date: 2026-05-31. Compares the on-disk monorepo against the Brain "folder & service
architecture" spec. The architectural **invariants** all pass; remaining gaps are folder/package
naming the spec defers to the Phase-2 mechanical split (see `architecture-phase2-restructure-runbook.md`).

Legend: ✅ compliant · 🟡 partial / Phase-0-1-shaped · ❌ missing.

## A. Top-level monorepo
| Item | Status |
|---|---|
| pnpm + Turborepo, TS+Python coexist | ✅ |
| `apps/` (9 deployables) | ✅ web, mobile, api-gateway, core-service, ingestion, analytics, intelligence, lifecycle, notifications |
| `protos/` single source of truth + buf codegen | ✅ (4 domain pkgs authored on demand) |
| `infra/` cdk + k8s + migrations | 🟡 cdk present; k8s + migrations index added (Phase-2 placeholders) |
| `packages/` | 🟡 fewer than spec — see §packages |
| `pylibs/` | 🟡 fewer than spec — see §pylibs |
| `docs/ tools/ tests/` | ✅ |
| Codegen not hand-written contracts | ✅ buf → proto-ts (TS) + proto_py (Python) |
| One writer per store | ✅ |

## B. Service-internal DDD layout
Every backend service has `bootstrap/ domain/ application/ infrastructure/ interfaces/` ✅.
Deeper `application/contexts/<bc>/{4 layers}` nesting NOT applied (flat `application/<feature>/`) 🟡 —
Phase-2 (runbook Phase E).

## packages (vs spec)
Present: `config, eslint-config, lib-clickhouse-ts, lib-logger, lib-metrics, proto-ts, ui`.
Spec also names: `ui-mobile, lib-formatters, lib-grpc-clients, trpc-client, state, lib-auth,
lib-observability, lib-test-fixtures`. Formatters live in lib-metrics + per-feature web helpers;
trpc-client/state/web-ui live inside apps/web; proto-ts ↔ lib-grpc-clients (rename). 🟡 — runbook Phases B, D.

## pylibs (vs spec)
Present: `brain_clickhouse, brain_cost_router, brain_logger, brain_metrics, brain_regional, proto_py`.
Spec also names: `brain_connectors, brain_kafka, brain_ml, brain_llm, brain_agents, brain_mcp, brain_grpc`.
Connector base inline in ingestion-service; kafka inline; proto_py ↔ brain_grpc (rename). 🟡 — runbook Phases C, D.

## D. Cross-cutting invariants — all ✅
workspace_id everywhere (4-layer) · money = integer minor units + currency_code · Kafka envelope
workspace_id + trace_id · metric registry parity (lib-metrics ≡ brain_metrics, CI-enforced) ·
Phase 0–1 = 3 backend deployables on Fargate, split to 7 on EKS at Phase 2.

## Progress (this attempt)
- **Phase A — IN PROGRESS:** infra/k8s + infra/migrations index + tests/ + this doc (additive, no code moved).
- Phases B/C/D/E — see `architecture-phase2-restructure-runbook.md` for the ordered, shim-based plan.
