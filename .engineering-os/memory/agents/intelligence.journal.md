# Intelligence Engineer — Journal

> Append-only. See /Users/rishabhporwal/.claude/plugins/cache/brain-engineering-os-marketplace/brain-engineering-os/0.23.0/docs/role-empowerment-model.md for entry shape.

## 2026-05-23T12:48:01Z — system — bootstrap
**Action:** Journal initialized by /eos init on 2026-05-23T12:48:01Z.

## 2026-05-24T01:18:46Z — Maya (intelligence-engineer) — spike-legacy-migration-architecture
**Stage:** 2 (co-owner deepening)
**Track:** A1.5 + A5.2 (data/AI-surface mapping + numeric shadow-compare)
**Action:** Deepened Aryan's stubs A1.5 and A5.2 in 06-architecture-plan.md to binding quality; answered all 6 open questions (M-A1-Q1..Q3, M-A5-Q1..Q3); zero A1.1–A1.4 dispositions changed; zero A5.1 rules relaxed.
**Skills loaded:** metric-engine, clickhouse-olap, data-quality, llm-evals, memory-layer-pgvector, decision-log, cost-routing-paradigms, agentic-design, claude-api
**Paradigm:** sql (all signal computation; no LLM in harness or metric materialization) — justified: every metric in workspace_daily_metrics maps to deterministic SQL; ratio metrics use FLOOR(×10000) not ROUND_HALF_EVEN; the only LLM calls in the AI surface are page-level narration (Haiku for 12/13 pages, Sonnet for chat/global only). ~80% of legacy AI surface is actually sql/statistical paradigm.
**Prompt caching:** NOT_APPLICABLE (design-only spike; no LLM calls)
**Daily-tick simulation:** NOT_APPLICABLE (no code)
**Files touched:**
- `.engineering-os/runs/2026-05-24T00-58-39Z__a49c05__spike-legacy-migration-architecture__rishabhporwal/06-architecture-plan.md` (extended A1.5 + A5.2 in place, Maya-authored sections clearly marked)
- `.engineering-os/state/active.json` (.bak.20260524T011846Z written first; maya_deepening_pending→false; status→parallel-review; stage→4; co_owner_stage4→qa-agent)
- `.engineering-os/memory/agents/intelligence.journal.md` (this entry)
- `.engineering-os/decision-log/2026/05/2026-05-24.jsonl` (decision-log entry appended)
- `.engineering-os/runs/.../live.log` (live.log entries appended)
**Verification:**
- Command: `git status --short`
- Output: All modified/untracked files under `.engineering-os/**` ONLY. Legacy project untouched. PASS.
**Key decisions:**
- M-A1-Q1: NO ML required for any metric in workspace_daily_metrics; all sql paradigm.
- M-A1-Q2 (LOAD-BEARING): Parity measured vs Brain's corrected formula; expected definitional deltas (P&L lagged-shipping vs actual-cost CM2) go into Definitional-Delta Register signed off by Rohan before cutover.
- M-A1-Q3: ~80% of AI surface is sql-tier (signals/anomaly/trend/comparator); ~20% is genuine LLM narration (haiku for standard pages, sonnet for chat/global).
- M-A5-Q1: Ratio metrics use FLOOR(×10000), not ROUND_HALF_EVEN; same zero-tolerance compare rule.
- M-A5-Q2: Paise (×100) is the universal canonical unit; 4-decimal sources rounded once at ACL boundary via ROUND_HALF_EVEN; Python must receive Decimal as string not float.
- M-A5-Q3: Connector parity is count-based + spot-check (not numeric shadow); rollback windows: Shopify/Woo 4h, Meta/Google 8h, Klaviyo/Unicommerce 12h, Shiprocket 72h.
- CACHE-PURGE-C4C5 gate: fully specified with 6-step implementation target + facade enforcement predicate.
- ClickHouse shadow DDL: specified with ReplacingMergeTree + partition + sort key; zero Postgres dual-write enforced at DB layer (read-only role for analytics-service Postgres user).
**No plan-amendments raised:** All A5.1 rules feasible within design. Two Child scoping notes surfaced (Definitional-Delta Register as Child 4 deliverable; WorkspaceCost currency-at-entry migration as Child 2 pre-condition).
**Handoff signal:** READY-FOR-PARALLEL-REVIEW (Security/Shreya + QA/Tanvi)
