// Unit coverage for the Prometheus metrics registry (P1-19).
// Asserts the two tRPC series are registered, emit in the text exposition after
// an observe/inc, and carry the low-cardinality label set we committed to — so a
// future edit that drops a series or leaks a high-cardinality label fails here.
import { describe, it, expect, beforeEach } from 'vitest';
import { registry, trpcDuration, trpcErrors } from './metrics.js';

describe('api-gateway metrics registry', () => {
  beforeEach(() => {
    // Reset only the two custom series; leave default collectors intact.
    trpcDuration.reset();
    trpcErrors.reset();
  });

  it('exposes the default Node collectors under the brain_gateway_ prefix', async () => {
    const text = await registry.metrics();
    expect(text).toContain('brain_gateway_process_cpu_seconds_total');
  });

  it('records a duration observation in the histogram exposition', async () => {
    trpcDuration.observe({ path: 'store.summary', type: 'query', ok: 'true' }, 42);
    const text = await registry.metrics();
    expect(text).toContain('trpc_procedure_duration_ms_bucket');
    expect(text).toContain('path="store.summary"');
    expect(text).toContain('ok="true"');
    // 42ms falls in the 50ms bucket but not the 25ms one.
    expect(text).toMatch(/trpc_procedure_duration_ms_bucket\{[^}]*le="25"[^}]*\}\s+0/);
    expect(text).toMatch(/trpc_procedure_duration_ms_bucket\{[^}]*le="50"[^}]*\}\s+1/);
  });

  it('increments the error counter split by caller-vs-server kind', async () => {
    trpcErrors.inc({ path: 'store.summary', type: 'query', code: 'INTERNAL_SERVER_ERROR', kind: 'server' });
    trpcErrors.inc({ path: 'user.me', type: 'query', code: 'UNAUTHORIZED', kind: 'caller' });
    const text = await registry.metrics();
    expect(text).toMatch(/trpc_errors_total\{[^}]*kind="server"[^}]*\}\s+1/);
    expect(text).toMatch(/trpc_errors_total\{[^}]*kind="caller"[^}]*\}\s+1/);
  });

  it('does NOT carry unbounded labels (workspace_id / user_id / request_id)', async () => {
    // Cardinality guard: these would explode the series count under real traffic.
    trpcDuration.observe({ path: 'store.summary', type: 'query', ok: 'true' }, 1);
    trpcErrors.inc({ path: 'store.summary', type: 'query', code: 'INTERNAL_SERVER_ERROR', kind: 'server' });
    const text = await registry.metrics();
    const trpcLines = text.split('\n').filter((l) => l.startsWith('trpc_'));
    expect(trpcLines.length).toBeGreaterThan(0);
    for (const l of trpcLines) {
      expect(l).not.toContain('workspace_id=');
      expect(l).not.toContain('user_id=');
      expect(l).not.toContain('request_id=');
    }
  });
});
