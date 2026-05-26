// @paradigm: sql (no ML, no LLM)
//
// Brain shared logger primitive — see docs/observability.md for the end-to-end
// trace pattern.
//
// One pino config; every TS service binds to it.
//
// Canon honored:
//   - Structured JSON to stdout (Brain canon: Fluent Bit → OpenSearch downstream).
//   - Single correlation ID 4-tuple: request_id + trace_id + workspace_id + user_id.
//   - PII never serialized: redact paths cover Authorization headers, Supabase
//     tokens, OAuth tokens, customer email, customer phone, secret keys.
//   - Level via LOG_LEVEL env (default 'info').

export {
  createLogger,
  packageLogger,
  type BrainLogger,
} from './create-logger.js';

export {
  extractCorrelation,
  buildCorrelationHeaders,
  newCorrelationId,
  REQUEST_ID_HEADER,
  TRACE_ID_HEADER,
  WORKSPACE_HEADER,
  USER_HEADER,
  type CorrelationContext,
  type CorrelationHeaders,
} from './correlation.js';

export { PII_REDACT_PATHS } from './redact-paths.js';
