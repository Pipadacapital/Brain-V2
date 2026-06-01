// @paradigm: sql
//
// Boot-time presence assert for Shopify OAuth env vars.
//
// Design mirror: the gateway's assertBootableAuthConfig / readAuthConfig pair
// (apps/api-gateway/src/interfaces/server.ts:60-76). Pure — takes env as a
// parameter so it is unit-testable without boot side-effects. Returns a fatal
// message string (naming the VAR only, NEVER the value — CF-TS-NEVERLOG-1) or
// null if the config is bootable. The gateway boot block calls this alongside
// assertBootableAuthConfig and exits(1) on a non-null fatal.
//
// CF-TS-FAILFAST-1: a missing SHOPIFY_CLIENT_SECRET surfaces at process start,
// not at the first OAuth callback. requireEnv (provider-config.ts) stays
// call-time; this is the early-boot complement, not a replacement.
//
// CF-TS-NEVERLOG-1: presence/non-empty check only. The value is never read
// into the message, returned, or logged. The message names the variable name
// and the SM path so an operator knows exactly which rotation to fix —
// that is the only information in the string.
//
// CF-TS-NO-AWS-CLIENT-1: zero AWS SDK. The value arrives via platform
// env-injection (ECS task-def secrets: mapping in credential-custody-stack.ts).
// TS reads process.env at boot — byte-identical to today's call-time read.

/**
 * Assert that Shopify OAuth env vars needed by core-service are present and
 * non-empty. Pure — does NOT read or log the value; names only the var.
 *
 * @param env - Injectable (defaults to process.env) so callers can unit-test
 *              without touching the real process environment.
 * @returns A fatal message string (var-name only, never value) if boot MUST
 *          abort, or null if the config is bootable.
 */
export function assertShopifyOAuthSecretsPresent(
  env: NodeJS.ProcessEnv = process.env,
): string | null {
  // Presence + non-empty only. The value is never echoed, returned, or logged.
  const name = 'SHOPIFY_CLIENT_SECRET'
  const v = (env[name] ?? '').trim()
  if (!v) {
    return (
      `${name} is not set — core-service Shopify OAuth cannot start. ` +
      `(injected from SM brain/_app/shopify/hmac_secret at the task boundary).`
    )
  }
  return null
}
