/**
 * Infrastructure/DB barrel -- re-exports the session-context primitive and
 * correlation store so Children 3-7 import from one path.
 *
 * v1 internal contract path: @brain/core-service/infrastructure/db
 */

export {
  withWorkspace,
  withSuperadmin,
  getCorrelation,
  correlationStore,
  type CorrelationContext,
  // Test-only exports -- prefix marks them; do not call in production code.
  _setPoolForTest,
  _resetPoolForTest,
  // Probe-only: raw query with BYPASSRLS runtime assertion (STATIC GATE: only rls-probe.ts may call).
  _rawQuery,
} from './workspace-context.js'

export {
  // Test-only exports for probe unit tests.
  _setProbeQueryRunner,
  _resetProbeQueryRunner,
  type ProbeQueryRunner,
} from './rls-probe.js'
