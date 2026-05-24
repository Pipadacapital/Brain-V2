# Convention: Decision Log (ai.decision_log)

The Decision Log is the append-only, tamper-evident audit trail of every AI/ML
inference and routing decision Brain makes on behalf of a workspace.

## Single primitive
There is ONE Decision Log primitive — no per-channel forks.

## Schema home
`apps/intelligence-service/src/infrastructure/` — Postgres schema `ai`, table `ai.decision_log`.

## Writer home
`apps/analytics-service/src/domain/decision-log/` — the service that writes to the log
after every metric compute or inference result.

## Schema shape (future implementation)
```
ai.decision_log (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id    UUID NOT NULL,           -- multi-tenancy: every row scoped
  request_id      UUID NOT NULL,           -- correlation with trace
  trace_id        TEXT NOT NULL,
  user_id         UUID,                    -- nullable for system-triggered decisions
  paradigm        TEXT NOT NULL,           -- 'sql' | 'ml' | 'small_llm' | 'frontier_llm'
  model_id        TEXT,                    -- e.g. 'gpt-4o', 'claude-3.5-sonnet', null for sql/ml
  input_hash      TEXT NOT NULL,           -- SHA-256 of the inference input (not the value)
  output_hash     TEXT NOT NULL,           -- SHA-256 of the inference output
  latency_ms      INTEGER NOT NULL,
  tokens_in       INTEGER,                 -- null for sql/ml
  tokens_out      INTEGER,                 -- null for sql/ml
  cost_paise      BIGINT,                  -- integer minor units; null for sql/ml
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
)
```

## Append-only guarantee
Rows are INSERT-only. No UPDATE, no DELETE (RLS enforces this).
Tamper-evidence: hash chaining or Postgres audit extension — decide at implementation time.

## Immutability home (shared with SEC)
`audit-log-immutability` skill governs the write pattern.
The Decision Log implementation shares the append-only discipline with the general audit log.
