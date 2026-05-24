# Convention: @paradigm Decorator

Every compute path that routes inference or queries must declare its paradigm.
This is a day-one non-negotiable (Appendix C item 6).

## Priority order (cheapest first)
```
SQL > ML > small_llm >> frontier_llm
```

## The four paradigms
| Paradigm | When to use | Example |
|----------|-------------|---------|
| `sql` | The answer is deterministic from structured data | RTO rate, repeat-customer rate, GMV by channel |
| `ml` | Pattern recognition over structured data; no language needed | RFM segmentation, churn prediction, anomaly detection |
| `small_llm` | Language understanding required; cost-sensitive | Label extraction, short summaries, classification |
| `frontier_llm` | Novel reasoning, multi-step synthesis; justify the cost | Morning Brief narrative generation, root-cause explanation |

Paradigms 3 & 4 are **model-agnostic, gateway-routed policy tiers** — the paradigm
determines routing policy (token budget, model class, fallback), not a specific model.

## Decorator syntax (TypeScript)
```typescript
// @paradigm(sql) — deterministic query, no model call
export function computeRTORate(...) { ... }

// @paradigm(frontier_llm) — justified: multi-step narrative synthesis
export function assembleMorningBrief(...) { ... }
```

## Decorator syntax (Python)
```python
# @paradigm(sql) — deterministic query, no model call
def compute_rto_rate(...): ...

# @paradigm(small_llm) — label extraction
def extract_return_reason(...): ...
```

The decorator is a **code comment convention** at scaffold time. When the intelligence
service is implemented, it becomes a runtime decorator that instruments token budgets
and paradigm metrics. The Decision Log (`docs/conventions/decision-log.md`) records
the `paradigm` field for every inference.

## Per-feature LLM token budget
Every feature that uses a `small_llm` or `frontier_llm` paradigm must declare a
per-feature token budget in its Architect plan. This is enforced by the Vikram DoD
checklist.

## Code homes
- `pylibs/brain_cost_router/` — Python cost routing primitives
- `apps/intelligence-service/src/domain/` — inference routing logic
- `apps/api-gateway/src/application/` — gateway-level routing policy
