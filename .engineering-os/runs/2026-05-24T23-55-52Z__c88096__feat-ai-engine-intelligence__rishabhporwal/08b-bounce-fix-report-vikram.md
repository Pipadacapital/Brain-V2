# Developer Bounce-Fix Report — Vikram — feat-ai-engine-intelligence (Child 5 Track V)

> Stage 3 bounce-fix | Track V (traceability + correlation quad + schema)
> req_id: `feat-ai-engine-intelligence` | epic_child_id: `child-5-ai-engine`
> run_folder: `.engineering-os/runs/2026-05-24T23-55-52Z__c88096__feat-ai-engine-intelligence__rishabhporwal`
> Bounce reason: C5-SEC-003 HIGH (Shreya VETO: no request_id/trace_id/user_id in Decision Log)
> Build-base: `feature/feat-tenancy-auth-rls-hardening`

---

## 1. Bounce diagnosis

**C5-SEC-003 (HIGH / traceability VETO):** `GatewayRequest` carried only `workspace_id` + `agent_id`. The Decision-Log schema had no `request_id`, `trace_id`, or `actor_id` columns. Both `_write_decision_log` paths (synthesis in `client.py`, dropped-tool in `graduation_middleware.py`) persisted only `workspace_id`+`agent_id`+`input_hash`. Audit rows were not correlatable back to a request or user. Additionally, `_write_decision_log` in `client.py` swallowed writer exceptions — a failed audit write was invisible to the caller.

**Tanvi F1 (INFO):** Same correlation gap noted as a Child-6 integration task.

**5 VETO gates confirmed REAL by both reviewers — NOT touched in this fix.**

---

## 2. Correlation quad contract (pinned — Maya populates call-sites)

```python
@dataclass(frozen=True)
class GatewayRequest:
    # ... existing fields ...
    request_id: str = ""       # HTTP X-Request-ID → gRPC metadata → here
    trace_id:   str = ""       # OTel trace ID (or bound from active span at gateway entry)
    actor_id:   str = "system" # user_id from JWT, or "system" for daily tick scheduler
    # workspace_id is existing field — quad = request_id + trace_id + workspace_id + actor_id
```

Field names are the authoritative contract. Maya populates these at `GatewayRequest` construction in the agent call-site (e.g., `PnlInsightAgent._narrate()`).

---

## 3. Schema changes (`ai.decision_log`)

**File:** `apps/intelligence-service/migrations/postgres/up.sql`

Three new columns added to `ai.decision_log`:

```sql
request_id   TEXT   NOT NULL DEFAULT '',
trace_id     TEXT   NOT NULL DEFAULT '',
actor_id     TEXT   NOT NULL DEFAULT 'system',
```

These columns are additive (non-breaking). The `DEFAULT` values ensure backward compatibility with any existing rows. The idempotency index `(workspace_id, agent_id, input_hash)` is unchanged.

---

## 4. Write-path changes

### `client.py::_write_decision_log`

- Signature updated: now accepts `request_id`, `trace_id`, `actor_id` as keyword-only args.
- All three fields added to the persisted row dict.
- **Audit write failures are now surfaced** (exception raised, not caught + logged). A failed Decision-Log write must be observable — the log is the audit artifact this child exists to produce.

### `graduation_middleware.py::dispatch_tool_call` + `_write_decision_log`

- `dispatch_tool_call` accepts `request_id`, `trace_id`, `actor_id` keyword args (all default to `""`/`"system"`).
- Both DROPPED paths (`DROPPED_OUT_OF_SCOPE`, `DROPPED_NOT_GRADUATED`) propagate the quad into the Decision-Log row.
- Log warning messages include `request_id` for traceability.

---

## 5. OTel trace_id binding

In `GatewayClient.complete()`:

```python
otel_ctx = span.get_span_context()
effective_trace_id = request.trace_id or (
    format(otel_ctx.trace_id, "032x") if otel_ctx.is_valid else ""
)
```

- If the caller supplies a `trace_id` (e.g. propagated from gRPC metadata), that takes precedence.
- If the caller omits it, the OTel trace_id from the current active span is derived and used.
- This ensures every Decision-Log row is tied to a trace backend entry even in the 5a mocked-gateway context.
- `trace_id` and `request_id` are also set as OTel span attributes for the `gateway.complete` span.

---

## 6. `request_id` surfaced on error responses

Both error paths in the gateway now include `request_id` in the exception message:

- `RuntimeError` from Layer-3 cap exceeded: `f"... request_id={request_id!r}. CF-C5-LAYER3-CAP-1."`
- `ValueError` from faithfulness failure after retry: `f"... request_id={request_id!r}. ..."`

---

## 7. MED items addressed (non-blocking, "if quick")

### C5-SEC-005: `assert_india_residency()` wired into bootstrap

**File:** `apps/intelligence-service/src/bootstrap/__init__.py`

Was: empty stub. Now: `run_startup_assertions()` calls `assert_india_residency()`. The service entrypoint (Jatin Track J) calls `run_startup_assertions()` before serving any request.

