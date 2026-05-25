// @paradigm: io
// Connector OAuth callback bridge (Slice D).
//
// The browser is redirected back from the provider (Shopify/Meta/Google) to a Brain
// callback route handler with ?code&state (+ Shopify hmac/shop/host/timestamp). The
// route handler validates the Supabase session and calls the gateway tRPC mutation
// `connectors.completeCallback` with the verified session access token as a Bearer —
// the SAME verify path every authed call uses. core-service then validates the CSRF
// state, [Shopify] the HMAC, exchanges the code, and persists the token ENCRYPTED.
//
// CF-C6-PII-CLIENT-1 / TC-003: never log the code or any token; never put a token in
// a URL. The `code` is a one-time authorization code (a credential) — passed only in
// the POST body to the gateway, never logged, never echoed back to the browser URL.

function gatewayUrl(): string {
  return process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';
}

export type ConnectorVendor = 'SHOPIFY' | 'META' | 'GOOGLE';

export interface CallbackOutcome {
  ok: boolean;
  /** present on success — drives the redirect ?connected={vendor} */
  vendor?: ConnectorVendor;
  /** a short, NON-secret error slug for the redirect ?error=... (never a token/body) */
  errorSlug?: string;
}

/**
 * Call the gateway connectors.completeCallback mutation. Returns a NON-secret outcome
 * for the redirect. The access token + code are credentials — never logged.
 */
export async function completeConnectorCallback(params: {
  vendor: ConnectorVendor;
  code: string;
  state: string;
  accessToken: string;
  query: Record<string, string>;
}): Promise<CallbackOutcome> {
  try {
    // tRPC mutation over httpLink wire format: POST /trpc/connectors.completeCallback
    const url = `${gatewayUrl()}/trpc/connectors.completeCallback`;
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${params.accessToken}`,
        'content-type': 'application/json',
      },
      cache: 'no-store',
      // superjson transformer wire shape: { json: <input> }
      body: JSON.stringify({
        json: {
          vendor: params.vendor,
          code: params.code,
          state: params.state,
          query: params.query,
        },
      }),
    });
    if (!res.ok) {
      return { ok: false, errorSlug: 'connect_failed' };
    }
    const body = (await res.json()) as {
      result?: { data?: { json?: { status?: string; vendor?: ConnectorVendor } } };
    };
    const status = body?.result?.data?.json?.status;
    if (status === 'CONNECTED') {
      return { ok: true, vendor: params.vendor };
    }
    return { ok: false, errorSlug: 'connect_failed' };
  } catch {
    return { ok: false, errorSlug: 'connect_failed' };
  }
}
