// @paradigm: sql
//
// Web-side structured logger.
//
// Server contexts (middleware, Server Components, Server Actions, route
// handlers) → real pino instance via the shared Brain factory. Output is JSON
// to stdout; Docker / Fluent Bit / OpenSearch tail it the same way as the
// api-gateway.
//
// Browser contexts must NOT import this file — pino is a Node-only dep. Use
// `@/infrastructure/browser-logger.ts` instead for browser consoles.
//
// Per Brain canon (skills/observability + skills/data-privacy-dpdp), PII
// redact is enforced at the shared logger layer. NEVER log raw email/phone
// here; use the user's `sub` instead.

import { createLogger, type BrainLogger } from '@brain/lib-logger';

let _logger: BrainLogger | undefined;

/**
 * Process-singleton web logger. Bound to service: 'web'.
 *
 * Call sites should use `.child({ request_id, ... })` to enrich with
 * correlation context per request.
 */
export function webLogger(): BrainLogger {
  if (!_logger) {
    _logger = createLogger('web', {
      level: process.env['LOG_LEVEL'] ?? 'info',
    });
  }
  return _logger;
}
