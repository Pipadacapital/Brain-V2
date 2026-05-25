// @paradigm: io
// Meta Ads OAuth callback (Slice D) — REGISTER THIS URL in the Meta App dashboard
// (Facebook Login → Settings → Valid OAuth Redirect URIs):
//   http://localhost:3000/api/integrations/meta/callback
// Matches the legacy META_REDIRECT_URI path shape. Meta returns ?code&state.

import { type NextRequest } from 'next/server';
import { handleConnectorCallback } from '@/infrastructure/connector-callback-handler.js';

export async function GET(request: NextRequest) {
  return handleConnectorCallback(request, 'META');
}
