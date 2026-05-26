// @paradigm: sql
//
// Browser-side logger — Brain canon's correlation pattern as a tiny console
// wrapper. We do NOT load pino on the browser (Node-only dependency); instead
// a 30-line console wrapper emits the same JSON shape so DevTools shows
// log lines that look identical to the server logs.
//
// Browser logs travel only as far as the DevTools console + any remote-error
// transport (Sentry, etc. — not wired today). The correlation ID is the
// CRITICAL bridge: every browser log line carries the request_id, so when a
// user reports a bug, the correlation ID from their console matches the
// gateway's server-side trace.
//
// Browser logs MUST NOT contain user PII. Only structural fields.

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LEVEL_NUMERIC: Record<LogLevel, number> = {
  debug: 20,
  info: 30,
  warn: 40,
  error: 50,
};

const SERVICE = 'web-browser';

interface BrowserLogFields {
  request_id?: string;
  trace_id?: string;
  route?: string;
  [k: string]: unknown;
}

/**
 * Emit one structured log event to the browser console. Format matches the
 * server-side pino JSON shape so DevTools shows identical lines.
 *
 * Set `localStorage.setItem('brain.log_level', 'debug')` to see debug lines;
 * defaults to 'info'.
 */
export function browserLog(
  level: LogLevel,
  msg: string,
  fields: BrowserLogFields = {},
): void {
  if (typeof window === 'undefined') return;

  let activeLevel: LogLevel = 'info';
  try {
    const stored = window.localStorage?.getItem('brain.log_level');
    if (stored && stored in LEVEL_NUMERIC) {
      activeLevel = stored as LogLevel;
    }
  } catch {
    // localStorage may be unavailable (Safari private mode); fall back to info.
  }

  if (LEVEL_NUMERIC[level] < LEVEL_NUMERIC[activeLevel]) return;

  const event = {
    level: LEVEL_NUMERIC[level],
    time: new Date().toISOString(),
    service: SERVICE,
    msg,
    ...fields,
  };

  const out = JSON.stringify(event);
  switch (level) {
    case 'debug':
      console.debug(out);
      break;
    case 'info':
      console.info(out);
      break;
    case 'warn':
      console.warn(out);
      break;
    case 'error':
      console.error(out);
      break;
  }
}