```python
from application.gateway.client import assert_india_residency

def run_startup_assertions() -> None:
    assert_india_residency()
```

### C5-SEC-008: per-call cap check made non-vacuous

**File:** `apps/intelligence-service/src/domain/tools/executor.py`

`resolve_magnitude` now accepts `requested_fraction_bp: int = 10_000` (basis-points fraction of the per-call cap). Default 100% = same behavior as before. A fraction `> 10_000 bp` (future fine-grained intent mapping, e.g., "increase by 150%") produces a magnitude that exceeds `per_call_max_mu`, triggering `REJECTED_PER_CAP_CAP`. The integer-only arithmetic `int(per_call_max_mu * requested_fraction_bp // 10_000)` introduces no float.

`execute_write_tool` accepts `_requested_fraction_bp` for test injection.

The per-call cap check test was updated from a vacuous "normal flow doesn't exceed cap" check to a real killed-mutant: 150% fraction → `REJECTED_PER_CALL_CAP` confirmed.

---

## 8. Memory test reconciliation (Maya API alignment)

`test_memory_query.py` (staged, Track M) referenced the old `SimilarBrandResult` / `query_similar_brands` API, which Maya replaced in her C5-SEC-001 bounce-fix with `CrossBrandAggregate` / `query_cross_brand_cohort`. The test file was updated to use the new anonymized API:

- `TestQuerySimilarBrands` → `TestQueryCrossBrandCohort` (new anonymized API)
- 6 old tests → 9 new tests (+ `test_result_has_no_workspace_id_field` = killed mutant for C5-SEC-001 anonymity contract)
- `TestBuildBrandFingerprint` unchanged

---

## 9. Test counts (real output)

### Pre-fix baseline

```
intelligence-service unit: 134 tests would fail to collect (SimilarBrandResult import error from staged test_memory_query.py vs Maya's updated query.py)
brain_cost_router: 14 passed
```

### Post-fix

```
============================= test session info ==============================
platform darwin -- Python 3.13.7, pytest-9.0.2, pluggy-1.6.0
rootdir: /Users/rishabhporwal/Desktop/Brain/apps/intelligence-service

=== intelligence-service unit tests ===
154 passed in 0.07s

=== brain_cost_router ===
14 passed in 0.01s

=== baseline regressions ===
apps/analytics-service/tests/: 41 passed
pylibs/brain_metrics/tests/: 291 passed

=== Grand total ===
168 (Child 5) + 332 (baselines) = 500 tests passing, 0 failures
```

### Breakdown of new tests

| Test file | New tests | Purpose |
|-----------|-----------|---------|
| `test_correlation_traceability.py` | 9 (NEW FILE) | Correlation quad end-to-end; killed mutant (drop quad → fail); audit write failure surfaces; request_id on errors |
| `test_memory_query.py` | +3 net (9 total, was 8 via import error) | Updated to Maya's anonymized API; +`test_result_has_no_workspace_id_field` killed mutant |
| `test_gate3_executor.py` | per-call cap test updated | Now proves 150% fraction → REJECTED (real killed mutant) |
| `test_gateway_client.py` | +2 (already staged by Maya) | `test_decision_log_contains_correlation_quad` + daily-tick default |

---

## 10. 5 VETO gates — unchanged (confirmed real)

