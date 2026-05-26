// @paradigm: sql
//
// Brain logger factory — one shared pino config.
//
// Every TS service does:
//
//   import { createLogger } from '@brain/lib-logger';
//   const log = createLogger('api-gateway');  // service name baked in
//
//   log.info({ workspace_id, user_id, route: '/dashboard' }, 'page loaded');
//
// Output is JSON to stdout — one line per event, ISO-8601 timestamp, PII paths
// redacted. Fluent Bit (Phase 2+) tails stdout and ships to OpenSearch; locally
// pipe through `jq` for pretty inspection (`docker compose logs -f api-gateway | jq`).
//
// Level via LOG_LEVEL env (default 'info'). Use 'debug' to enable per-query +
// per-decision-step traces; use 'warn' in production-noisy hot paths.

import { pino, type Logger, type LoggerOptions, type Bindings } from 'pino';

import { PII_REDACT_PATHS } from './redact-paths.js';

export type BrainLogger = Logger;

export interface CreateLoggerOptions {
  /** Override LOG_LEVEL (otherwise pulled from process.env.LOG_LEVEL || 'info'). */
  level?: string;
  /** Extra fields that go on every log line from this logger. */
  bindings?: Bindings;
  /** Pretty-print to stdout (dev only; never enable in production). */
  pretty?: boolean;
}

/**
 * Construct a Brain-canon logger bound to a service.
 *
 * @param service - service name baked into every log line (`service: 'api-gateway'`)
 *                  so downstream aggregation can split per service.
 */
export function createLogger(
  service: string,
  opts: CreateLoggerOptions = {},
): BrainLogger {
  const level = opts.level ?? process.env['LOG_LEVEL'] ?? 'info';

  const base: LoggerOptions = {
    level,
    // ISO-8601 timestamps so downstream tooling parses without a format hint.
    timestamp: pino.stdTimeFunctions.isoTime,
    // PII redact paths — canonical list (see redact-paths.ts).
    redact: {
      paths: [...PII_REDACT_PATHS],
      censor: '[Redacted]',
      remove: false,
    },
    // Standard error serializer so thrown errors carry stack + cause.
    serializers: {
      err: pino.stdSerializers.err,
      req: pino.stdSerializers.req,
      res: pino.stdSerializers.res,
    },
    // Bind service + any caller-supplied fields to every line.
    base: {
      service,
      pid: process.pid,
      ...opts.bindings,
    },
  };

  if (opts.pretty) {
    // pino-pretty would be added as a dev dep when adopted. For now we keep
    // the option declared but only honored when the transport is available.
    base.transport = {
      target: 'pino-pretty',
      options: { colorize: true, translateTime: 'SYS:HH:MM:ss.l', singleLine: false },
    };
  }

  return pino(base);
}
