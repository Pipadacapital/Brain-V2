# Feature journal — chore-migrate-legacy-to-brain

> Per-feature append-only journal. Title: Migrate & transform the legacy DTC analytics platform into the Brain architecture.

## Stage 1 (intake) — 2026-05-24T00:54:41Z — Rohan (cto-advisor)

**Verdict:** CHALLENGE-BACK (decompose into EPIC) → Founder. Lane: high-stakes (all 9 trigger surfaces). Personas requested for Child 0: migration-strangler-fig-realist + india-data-isolation-compliance-officer.

**Why not one requirement:** legacy = ~48 Prisma models / 7 connectors / ~204 tsx / full AI engine, with 6 absent Brain non-negotiables — no RLS (66 workspaceId refs, app-layer only), Decimal/Float money (must be BIGINT minor-units), no OLTP/OLAP split, no metric-registry TS<->Python parity, no LiteLLM gateway/@paradigm/Decision-Log, no Kafka spine. Founder's own zero-downtime/phased/strangler constraints are only achievable sliced.

**Legacy ground truth (verified on disk):** backend looqus-backend (Express 5 + Prisma 5 + @anthropic-ai/sdk-direct + Ollama + Supabase auth); frontend shopify-analitcs (Next 16/React 19/TanStack/shadcn aligned, Zustand banned, axios->REST); connectors Shopify/Woo/Meta/Google/Klaviyo/Shiprocket/Unicommerce; docs treat ROAS as primary + "Triple Whale-style" (Brain-naming + CM2-first violations).

**Decomposition (strangler-fig):** Child 0 audit+architecture spike (FIRST; Aryan + Maya; no prod code) -> Child 1 tenancy/auth/RLS -> Child 2 money minor-units -> Child 3 connector framework (1 at a time) -> Child 4 metric engine + OLTP/OLAP split -> Child 5 AI engine (LiteLLM/@paradigm/Decision-Log; ai-cost-realist required) -> Child 6 frontend (axios->tRPC, Zustand->RTK, Morning Brief primary) -> Child N decommission. Dependency graph stored in state.proposed_children.

**Recommended FIRST /requirement:** "Deep-audit the legacy platform & produce the binding legacy->Brain migration architecture (strangler-fig sequence)" — exact text in 02-cto-advisor-review.md.

**Artifacts:** 02-cto-advisor-review.md.
**Next:** Founder ratifies EPIC + files Child 0.
