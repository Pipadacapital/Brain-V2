// @paradigm: sql
//
// PII / secret redact paths for every Brain service.
//
// These are the values pino will replace with '[Redacted]' before the log line
// is serialized. The list is canonical — adding a new service or a new field
// that may carry PII MUST land here, not in per-service config, so the
// guarantee is uniform across the stack (Brain canon: DPDP minimization +
// "PII never stored / logged in plaintext").
//
// Path syntax follows pino's `redact.paths` rules. `*` matches one key segment;
// `[*]` matches any array index. See https://getpino.io/#/docs/redaction.

export const PII_REDACT_PATHS: readonly string[] = [
  // --- HTTP headers (incoming + outgoing) ---
  'req.headers.authorization',
  'req.headers.cookie',
  'req.headers["x-supabase-auth"]',
  'req.headers["x-api-key"]',
  'res.headers["set-cookie"]',
  'headers.authorization',
  'headers.cookie',

  // --- Supabase / OAuth tokens (any nesting) ---
  'access_token',
  'refresh_token',
  'id_token',
  '*.access_token',
  '*.refresh_token',
  '*.id_token',
  'session.access_token',
  'session.refresh_token',
  'user.access_token',
  'user.refresh_token',

  // --- Vendor OAuth credentials in connector flows ---
  'credential',
  'credential.content',
  '*.credential',
  '*.credential.content',
  'connector.credentials',
  '*.connector.credentials',

  // --- Customer PII (DPDP-scoped fields) ---
  // Email is identity-tier in the auth claim; log only when explicitly
  // identifying a user, NEVER as a bulk field on a request.
  // shared-libs-7: bare top-level keys added so direct log({ email, phone, ... })
  // calls are redacted even without object nesting.
  'email',
  'phone',
  'firstName',
  'lastName',
  '*.email',
  '*.phone',
  '*.firstName',
  '*.lastName',
  'customer.email',
  'customer.firstName',
  'customer.lastName',
  'customer.phone',
  'pii.email',
  'pii.phone',
  'pii.firstName',
  'pii.lastName',
  'shipping_address',
  'billing_address',

  // --- Webhook secrets, HMAC signing keys ---
  '*.secret',
  '*.client_secret',
  'SHOPIFY_CLIENT_SECRET',
  'META_APP_SECRET',
  'GOOGLE_ADS_CLIENT_SECRET',
  'webhook_secret',

  // --- Env-shaped leaks ---
  '*.password',
  'password',
  'DATABASE_URL',
  'SUPABASE_ANON_KEY',

  // --- Connector-custody encryption key ---
  'CONNECTOR_CUSTODY_KEY',
];
