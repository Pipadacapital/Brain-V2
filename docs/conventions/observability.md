# Convention: Observability

Three pillars: metrics, logs, traces. One correlation ID threads all three.

## The one correlation ID
Every request carries four identifiers propagated through the full stack:
- `request_id` — UUID, caller-generated or gateway-assigned at ingress
- `trace_id` — OTel trace ID (W3C TraceContext)
- `workspace_id` — always present (multi-tenancy)
- `user_id` — present for user-initiated requests, null for system/cron

Propagation path: HTTP headers → gRPC metadata → Kafka envelope → structured log fields.
**Every error response must surface `request_id`** so failures are traceable end-to-end.

## Logs
- **TypeScript:** `pino` + AsyncLocalStorage (ALS) — the ALS context carries the
  correlation ID; every log line gets `request_id`, `trace_id`, `workspace_id`, `user_id`
  automatically without threading them through function signatures.
- **Python:** `structlog` + `contextvars` — same pattern; context is bound once at
  request ingress and flows to all log calls.
- Format: JSON (structured). Never free-form strings in production.
- Home: each service's `src/bootstrap/` (logger initialization) + `src/interfaces/`
  (middleware that binds the ALS/contextvars context).

## Traces
- OTel → AWS X-Ray via ADOT (AWS Distro for OpenTelemetry) sidecar.
- Every endpoint and every Kafka consumer is trace-instrumented.
- Trace context is propagated via W3C `traceparent` header (HTTP) and gRPC metadata key
  `x-b3-traceid` + `x-b3-spanid` (or W3C equivalents).
- Home: each service's `src/bootstrap/` (OTel SDK init) + `src/interfaces/`
  (auto-instrumentation middleware).

## Metrics
- CloudWatch metrics via ADOT + Sentry instrumentation.
- Metric names defined in `packages/lib-metrics/` (TS) and `pylibs/brain_metrics/` (Python).
- Parity enforced by `tools/check-metrics-parity.sh` (turbo `check:metrics-parity` task).

## Alarms and dashboards
Deferred — no SLO to alarm on at scaffold time. First alarm lands with the first
deployed service under its own Architect plan.