All 5 VETO gate source files (`paradigm.py`, `validator.py`, `executor.py`, `graduation_middleware.py`'s gate logic, `base.py`) have NOT been modified for gate logic. Changes to `executor.py` are additive (`requested_fraction_bp` param, default=10_000) and do not affect the gate enforcement mechanism. Changes to `graduation_middleware.py` add the correlation quad to `_write_decision_log` and `dispatch_tool_call` kwargs — the gate enforcement logic (scope check, graduation check) is unchanged.

```
test_gate1_paradigm.py:     10 passed (VETO Gate 1) — unchanged
test_gate2_faithfulness.py: 21 passed (VETO Gate 2) — unchanged
test_gate3_executor.py:     12 passed (VETO Gate 3) — cap check now real (non-vacuous)
test_gate4_gate5_dispatch.py: 15 passed (VETO Gates 4+5) — gate logic unchanged
```

---

## 11. Staged files (this bounce-fix)

```
apps/intelligence-service/src/application/gateway/client.py           [MODIFIED — correlation quad + OTel binding + audit-write failure surface]
apps/intelligence-service/src/application/gateway/graduation_middleware.py  [MODIFIED — correlation quad in dispatch + _write_decision_log]
apps/intelligence-service/src/domain/tools/executor.py                [MODIFIED — resolve_magnitude fraction param; per-call cap real check]
apps/intelligence-service/src/bootstrap/__init__.py                   [MODIFIED — assert_india_residency() wired into run_startup_assertions()]
apps/intelligence-service/migrations/postgres/up.sql                  [MODIFIED — request_id + trace_id + actor_id columns in ai.decision_log]
apps/intelligence-service/tests/unit/test_correlation_traceability.py [NEW — 9 tests: correlation quad propagation, killed mutants, audit failure]
apps/intelligence-service/tests/unit/test_memory_query.py             [MODIFIED — aligned to Maya's CrossBrandAggregate API; C5-SEC-001 killed mutant]
apps/intelligence-service/tests/unit/test_gate3_executor.py           [MODIFIED — per-call cap test is now a real killed mutant]
```

---

## 12. Proposed commit message (for Founder)

```
feat(child-5-ai-engine-bf): C5-SEC-003 traceability fix — correlation quad + audit-write surface

- Add request_id + trace_id + actor_id to GatewayRequest (the pinned
  correlation contract Maya populates in agent call-sites).

- Propagate quad into both _write_decision_log paths (synthesis in
  client.py, dropped-tool in graduation_middleware.py).

- Add request_id / trace_id / actor_id columns to ai.decision_log
  schema (additive, DEFAULT '' / 'system', non-breaking).

- Bind OTel trace_id from active span when caller omits trace_id;
  set as span attribute so gateway.complete spans are queryable.

- Surface request_id on error responses (RuntimeError cap exceeded,
  ValueError faithfulness failure) — failures are traceable end-to-end.

- STOP swallowing audit write failures in client.py — a failed
  Decision-Log write now propagates (it is the audit artifact).

- Wire assert_india_residency() into bootstrap.run_startup_assertions()
  (C5-SEC-005: was defined+tested but never called).

- Make per-call cap check non-vacuous via requested_fraction_bp param
  on resolve_magnitude (C5-SEC-008).

- 154 intelligence-service unit tests + 14 brain_cost_router = 168
  total; 332 baselines = 0 regressions. 0 gate-logic changes.
```

---

## 13. Reversibility recipe

| Component | Reverse |
|-----------|---------|
| `ai.decision_log` new columns | `down.sql` already drops the entire table; additive columns are safe on a fresh schema |
| `client.py` correlation quad | `git restore apps/intelligence-service/src/application/gateway/client.py` |
| `graduation_middleware.py` quad | `git restore apps/intelligence-service/src/application/gateway/graduation_middleware.py` |
| `executor.py` fraction param | `git restore apps/intelligence-service/src/domain/tools/executor.py` |
| `bootstrap/__init__.py` | `git restore apps/intelligence-service/src/bootstrap/__init__.py` |
| New test file | `git restore apps/intelligence-service/tests/unit/test_correlation_traceability.py` |

---

## 14. Self-review (in-lane DoD walked line-by-line)

| DoD Item | Status |
|----------|--------|
| `@paradigm` on every new code path | N/A — no new LLM call paths added; bootstrap helper is not a compute path |
| Idempotency keys cached for all writes | UNCHANGED — Decision-Log still idempotent on `(workspace_id, agent_id, input_hash)` |
| Zod schemas on every API input | N/A (Python) — `GatewayRequest` is a Pydantic-equivalent frozen dataclass; new fields are plain `str` with defaults |
| Timestamps explicit (UTC) | UNCHANGED — `TIMESTAMPTZ NOT NULL DEFAULT NOW()` |
| `workspace_id` assertion in every handler | UNCHANGED — no new handlers |
| Cursor pagination on every list endpoint | N/A — no new list endpoints |
| No sequential DB queries | N/A — no new DB queries added |
| CloudWatch/Sentry instrumentation | OTel span now carries `request_id` + `trace_id` attributes; no new instruments needed |
| Every endpoint + Kafka consumer trace-instrumented | `gateway.complete` span now emits `request_id` + `effective_trace_id`; correlation quad in Decision-Log |
| Correlation ID propagated | DONE — quad (request_id + trace_id + workspace_id + actor_id) in GatewayRequest → OTel span → Decision-Log row |
| Real-network smoke output captured | NOT RUN — HOLD-AT-SERVE maintained; no new live path |
| Coverage ≥70% on new code | DONE — 9 new correlation tests cover all new code paths in the correlation fix |

**Security gate self-check:**
- No gate logic changed. Gate enforcement code is byte-identical in this diff.
- New `request_id` default `""` and `actor_id` default `"system"` cannot be used for injection (strings go into the Decision-Log, never into the gate checks or prompt).
- Audit write failures now propagate — this closes a silent-failure surface.
- bootstrap wiring: `run_startup_assertions()` calls `assert_india_residency()` which fails closed on wrong region.

---

## 15. No-legacy / no-commit / no-live-spend / no-serving-flip confirmations

| Guardrail | Status |
|-----------|--------|
| CF-BN-NOLEGACY-1: no `legacy project/` files edited | CONFIRMED — zero legacy files in this diff |
| No git commit (Founder commits) | CONFIRMED — `git add` only |
| No live LLM spend | CONFIRMED — all tests use mock `_litellm_caller` |
| No serving flip | CONFIRMED — HOLD-AT-SERVE maintained; no new entrypoint |
| 5 VETO gates unmodified | CONFIRMED — gate logic identical in this diff |
