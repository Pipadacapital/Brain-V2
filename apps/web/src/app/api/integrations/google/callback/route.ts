// @paradigm: io
// Google Ads OAuth callback (Slice D) — REGISTER THIS URL in Google Cloud Console
// (APIs & Services → Credentials → OAuth 2.0 Client → Authorized redirect URIs):
//   http://localhost:3000/api/integrations/google/callback
// Matches the legacy GOOGLE_ADS_REDIRECT_URI path shape. Google returns ?code&state
// (access_type=offline + prompt=consent at initiate guarantee a refresh_token).

import { type NextRequest } from 'next/server';
import { handleConnectorCallback } from '@/infrastructure/connector-callback-handler.js';

export async function GET(request: NextRequest) {
  return handleConnectorCallback(request, 'GOOGLE');
}
