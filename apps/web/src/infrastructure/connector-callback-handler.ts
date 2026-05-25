// @paradigm: io
// Shared connector OAuth callback handler (Slice D). Used by the three provider
// callback route handlers (shopify/meta/google). ONE handler, vendor as config —
// not three bespoke handlers (Single-Primitive).
//
// Flow: read code/state/error (+ Shopify hmac/shop) from the provider redirect query
// → validate the Supabase session (the connecting user) → call the gateway
// connectors.completeCallback with the verified Bearer → redirect to
// /settings/integrations?connected={vendor} | ?error=<slug>.
//
// CF-C6-PII-CLIENT-1 / TC-003: the code + token are credentials — never logged,
// never placed in the redirect URL. Only a NON-secret error slug is surfaced.

import { NextResponse, type NextRequest } from 'next/server';
import { createSupabaseServerClient } from '@/infrastructure/supabase/server.js';
import {
  completeConnectorCallback,
  type ConnectorVendor,
} from '@/infrastructure/connector-callback.js';

const SETTINGS_PATH = '/settings/integrations';

export async function handleConnectorCallback(
  request: NextRequest,
  vendor: ConnectorVendor,
): Promise<NextResponse> {
  const { searchParams, origin } = request.nextUrl;
  const code = searchParams.get('code');
  const state = searchParams.get('state');
  const providerError = searchParams.get('error');

  const redirect = (qs: string) => NextResponse.redirect(`${origin}${SETTINGS_PATH}?${qs}`);

  // Provider denied / errored — surface a generic slug (never the raw reason).
  if (providerError) {
    return redirect(`error=auth_denied&vendor=${vendor.toLowerCase()}`);
  }
  if (!code || !state) {
    return redirect(`error=missing_params&vendor=${vendor.toLowerCase()}`);
  }

  // The connecting user must have a live Supabase session (slice-A identity).
  const supabase = await createSupabaseServerClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session?.access_token) {
    // Not signed in → send to login; never attempt the exchange without identity.
    return NextResponse.redirect(`${origin}/login?next=${encodeURIComponent(SETTINGS_PATH)}`);
  }

  // Collect the full provider query (Shopify HMAC validation needs hmac/shop/host/timestamp).
  // NON-secret params only; the `code` is passed in the body, not echoed here.
  const query: Record<string, string> = {};
  for (const [k, v] of searchParams.entries()) {
    if (k === 'code') continue; // the code is a credential — body only, never in `query`
    query[k] = v;
  }

  const outcome = await completeConnectorCallback({
    vendor,
    code,
    state,
    accessToken: session.access_token,
    query,
  });

  if (outcome.ok) {
    return redirect(`connected=${vendor.toLowerCase()}`);
  }
  return redirect(`error=${outcome.errorSlug ?? 'connect_failed'}&vendor=${vendor.toLowerCase()}`);
}
