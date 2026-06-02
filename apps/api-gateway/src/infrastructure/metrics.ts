// @paradigm: sql
// Prometheus metrics for the api-gateway (advisor review P1-19 — "on-call is blind").
//
// A single process-wide Registry exposed at GET /metrics (server.ts). It carries:
//   - the default Node/process collectors (event-loop lag, heap, GC, fds, …)
//   - trpc_procedure_duration_ms  — histogram, the per-procedure latency SLI
//   - trpc_errors_total           — counter, server-vs-caller error rate
//
// The two tRPC series are fed from the SINGLE existing tracing middleware
// (application/trpc.ts) which already computes duration_ms + result.ok/error_code —
// so this adds an emit, not a second measurement path. Labels are kept LOW
// CARDINALITY on purpose: `path` is a fixed tRPC procedure name (not a URL with
// ids), `type` ∈ {query,mutation,subscription}, `ok` ∈ {true,false}, and `kind`
// ∈ {caller,server} so a dashboard can separate 4xx-equivalent from 5xx-equivalent.
// No workspace_id / user_id / request_id label — those are unbounded and would
// blow up the series count.

import { Registry, collectDefaultMetrics, Histogram, Counter } from 'prom-client';

export const registry = new Registry();

// Node/process defaults (heap, event-loop lag, GC, open fds, …). Prefixed so a
// shared Prometheus can tell gateway process metrics apart from other services.
collectDefaultMetrics({ register: registry, prefix: 'brain_gateway_' });

/**
 * Per-procedure latency. Buckets span the realistic range for our read path:
 * sub-10ms cache-y calls up to multi-second OLAP aggregations, so an alert can
 * watch p95/p99 without the histogram saturating into the +Inf bucket.
 */
export const trpcDuration = new Histogram({
  name: 'trpc_procedure_duration_ms',
  help: 'tRPC procedure handler duration in milliseconds',
  labelNames: ['path', 'type', 'ok'] as const,
  buckets: [5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000, 10000],
  registers: [registry],
});

/**
 * Error counter, split by the SAME caller-vs-server distinction the tracing
 * middleware already makes (CALLER_ERROR_CODES). `kind=server` is the on-call
 * page signal; `kind=caller` is the 4xx-equivalent noise floor.
 */
export const trpcErrors = new Counter({
  name: 'trpc_errors_total',
  help: 'tRPC procedure errors, labelled by tRPC error code and caller-vs-server kind',
  labelNames: ['path', 'type', 'code', 'kind'] as const,
  registers: [registry],
});
